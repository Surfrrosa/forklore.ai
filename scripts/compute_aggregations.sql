-- Compute place aggregations using scoring functions
-- Wired to config/tuning.json via function parameters
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/compute_aggregations.sql
--   OR call compute_all_place_aggregations() from job handler

-- Truncate and recompute all aggregations
TRUNCATE TABLE "PlaceAggregation";

-- Insert aggregations for all places with mentions
INSERT INTO "PlaceAggregation" (
  place_id,
  iconic_score,
  trending_score,
  unique_threads,
  total_mentions,
  total_upvotes,
  mentions_90d,
  last_seen,
  top_snippets,
  computed_at
)
SELECT
  place_id,
  compute_iconic_score(place_id) as iconic_score,
  compute_trending_score(place_id) as trending_score,
  COUNT(DISTINCT post_id) as unique_threads,
  COUNT(*) as total_mentions,
  SUM(score) as total_upvotes,
  COUNT(*) FILTER (WHERE ts >= NOW() - INTERVAL '90 days') as mentions_90d,
  MAX(ts) as last_seen,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'permalink', rm2.permalink,
        'score', rm2.score,
        'ts', rm2.ts,
        'text_len', rm2.text_len
      )
      ORDER BY rm2.score DESC, rm2.ts DESC
    )
    FROM (
      SELECT permalink, score, ts, text_len
      FROM "RedditMention"
      WHERE place_id = rm.place_id
      ORDER BY score DESC, ts DESC
      LIMIT 5
    ) rm2
  ) as top_snippets,
  NOW() as computed_at
FROM "RedditMention" rm
GROUP BY place_id
HAVING COUNT(*) >= 3;  -- Minimum 3 mentions required

-- Refresh materialized views after aggregation
SELECT refresh_all_materialized_views();

-- Show summary
SELECT
  COUNT(*) as places_with_scores,
  AVG(iconic_score) as avg_iconic,
  AVG(trending_score) as avg_trending,
  SUM(total_mentions) as total_mentions
FROM "PlaceAggregation";
