-- Covering indexes for materialized views
-- Goal: Index-only scans for <100ms p95 latency

-- Drop existing indexes if they exist (for idempotency)
DROP INDEX IF EXISTS idx_mv_iconic_city_rank_covering;
DROP INDEX IF EXISTS idx_mv_trending_city_rank_covering;

-- Covering index for mv_top_iconic_by_city
-- Covers all columns needed for API response + cuisine filtering
CREATE INDEX idx_mv_iconic_city_rank_covering
ON mv_top_iconic_by_city (city_id, rank)
INCLUDE (
  place_id,
  name,
  cuisine,
  lat,
  lon,
  address,
  iconic_score,
  unique_threads,
  total_mentions,
  last_seen
);

-- Covering index for mv_top_trending_by_city
-- Same covering structure for trending
CREATE INDEX idx_mv_trending_city_rank_covering
ON mv_top_trending_by_city (city_id, rank)
INCLUDE (
  place_id,
  name,
  cuisine,
  lat,
  lon,
  address,
  trending_score,
  unique_threads,
  total_mentions,
  last_seen
);

-- Cuisine filter index for iconic
CREATE INDEX idx_mv_iconic_city_cuisine
ON mv_top_iconic_by_city USING GIN (cuisine);

-- Cuisine filter index for trending
CREATE INDEX idx_mv_trending_city_cuisine
ON mv_top_trending_by_city USING GIN (cuisine);
