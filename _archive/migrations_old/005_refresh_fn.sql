-- Create helper function to refresh all materialized views
-- Call this after updating PlaceAggregation
-- Now supports CONCURRENTLY (zero-downtime) after unique indexes added

CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE 'Refreshing materialized views (CONCURRENTLY)...';
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_iconic_by_city;
  RAISE NOTICE '  ✓ mv_top_iconic_by_city refreshed';
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_trending_by_city;
  RAISE NOTICE '  ✓ mv_top_trending_by_city refreshed';
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_by_cuisine;
  RAISE NOTICE '  ✓ mv_top_by_cuisine refreshed';
  RAISE NOTICE 'All materialized views refreshed successfully!';
END$$;
