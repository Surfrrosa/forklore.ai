-- Compute PlaceAggregation from RedditMention data
-- This calculates iconic and trending scores based on mention frequency, upvotes, and recency

WITH m AS (
  SELECT
    "placeId",
    subreddit,
    "postId",
    "commentId",
    score,
    timestamp AS ts,
    snippet
  FROM "RedditMention"
  WHERE "placeId" IS NOT NULL
)
, base AS (
  SELECT
    "placeId",
    COUNT(*)                            AS total_mentions,
    COUNT(DISTINCT "postId")            AS unique_threads,
    SUM(GREATEST(score,0))::int         AS total_upvotes,
    MAX(ts)                             AS last_seen,
    COUNT(*) FILTER (WHERE ts >= NOW() - INTERVAL '90 days')::int               AS mentions_90d,
    SUM(GREATEST(score,0)) FILTER (WHERE ts >= NOW() - INTERVAL '90 days')::int AS upvotes_90d
  FROM m
  GROUP BY "placeId"
)
, top_snips AS (
  SELECT
    "placeId",
    jsonb_agg(
      jsonb_build_object(
        'subreddit', subreddit,
        'score', score,
        'timestamp', ts,
        'text', left(snippet, 240),
        'postId', "postId",
        'commentId', "commentId"
      ) ORDER BY score DESC, ts DESC
    ) FILTER (WHERE score >= 1) AS snippets
  FROM (
    SELECT DISTINCT ON ("placeId", "postId", "commentId")
      "placeId", subreddit, "postId", "commentId", score, ts, snippet
    FROM m
    WHERE score >= 1
    ORDER BY "placeId", "postId", "commentId", score DESC
    LIMIT 1000
  ) top_mentions
  GROUP BY "placeId"
)
, scored AS (
  SELECT
    b."placeId",
    b.total_mentions,
    b.unique_threads,
    b.total_upvotes,
    b.last_seen,
    b.mentions_90d,
    b.upvotes_90d,
    -- Iconic: long-horizon popularity with mild age normalization
    ((b.total_mentions * 10) + (b.unique_threads * 50) + (b.total_upvotes * 2))::numeric
      / GREATEST(LOG(EXTRACT(EPOCH FROM (NOW() - '2015-01-01'::timestamptz)) / 86400 + 2), 1)         AS iconic_score,
    -- Trending: recent action with recency emphasis
    CASE
      WHEN b.last_seen IS NULL OR b.mentions_90d = 0 THEN 0::numeric
      ELSE ((b.mentions_90d * 20) + (b.upvotes_90d * 3))::numeric
        / GREATEST(EXTRACT(EPOCH FROM (NOW() - b.last_seen)) / 86400, 0.5)
    END AS trending_score,
    -- Get top 3 snippets
    COALESCE(
      (SELECT jsonb_agg(s) FROM (
        SELECT jsonb_array_elements(t.snippets) AS s
        FROM top_snips t
        WHERE t."placeId" = b."placeId"
        LIMIT 3
      ) top3),
      '[]'::jsonb
    ) AS top_snippets
  FROM base b
)
INSERT INTO "PlaceAggregation" (
  "placeId", "iconicScore", "trendingScore",
  "uniqueThreads", "totalMentions", "totalUpvotes",
  "lastSeen", "mentions90d", "topSnippets", "computedAt"
)
SELECT
  s."placeId",
  s.iconic_score,
  s.trending_score,
  s.unique_threads,
  s.total_mentions,
  s.total_upvotes,
  s.last_seen,
  s.mentions_90d,
  s.top_snippets,
  NOW()
FROM scored s
ON CONFLICT ("placeId") DO UPDATE
SET "iconicScore"=EXCLUDED."iconicScore",
    "trendingScore"=EXCLUDED."trendingScore",
    "uniqueThreads"=EXCLUDED."uniqueThreads",
    "totalMentions"=EXCLUDED."totalMentions",
    "totalUpvotes"=EXCLUDED."totalUpvotes",
    "lastSeen"=EXCLUDED."lastSeen",
    "mentions90d"=EXCLUDED."mentions90d",
    "topSnippets"=EXCLUDED."topSnippets",
    "computedAt"=EXCLUDED."computedAt";

-- Show results
SELECT
  COUNT(*) AS aggregated_places,
  SUM("totalMentions") AS total_mentions_processed,
  MAX("iconicScore") AS max_iconic_score,
  MAX("trendingScore") AS max_trending_score
FROM "PlaceAggregation";
