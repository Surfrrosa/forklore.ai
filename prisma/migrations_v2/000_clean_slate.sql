-- Migration 000: Clean slate - drop all old schema
-- WARNING: This destroys all data
-- Date: 2025-10-18

-- Drop materialized views first
DROP MATERIALIZED VIEW IF EXISTS mv_top_by_cuisine CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_top_iconic_by_city CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_top_trending_by_city CASCADE;

-- Drop tables (CASCADE removes dependent objects)
DROP TABLE IF EXISTS "JobQueue" CASCADE;
DROP TABLE IF EXISTS "MaterializedViewVersion" CASCADE;
DROP TABLE IF EXISTS "PlaceAggregation" CASCADE;
DROP TABLE IF EXISTS "RedditMention" CASCADE;
DROP TABLE IF EXISTS "Place" CASCADE;
DROP TABLE IF EXISTS "CityAlias" CASCADE;
DROP TABLE IF EXISTS "Subreddit" CASCADE;
DROP TABLE IF EXISTS "City" CASCADE;
DROP TABLE IF EXISTS "_prisma_migrations" CASCADE;

-- Drop any old functions
DROP FUNCTION IF EXISTS match_place_for_text CASCADE;
DROP FUNCTION IF EXISTS wilson_score_lower_bound CASCADE;
DROP FUNCTION IF EXISTS compute_iconic_score CASCADE;
DROP FUNCTION IF EXISTS compute_trending_score CASCADE;
DROP FUNCTION IF EXISTS compute_all_place_aggregations CASCADE;
DROP FUNCTION IF EXISTS refresh_all_materialized_views CASCADE;

-- Drop any old types
DROP TYPE IF EXISTS job_status CASCADE;
DROP TYPE IF EXISTS place_source CASCADE;
DROP TYPE IF EXISTS place_status CASCADE;

-- Verify clean slate
SELECT 'Database wiped clean - ready for production schema' AS status;
