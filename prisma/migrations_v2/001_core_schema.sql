-- Migration 001: Core production schema
-- Architecture: Global city support with on-demand bootstrap
-- Author: Production rebuild
-- Date: 2025-10-18

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums
CREATE TYPE job_status AS ENUM ('queued', 'running', 'done', 'error');
CREATE TYPE place_source AS ENUM ('overture', 'osm', 'bootstrap');
CREATE TYPE place_status AS ENUM ('open', 'closed', 'unverified');

-- City table with bbox for geo queries
CREATE TABLE IF NOT EXISTS "City" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  bbox geometry(Polygon, 4326),
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  ranked BOOLEAN NOT NULL DEFAULT false,
  last_refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT city_name_country_unique UNIQUE (name, country)
);

CREATE INDEX idx_city_name ON "City" (name);
CREATE INDEX idx_city_ranked ON "City" (ranked) WHERE ranked = true;
CREATE INDEX idx_city_bbox ON "City" USING GIST (bbox);

COMMENT ON TABLE "City" IS 'Cities with coverage - supports both preloaded and bootstrapped cities';
COMMENT ON COLUMN "City".ranked IS 'True if city has Reddit data and rankings; false for bootstrap-only';
COMMENT ON COLUMN "City".bbox IS 'Bounding box for geo queries and Overpass fetches';

-- City aliases for normalization
CREATE TABLE IF NOT EXISTS "CityAlias" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  city_id TEXT NOT NULL REFERENCES "City"(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  is_borough BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive unique index on alias
CREATE UNIQUE INDEX idx_city_alias_unique ON "CityAlias" (LOWER(alias));
CREATE INDEX idx_city_alias_city_id ON "CityAlias" (city_id);

COMMENT ON TABLE "CityAlias" IS 'City and borough aliases for query normalization';

-- Places (restaurants/cafes/bars)
CREATE TABLE IF NOT EXISTS "Place" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  city_id TEXT NOT NULL REFERENCES "City"(id) ON DELETE CASCADE,
  overture_id TEXT,
  osm_id TEXT,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL, -- lowercase, no punctuation
  geog geography(Point, 4326) NOT NULL,
  address TEXT,
  cuisine TEXT[] NOT NULL DEFAULT '{}',
  status place_status NOT NULL DEFAULT 'open',
  brand TEXT,
  source place_source NOT NULL DEFAULT 'overture',
  aliases TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT place_city_name_unique UNIQUE (city_id, name_norm)
);

-- Indexes for Place
CREATE INDEX idx_place_city_id ON "Place" (city_id);
CREATE INDEX idx_place_name_trgm ON "Place" USING GIN (name_norm gin_trgm_ops);
CREATE INDEX idx_place_geog ON "Place" USING GIST (geog);
CREATE INDEX idx_place_cuisine ON "Place" USING GIN (cuisine);
CREATE INDEX idx_place_status_open ON "Place" (city_id, status) WHERE status = 'open';
CREATE INDEX idx_place_overture_id ON "Place" (overture_id) WHERE overture_id IS NOT NULL;
CREATE INDEX idx_place_osm_id ON "Place" (osm_id) WHERE osm_id IS NOT NULL;

-- Set trigram similarity threshold globally
SET pg_trgm.similarity_threshold = 0.55;

COMMENT ON TABLE "Place" IS 'Global restaurant/cafe/bar database from Overture, OSM, and bootstrap';
COMMENT ON COLUMN "Place".name_norm IS 'Normalized name for trigram matching (lowercase, no punct)';
COMMENT ON COLUMN "Place".source IS 'Data source: overture (monthly), osm (curated), bootstrap (on-demand)';
COMMENT ON COLUMN "Place".brand IS 'Chain brand identifier for disambiguation';

-- Reddit mentions (ToS compliant - no raw text)
CREATE TABLE IF NOT EXISTS "RedditMention" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  place_id TEXT REFERENCES "Place"(id) ON DELETE CASCADE,
  subreddit TEXT NOT NULL,
  post_id TEXT NOT NULL,
  comment_id TEXT,
  score INT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  permalink TEXT NOT NULL,
  text_hash BYTEA NOT NULL,
  text_len INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT reddit_mention_unique UNIQUE (post_id, comment_id, place_id)
);

-- Indexes for RedditMention
CREATE INDEX idx_reddit_mention_place_ts ON "RedditMention" (place_id, ts DESC);
CREATE INDEX idx_reddit_mention_subreddit ON "RedditMention" (subreddit);
CREATE INDEX idx_reddit_mention_ts_brin ON "RedditMention" USING BRIN (ts);

COMMENT ON TABLE "RedditMention" IS 'Reddit mentions with metadata only (ToS compliant)';
COMMENT ON COLUMN "RedditMention".text_hash IS 'SHA256 hash of original text for deduplication';
COMMENT ON COLUMN "RedditMention".text_len IS 'Character count of original mention';

-- Pre-computed place aggregations
CREATE TABLE IF NOT EXISTS "PlaceAggregation" (
  place_id TEXT PRIMARY KEY REFERENCES "Place"(id) ON DELETE CASCADE,
  iconic_score NUMERIC(10, 2) NOT NULL DEFAULT 0,
  trending_score NUMERIC(10, 2) NOT NULL DEFAULT 0,
  unique_threads INT NOT NULL DEFAULT 0,
  total_mentions INT NOT NULL DEFAULT 0,
  total_upvotes INT NOT NULL DEFAULT 0,
  mentions_90d INT NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ,
  top_snippets JSONB NOT NULL DEFAULT '[]',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT place_agg_scores_positive CHECK (iconic_score >= 0 AND trending_score >= 0)
);

CREATE INDEX idx_place_agg_iconic ON "PlaceAggregation" (place_id, iconic_score DESC);
CREATE INDEX idx_place_agg_trending ON "PlaceAggregation" (place_id, trending_score DESC);

COMMENT ON TABLE "PlaceAggregation" IS 'Pre-computed rankings and statistics per place';
COMMENT ON COLUMN "PlaceAggregation".top_snippets IS 'Array of {permalink, score, ts, excerpt_hash, excerpt_len}';

-- Subreddit to city mapping
CREATE TABLE IF NOT EXISTS "Subreddit" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  city_id TEXT REFERENCES "City"(id) ON DELETE CASCADE,
  last_sync TIMESTAMPTZ,
  total_posts INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subreddit_city ON "Subreddit" (city_id);
CREATE INDEX idx_subreddit_active ON "Subreddit" (is_active) WHERE is_active = true;

COMMENT ON TABLE "Subreddit" IS 'Subreddit to city mapping for Reddit ingestion';

-- Job queue for async tasks
CREATE TABLE IF NOT EXISTS "JobQueue" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status job_status NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  CONSTRAINT job_max_attempts CHECK (attempts <= 5)
);

CREATE INDEX idx_job_status_type ON "JobQueue" (status, type);
CREATE INDEX idx_job_created ON "JobQueue" (created_at);

COMMENT ON TABLE "JobQueue" IS 'Async job queue for bootstrap, ingestion, and aggregation tasks';
COMMENT ON COLUMN "JobQueue".type IS 'Job type: bootstrap_city, ingest_reddit, compute_aggregations, refresh_mvs';

-- MV version tracking for ETags
CREATE TABLE IF NOT EXISTS "MaterializedViewVersion" (
  view_name TEXT PRIMARY KEY,
  version_hash TEXT NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_count BIGINT
);

COMMENT ON TABLE "MaterializedViewVersion" IS 'Version tracking for materialized views (for ETag generation)';
