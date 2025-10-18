-- Compute PlaceAggregation with improved scoring formulas
--
-- IMPROVEMENTS:
-- 1. Wilson Score Interval (Bayesian smoothing) for iconic score
--    - Prevents 1-mention flukes from beating real consensus
--    - Uses lower bound of 95% confidence interval
--    - Treats upvotes as "successes" out of "trials" (views proxy)
--
-- 2. Exponential Decay for trending score
--    - Half-life of 14 days (configurable)
--    - Smooth degradation vs. hard 90-day cutoff
--    - Recent mentions weighted much higher
--
-- 3. Minimum sample size filtering
--    - Require at least 3 mentions for iconic ranking
--    - Require at least 2 mentions in last 90 days for trending

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
    SUM(GREATEST(score,0)) FILTER (WHERE ts >= NOW() - INTERVAL '90 days')::int AS upvotes_90d,
    -- For Wilson score: calculate avg engagement per mention
    AVG(GREATEST(score,0))::numeric     AS avg_score_per_mention,
    -- For exponential decay: calculate weighted recent score
    SUM(
      GREATEST(score, 0)::numeric *
      EXP(-LN(2) * EXTRACT(EPOCH FROM (NOW() - ts)) / (14 * 86400))
    )::numeric AS decay_weighted_score
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

    -- ICONIC SCORE: Wilson Score Lower Bound + Thread Diversity Bonus
    --
    -- Wilson Score Interval (95% confidence):
    -- Treats engagement as binomial: upvote_rate = upvotes / (mentions * assumed_avg_views)
    -- Assumed avg views per mention: 100 (conservative proxy)
    -- Lower bound penalizes low-sample outliers
    --
    -- Formula: (p + z²/2n - z√(p(1-p)/n + z²/4n²)) / (1 + z²/n)
    -- Where: p = success_rate, n = trials, z = 1.96 (95% confidence)
    --
    CASE
      WHEN b.total_mentions < 3 THEN 0  -- Require minimum sample
      ELSE (
        -- Base Wilson score component
        GREATEST(
          0,
          (
            (b.total_upvotes::numeric / (b.total_mentions * 100.0) + 1.96 * 1.96 / (2.0 * b.total_mentions * 100.0))
            - 1.96 * SQRT(
                (b.total_upvotes::numeric / (b.total_mentions * 100.0)) *
                (1.0 - b.total_upvotes::numeric / (b.total_mentions * 100.0)) / (b.total_mentions * 100.0) +
                1.96 * 1.96 / (4.0 * b.total_mentions * b.total_mentions * 100.0 * 100.0)
              )
          ) / (1.0 + 1.96 * 1.96 / (b.total_mentions * 100.0))
        ) * 1000000  -- Scale to readable range

        -- Thread diversity bonus: more independent discussions = higher quality signal
        + (b.unique_threads * 50)

        -- Mention volume bonus (but less weight than before)
        + (b.total_mentions * 5)

        -- Mild age normalization (favor recent over ancient with same engagement)
        / GREATEST(
            LOG(EXTRACT(EPOCH FROM (NOW() - '2020-01-01'::timestamptz)) / 86400 + 2),
            1
          )
      )
    END AS iconic_score,

    -- TRENDING SCORE: Exponential Decay with Half-Life = 14 days
    --
    -- Formula: Σ(score_i * e^(-ln(2) * days_ago / 14))
    -- Each mention's contribution decays by 50% every 14 days
    -- Smooth degradation vs hard cutoff
    --
    CASE
      WHEN b.mentions_90d < 2 THEN 0  -- Require recent activity
      ELSE (
        -- Decay-weighted engagement (already computed in base CTE)
        b.decay_weighted_score * 100  -- Scale to readable range

        -- Recency multiplier: boost very recent activity
        * CASE
            WHEN EXTRACT(EPOCH FROM (NOW() - b.last_seen)) < 86400 THEN 2.0      -- Last 24h: 2x
            WHEN EXTRACT(EPOCH FROM (NOW() - b.last_seen)) < 604800 THEN 1.5     -- Last week: 1.5x
            ELSE 1.0
          END

        -- Thread diversity bonus (same logic as iconic)
        + (b.unique_threads * 20)
      )
    END AS trending_score,

    -- Top snippets (unchanged)
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

-- Show results with comparison to old scoring
SELECT
  COUNT(*) AS aggregated_places,
  COUNT(*) FILTER (WHERE "totalMentions" >= 3) AS places_meeting_iconic_threshold,
  COUNT(*) FILTER (WHERE "mentions90d" >= 2) AS places_meeting_trending_threshold,
  SUM("totalMentions") AS total_mentions_processed,
  ROUND(MAX("iconicScore")::numeric, 2) AS max_iconic_score,
  ROUND(MAX("trendingScore")::numeric, 2) AS max_trending_score,
  ROUND(AVG("iconicScore")::numeric, 2) AS avg_iconic_score,
  ROUND(AVG("trendingScore")::numeric, 2) AS avg_trending_score
FROM "PlaceAggregation";

-- Show top 10 by each metric for sanity check
\echo '\n=== Top 10 Iconic (Wilson-smoothed) ==='
SELECT
  p.name,
  pa."iconicScore"::numeric(10,2),
  pa."totalMentions",
  pa."uniqueThreads",
  pa."totalUpvotes"
FROM "PlaceAggregation" pa
JOIN "Place" p ON p.id = pa."placeId"
ORDER BY pa."iconicScore" DESC
LIMIT 10;

\echo '\n=== Top 10 Trending (Exponential decay, 14d half-life) ==='
SELECT
  p.name,
  pa."trendingScore"::numeric(10,2),
  pa."mentions90d",
  pa."lastSeen",
  EXTRACT(EPOCH FROM (NOW() - pa."lastSeen")) / 86400 AS days_since_last
FROM "PlaceAggregation" pa
JOIN "Place" p ON p.id = pa."placeId"
WHERE pa."mentions90d" >= 2
ORDER BY pa."trendingScore" DESC
LIMIT 10;
