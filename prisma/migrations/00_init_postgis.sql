-- Enable extensions (Neon natively supports these)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgvector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Run this AFTER `prisma migrate deploy`

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Spatial index on Place.geog (GIST for geography)
CREATE INDEX IF NOT EXISTS idx_place_geog_gist
ON "Place" USING GIST (geog);

-- Fuzzy trigram index on normalized name for fast LIKE/similarity queries
CREATE INDEX IF NOT EXISTS idx_place_name_norm_trgm
ON "Place" USING GIN (name_norm gin_trgm_ops);

-- Composite btree for hot-path city + score queries
CREATE INDEX IF NOT EXISTS idx_place_agg_city_iconic
ON "PlaceAggregation" (place_id, iconic_score DESC);

CREATE INDEX IF NOT EXISTS idx_place_agg_city_trending
ON "PlaceAggregation" (place_id, trending_score DESC);

-- RedditMention indexes (with BRIN for time-series data)
CREATE INDEX IF NOT EXISTS idx_mention_place_btree
ON "RedditMention" (place_id);

CREATE INDEX IF NOT EXISTS idx_mention_timestamp_btree
ON "RedditMention" (timestamp DESC);

-- BRIN for fast time filtering on large tables (monthly partitions later)
CREATE INDEX IF NOT EXISTS idx_mention_timestamp_brin
ON "RedditMention" USING BRIN (timestamp);

-- Covering index for common detail queries
CREATE INDEX IF NOT EXISTS idx_mention_place_time_covering
ON "RedditMention" (place_id, timestamp DESC)
INCLUDE (score, snippet);

-- ============================================================================
-- MATERIALIZED VIEWS (for <10ms query latency)
-- ============================================================================

-- Top 100 iconic restaurants per city (precomputed)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_iconic_by_city AS
SELECT
  p.city_id,
  p.id as place_id,
  p.name,
  p.cuisine,
  p.address,
  ST_Y(p.geog::geometry) as lat,
  ST_X(p.geog::geometry) as lon,
  pa.iconic_score,
  pa.unique_threads,
  pa.total_mentions,
  pa.total_upvotes,
  pa.last_seen,
  pa.top_snippets,
  ROW_NUMBER() OVER (PARTITION BY p.city_id ORDER BY pa.iconic_score DESC) as rank
FROM "Place" p
JOIN "PlaceAggregation" pa ON p.id = pa.place_id
WHERE p.status = 'active'
ORDER BY p.city_id, pa.iconic_score DESC;

CREATE UNIQUE INDEX ON mv_top_iconic_by_city (city_id, place_id);
CREATE INDEX ON mv_top_iconic_by_city (city_id, rank) WHERE rank <= 100;

-- Top 50 trending restaurants per city (last 90 days)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_trending_by_city AS
SELECT
  p.city_id,
  p.id as place_id,
  p.name,
  p.cuisine,
  p.address,
  ST_Y(p.geog::geometry) as lat,
  ST_X(p.geog::geometry) as lon,
  pa.trending_score,
  pa.mentions_90d,
  pa.last_seen,
  pa.top_snippets,
  ROW_NUMBER() OVER (PARTITION BY p.city_id ORDER BY pa.trending_score DESC) as rank
FROM "Place" p
JOIN "PlaceAggregation" pa ON p.id = pa.place_id
WHERE p.status = 'active' AND pa.mentions_90d > 0
ORDER BY p.city_id, pa.trending_score DESC;

CREATE UNIQUE INDEX ON mv_top_trending_by_city (city_id, place_id);
CREATE INDEX ON mv_top_trending_by_city (city_id, rank) WHERE rank <= 50;

-- Top restaurants by cuisine per city
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_by_cuisine AS
SELECT
  p.city_id,
  unnest(p.cuisine) as cuisine_type,
  p.id as place_id,
  p.name,
  p.address,
  ST_Y(p.geog::geometry) as lat,
  ST_X(p.geog::geometry) as lon,
  pa.iconic_score,
  pa.unique_threads,
  pa.total_mentions,
  ROW_NUMBER() OVER (
    PARTITION BY p.city_id, unnest(p.cuisine)
    ORDER BY pa.iconic_score DESC
  ) as rank
FROM "Place" p
JOIN "PlaceAggregation" pa ON p.id = pa.place_id
WHERE p.status = 'active' AND array_length(p.cuisine, 1) > 0
ORDER BY p.city_id, cuisine_type, pa.iconic_score DESC;

CREATE INDEX ON mv_top_by_cuisine (city_id, cuisine_type, rank) WHERE rank <= 20;

-- ============================================================================
-- REFRESH FUNCTION (call after monthly recompute)
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_iconic_by_city;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_trending_by_city;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_by_cuisine;
END;
$$ LANGUAGE plpgsql;
