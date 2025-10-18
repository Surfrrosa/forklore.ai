-- Load CSV exports into Neon Postgres
-- Usage: psql $DATABASE_URL -f scripts/04_load_postgres.sql

\echo '🐘 Loading data into Postgres...'
\echo ''

-- Ensure extensions are installed
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgvector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- STEP 1: Load Cities
-- ============================================================================

\echo '📍 Loading cities...'

CREATE TEMP TABLE cities_staging (
    name TEXT,
    country TEXT,
    bbox TEXT
);

\copy cities_staging FROM 'data/csv_export/cities.csv' WITH (FORMAT CSV, HEADER true);

INSERT INTO "City" (id, name, country, bbox, "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    name,
    country,
    NULL,  -- bbox computed separately
    NOW(),
    NOW()
FROM cities_staging
ON CONFLICT (name) DO NOTHING;

DROP TABLE cities_staging;

-- ============================================================================
-- STEP 2: Load Places
-- ============================================================================

\echo '🍽️  Loading places...'

CREATE TEMP TABLE places_staging (
    overture_id TEXT,
    name TEXT,
    name_norm TEXT,
    city TEXT,
    geom_wkt TEXT,
    address TEXT,
    cuisine TEXT[]
);

\copy places_staging FROM 'data/csv_export/places.csv' WITH (FORMAT CSV, HEADER true);

INSERT INTO "Place" (
    id,
    "overtureId",
    name,
    "nameNorm",
    "cityId",
    geog,
    address,
    cuisine,
    status,
    "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    ps.overture_id,
    ps.name,
    ps.name_norm,
    c.id,
    ST_GeogFromText(ps.geom_wkt),
    ps.address,
    ps.cuisine,
    'active',
    NOW()
FROM places_staging ps
JOIN "City" c ON c.name = ps.city
ON CONFLICT ("overtureId") DO UPDATE SET
    name = EXCLUDED.name,
    "nameNorm" = EXCLUDED."nameNorm",
    geog = EXCLUDED.geog,
    address = EXCLUDED.address,
    cuisine = EXCLUDED.cuisine,
    "updatedAt" = NOW();

DROP TABLE places_staging;

-- ============================================================================
-- STEP 3: Load Mentions
-- ============================================================================

\echo '💬 Loading mentions...'

CREATE TEMP TABLE mentions_staging (
    place_id TEXT,
    subreddit TEXT,
    post_id TEXT,
    comment_id TEXT,
    score INTEGER,
    timestamp TIMESTAMP,
    snippet TEXT
);

\copy mentions_staging FROM 'data/csv_export/mentions.csv' WITH (FORMAT CSV, HEADER true);

INSERT INTO "RedditMention" (
    id,
    "placeId",
    subreddit,
    "postId",
    "commentId",
    score,
    timestamp,
    snippet,
    "createdAt"
)
SELECT
    gen_random_uuid()::text,
    p.id,
    ms.subreddit,
    ms.post_id,
    ms.comment_id,
    ms.score,
    ms.timestamp,
    ms.snippet,
    NOW()
FROM mentions_staging ms
JOIN "Place" p ON p."overtureId" = ms.place_id
ON CONFLICT DO NOTHING;

DROP TABLE mentions_staging;

-- ============================================================================
-- STEP 4: Create custom indexes (from migration SQL)
-- ============================================================================

\echo '📊 Creating indexes...'

-- Spatial index on Place.geog (GIST for geography)
CREATE INDEX IF NOT EXISTS idx_place_geog_gist
ON "Place" USING GIST (geog);

-- Fuzzy trigram index on normalized name
CREATE INDEX IF NOT EXISTS idx_place_name_norm_trgm
ON "Place" USING GIN ("nameNorm" gin_trgm_ops);

-- Composite btree for hot-path city + score queries
CREATE INDEX IF NOT EXISTS idx_place_agg_city_iconic
ON "PlaceAggregation" ("placeId", "iconicScore" DESC);

CREATE INDEX IF NOT EXISTS idx_place_agg_city_trending
ON "PlaceAggregation" ("placeId", "trendingScore" DESC);

-- RedditMention indexes
CREATE INDEX IF NOT EXISTS idx_mention_place_btree
ON "RedditMention" ("placeId");

CREATE INDEX IF NOT EXISTS idx_mention_timestamp_btree
ON "RedditMention" (timestamp DESC);

-- BRIN for time-series data
CREATE INDEX IF NOT EXISTS idx_mention_timestamp_brin
ON "RedditMention" USING BRIN (timestamp);

-- Covering index for common detail queries
CREATE INDEX IF NOT EXISTS idx_mention_place_time_covering
ON "RedditMention" ("placeId", timestamp DESC)
INCLUDE (score, snippet);

\echo ''
\echo '✅ Data load complete!'
\echo ''
\echo 'Next steps:'
\echo '  1. Run: python scripts/05_ner_extraction.py'
\echo '  2. Run: python scripts/06_compute_scores.py'
\echo '  3. Run: SELECT refresh_all_materialized_views();'
