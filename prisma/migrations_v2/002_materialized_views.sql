-- Migration 002: Materialized views for fast ranking queries
-- Author: Production rebuild
-- Date: 2025-10-18

-- Materialized view: Top iconic places by city
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_iconic_by_city AS
SELECT
  p.id AS place_id,
  p.city_id,
  p.name,
  p.cuisine,
  p.address,
  ST_Y(p.geog::geometry) AS lat,
  ST_X(p.geog::geometry) AS lon,
  COALESCE(pa.iconic_score, 0) AS iconic_score,
  COALESCE(pa.unique_threads, 0) AS unique_threads,
  COALESCE(pa.total_mentions, 0) AS total_mentions,
  COALESCE(pa.total_upvotes, 0) AS total_upvotes,
  pa.last_seen,
  COALESCE(pa.top_snippets, '[]'::jsonb) AS top_snippets,
  ROW_NUMBER() OVER (
    PARTITION BY p.city_id
    ORDER BY COALESCE(pa.iconic_score, 0) DESC, p.name
  ) AS rank
FROM "Place" p
LEFT JOIN "PlaceAggregation" pa ON p.id = pa.place_id
WHERE p.status = 'open'
  AND (pa.total_mentions IS NULL OR pa.total_mentions >= 3); -- Min threshold for iconic

-- Covering index for fast pagination
CREATE UNIQUE INDEX idx_mv_iconic_covering ON mv_top_iconic_by_city (
  city_id, rank
) INCLUDE (place_id, name, cuisine, address, lat, lon, iconic_score, unique_threads, total_mentions);

CREATE INDEX idx_mv_iconic_score ON mv_top_iconic_by_city (city_id, iconic_score DESC);

COMMENT ON MATERIALIZED VIEW mv_top_iconic_by_city IS 'Pre-ranked iconic places by city (Wilson-smoothed all-time rankings)';

-- Materialized view: Top trending places by city
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_trending_by_city AS
SELECT
  p.id AS place_id,
  p.city_id,
  p.name,
  p.cuisine,
  p.address,
  ST_Y(p.geog::geometry) AS lat,
  ST_X(p.geog::geometry) AS lon,
  COALESCE(pa.trending_score, 0) AS trending_score,
  COALESCE(pa.mentions_90d, 0) AS mentions_90d,
  pa.last_seen,
  COALESCE(pa.top_snippets, '[]'::jsonb) AS top_snippets,
  ROW_NUMBER() OVER (
    PARTITION BY p.city_id
    ORDER BY COALESCE(pa.trending_score, 0) DESC, p.name
  ) AS rank
FROM "Place" p
LEFT JOIN "PlaceAggregation" pa ON p.id = pa.place_id
WHERE p.status = 'open'
  AND (pa.mentions_90d IS NULL OR pa.mentions_90d >= 2); -- Min threshold for trending

-- Covering index
CREATE UNIQUE INDEX idx_mv_trending_covering ON mv_top_trending_by_city (
  city_id, rank
) INCLUDE (place_id, name, cuisine, address, lat, lon, trending_score, mentions_90d);

CREATE INDEX idx_mv_trending_score ON mv_top_trending_by_city (city_id, trending_score DESC);

COMMENT ON MATERIALIZED VIEW mv_top_trending_by_city IS 'Pre-ranked trending places by city (exponential decay, 90d window)';

-- Materialized view: Top places by cuisine
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_by_cuisine AS
SELECT
  p.id AS place_id,
  p.city_id,
  p.name,
  unnest(p.cuisine) AS cuisine_type,
  p.address,
  ST_Y(p.geog::geometry) AS lat,
  ST_X(p.geog::geometry) AS lon,
  COALESCE(pa.iconic_score, 0) AS iconic_score,
  COALESCE(pa.total_mentions, 0) AS total_mentions,
  ROW_NUMBER() OVER (
    PARTITION BY p.city_id, unnest(p.cuisine)
    ORDER BY COALESCE(pa.iconic_score, 0) DESC, p.name
  ) AS rank
FROM "Place" p
LEFT JOIN "PlaceAggregation" pa ON p.id = pa.place_id
WHERE p.status = 'open'
  AND cardinality(p.cuisine) > 0;

-- Covering index
CREATE INDEX idx_mv_cuisine_covering ON mv_top_by_cuisine (
  city_id, cuisine_type, rank
) INCLUDE (place_id, name, address, lat, lon, iconic_score);

COMMENT ON MATERIALIZED VIEW mv_top_by_cuisine IS 'Pre-ranked places by city and cuisine type';

-- Function to refresh all materialized views and update version tracking
CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS TABLE (view_name TEXT, row_count BIGINT, duration_ms BIGINT) AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration BIGINT;
  rows BIGINT;
  version TEXT;
BEGIN
  -- Refresh mv_top_iconic_by_city
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_iconic_by_city;
  end_time := clock_timestamp();
  duration := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;
  GET DIAGNOSTICS rows = ROW_COUNT;
  version := md5(random()::text || clock_timestamp()::text);

  INSERT INTO "MaterializedViewVersion" (view_name, version_hash, refreshed_at, row_count)
  VALUES ('mv_top_iconic_by_city', version, NOW(), rows)
  ON CONFLICT (view_name) DO UPDATE
    SET version_hash = EXCLUDED.version_hash,
        refreshed_at = EXCLUDED.refreshed_at,
        row_count = EXCLUDED.row_count;

  RETURN QUERY SELECT 'mv_top_iconic_by_city'::TEXT, rows, duration;

  -- Refresh mv_top_trending_by_city
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_trending_by_city;
  end_time := clock_timestamp();
  duration := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;
  GET DIAGNOSTICS rows = ROW_COUNT;
  version := md5(random()::text || clock_timestamp()::text);

  INSERT INTO "MaterializedViewVersion" (view_name, version_hash, refreshed_at, row_count)
  VALUES ('mv_top_trending_by_city', version, NOW(), rows)
  ON CONFLICT (view_name) DO UPDATE
    SET version_hash = EXCLUDED.version_hash,
        refreshed_at = EXCLUDED.refreshed_at,
        row_count = EXCLUDED.row_count;

  RETURN QUERY SELECT 'mv_top_trending_by_city'::TEXT, rows, duration;

  -- Refresh mv_top_by_cuisine
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_by_cuisine;
  end_time := clock_timestamp();
  duration := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;
  GET DIAGNOSTICS rows = ROW_COUNT;
  version := md5(random()::text || clock_timestamp()::text);

  INSERT INTO "MaterializedViewVersion" (view_name, version_hash, refreshed_at, row_count)
  VALUES ('mv_top_by_cuisine', version, NOW(), rows)
  ON CONFLICT (view_name) DO UPDATE
    SET version_hash = EXCLUDED.version_hash,
        refreshed_at = EXCLUDED.refreshed_at,
        row_count = EXCLUDED.row_count;

  RETURN QUERY SELECT 'mv_top_by_cuisine'::TEXT, rows, duration;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_all_materialized_views() IS 'Refresh all MVs concurrently and track versions for ETags';
