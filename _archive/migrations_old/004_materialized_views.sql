-- Create production materialized views for fast API queries
-- These views pre-compute rankings and are refreshed after aggregation updates

-- ICONIC (all-time rankings)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_iconic_by_city AS
SELECT
  p.id AS place_id,
  p."cityId" AS city_id,
  p.name,
  p.cuisine,
  p.address,
  ST_Y(p.geog::geometry) AS lat,
  ST_X(p.geog::geometry) AS lon,
  agg."iconicScore"      AS iconic_score,
  agg."uniqueThreads"    AS unique_threads,
  agg."totalMentions"    AS total_mentions,
  agg."totalUpvotes"     AS total_upvotes,
  agg."lastSeen"         AS last_seen,
  agg."topSnippets"      AS top_snippets,
  ROW_NUMBER() OVER (
    PARTITION BY p."cityId"
    ORDER BY agg."iconicScore" DESC, agg."totalMentions" DESC
  ) AS rank
FROM "Place" p
JOIN "PlaceAggregation" agg ON p.id = agg."placeId"
WHERE p.status = 'active';

CREATE INDEX IF NOT EXISTS idx_mv_iconic_city_rank
  ON mv_top_iconic_by_city (city_id, rank);

-- TRENDING (recent 90-day rankings)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_trending_by_city AS
SELECT
  p.id AS place_id,
  p."cityId" AS city_id,
  p.name,
  p.cuisine,
  p.address,
  ST_Y(p.geog::geometry) AS lat,
  ST_X(p.geog::geometry) AS lon,
  agg."trendingScore"    AS trending_score,
  agg."mentions90d"      AS mentions_90d,
  agg."lastSeen"         AS last_seen,
  agg."topSnippets"      AS top_snippets,
  ROW_NUMBER() OVER (
    PARTITION BY p."cityId"
    ORDER BY agg."trendingScore" DESC, agg."mentions90d" DESC
  ) AS rank
FROM "Place" p
JOIN "PlaceAggregation" agg ON p.id = agg."placeId"
WHERE p.status = 'active'
  AND agg."mentions90d" > 0;

CREATE INDEX IF NOT EXISTS idx_mv_trending_city_rank
  ON mv_top_trending_by_city (city_id, rank);

-- BY CUISINE (flatten cuisine array and rank within each type)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_by_cuisine AS
SELECT
  p.id AS place_id,
  p."cityId" AS city_id,
  unnest(p.cuisine) AS cuisine_type,
  p.name,
  p.address,
  ST_Y(p.geog::geometry) AS lat,
  ST_X(p.geog::geometry) AS lon,
  agg."iconicScore"      AS iconic_score,
  agg."trendingScore"    AS trending_score,
  agg."totalMentions"    AS total_mentions,
  ROW_NUMBER() OVER (
    PARTITION BY p."cityId", unnest(p.cuisine)
    ORDER BY agg."iconicScore" DESC, agg."totalMentions" DESC
  ) AS rank
FROM "Place" p
JOIN "PlaceAggregation" agg ON p.id = agg."placeId"
WHERE p.status = 'active';

CREATE INDEX IF NOT EXISTS idx_mv_cuisine_city_rank
  ON mv_top_by_cuisine (city_id, cuisine_type, rank);

-- Show counts
SELECT 'Iconic view' AS view_name, COUNT(*) AS rows FROM mv_top_iconic_by_city
UNION ALL
SELECT 'Trending view', COUNT(*) FROM mv_top_trending_by_city
UNION ALL
SELECT 'Cuisine view', COUNT(*) FROM mv_top_by_cuisine;
