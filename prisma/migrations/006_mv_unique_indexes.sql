-- Add unique indexes to materialized views for CONCURRENTLY refresh support
-- This enables zero-downtime view refreshes in production

-- Iconic view: unique on (city_id, place_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_iconic_unique
  ON mv_top_iconic_by_city (city_id, place_id);

-- Trending view: unique on (city_id, place_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_trending_unique
  ON mv_top_trending_by_city (city_id, place_id);

-- Cuisine view: unique on (city_id, cuisine_type, place_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_cuisine_unique
  ON mv_top_by_cuisine (city_id, cuisine_type, place_id);

-- Verify indexes
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename LIKE 'mv_%'
ORDER BY tablename, indexname;
