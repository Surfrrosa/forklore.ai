-- Migration 003: Scoring functions (Wilson Score + Exponential Decay)
-- Author: Production rebuild
-- Date: 2025-10-18
-- Reference: config/tuning.json for constants

-- Wilson Score Lower Bound (Bayesian smoothing)
-- Prevents flukes by using confidence interval lower bound
CREATE OR REPLACE FUNCTION wilson_score_lower_bound(
  upvotes NUMERIC,
  total_trials NUMERIC,
  confidence NUMERIC DEFAULT 1.96  -- 95% confidence = 1.96 std devs
)
RETURNS NUMERIC AS $$
DECLARE
  p NUMERIC;  -- proportion
  z NUMERIC;  -- z-score
  denominator NUMERIC;
BEGIN
  IF total_trials = 0 THEN
    RETURN 0;
  END IF;

  p := upvotes / total_trials;
  z := confidence;
  denominator := 1 + (z * z) / total_trials;

  RETURN (
    (p + (z * z) / (2 * total_trials) - z * SQRT((p * (1 - p) + (z * z) / (4 * total_trials)) / total_trials))
    / denominator
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION wilson_score_lower_bound IS 'Wilson Score lower bound for Bayesian ranking (prevents flukes)';

-- Compute iconic score for a place
-- Formula: bayesian_mean(upvotes, priors) + thread_bonus + mention_bonus / time_norm
CREATE OR REPLACE FUNCTION compute_iconic_score(
  place_id_input TEXT,
  alpha NUMERIC DEFAULT 8,     -- thread weight
  beta NUMERIC DEFAULT 2,      -- mention weight
  prior_mu NUMERIC DEFAULT 3,  -- prior mean upvotes
  prior_n NUMERIC DEFAULT 10   -- prior sample size
)
RETURNS NUMERIC AS $$
DECLARE
  total_upvotes NUMERIC;
  total_mentions NUMERIC;
  unique_threads NUMERIC;
  first_seen TIMESTAMPTZ;
  days_since_epoch NUMERIC;
  time_norm NUMERIC;
  wilson_component NUMERIC;
  iconic NUMERIC;
BEGIN
  -- Aggregate mention stats
  SELECT
    COALESCE(SUM(score), 0),
    COUNT(*),
    COUNT(DISTINCT post_id),
    MIN(ts)
  INTO total_upvotes, total_mentions, unique_threads, first_seen
  FROM "RedditMention"
  WHERE place_id = place_id_input;

  -- Minimum threshold
  IF total_mentions < 3 THEN
    RETURN 0;
  END IF;

  -- Calculate Wilson Score component (Bayesian smoothing)
  wilson_component := wilson_score_lower_bound(
    total_upvotes + prior_mu * prior_n,
    total_mentions * 100 + prior_n,
    1.96
  );

  -- Time normalization (log decay from 2015 epoch)
  days_since_epoch := EXTRACT(EPOCH FROM (first_seen - '2015-01-01'::TIMESTAMPTZ)) / 86400;
  time_norm := GREATEST(LOG(days_since_epoch + 2), 1);

  -- Combine components
  iconic := (
    wilson_component * 1000000  -- Scale to readable range
    + alpha * unique_threads
    + beta * total_mentions
  ) / time_norm;

  RETURN ROUND(iconic, 2);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION compute_iconic_score IS 'Compute Wilson-smoothed iconic score with thread/mention bonuses';

-- Compute trending score for a place
-- Formula: Σ(mention_weight * decay(t)) * recency_multiplier + thread_bonus
CREATE OR REPLACE FUNCTION compute_trending_score(
  place_id_input TEXT,
  half_life_days NUMERIC DEFAULT 14,  -- 14-day half-life
  thread_weight NUMERIC DEFAULT 20,   -- thread bonus
  lookback_days INT DEFAULT 90        -- 90-day window
)
RETURNS NUMERIC AS $$
DECLARE
  now_ts TIMESTAMPTZ := NOW();
  cutoff_ts TIMESTAMPTZ := NOW() - (lookback_days || ' days')::INTERVAL;
  decay_sum NUMERIC := 0;
  unique_threads INT := 0;
  last_seen TIMESTAMPTZ;
  recency_mult NUMERIC := 1.0;
  mention RECORD;
BEGIN
  -- Count unique threads
  SELECT COUNT(DISTINCT post_id), MAX(ts)
  INTO unique_threads, last_seen
  FROM "RedditMention"
  WHERE place_id = place_id_input
    AND ts >= cutoff_ts;

  -- Minimum threshold
  IF unique_threads < 2 THEN
    RETURN 0;
  END IF;

  -- Sum decay-weighted mentions
  FOR mention IN
    SELECT score, ts
    FROM "RedditMention"
    WHERE place_id = place_id_input
      AND ts >= cutoff_ts
  LOOP
    DECLARE
      days_ago NUMERIC := EXTRACT(EPOCH FROM (now_ts - mention.ts)) / 86400;
      mention_weight NUMERIC := 1 + 0.02 * mention.score;  -- Upvote boost
      decay_factor NUMERIC := POWER(0.5, days_ago / half_life_days);
    BEGIN
      decay_sum := decay_sum + (mention_weight * decay_factor);
    END;
  END LOOP;

  -- Recency multiplier
  IF last_seen >= now_ts - INTERVAL '1 day' THEN
    recency_mult := 2.0;
  ELSIF last_seen >= now_ts - INTERVAL '7 days' THEN
    recency_mult := 1.5;
  END IF;

  RETURN ROUND(
    (decay_sum * 100 * recency_mult) + (thread_weight * unique_threads),
    2
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION compute_trending_score IS 'Compute exponential-decay trending score (14d half-life, 90d window)';

-- Batch compute all place aggregations
CREATE OR REPLACE FUNCTION compute_all_place_aggregations()
RETURNS TABLE (place_id TEXT, iconic NUMERIC, trending NUMERIC, updated INT) AS $$
DECLARE
  place_record RECORD;
  iconic_val NUMERIC;
  trending_val NUMERIC;
  count INT := 0;
BEGIN
  FOR place_record IN
    SELECT DISTINCT p.id
    FROM "Place" p
    WHERE p.status = 'open'
  LOOP
    -- Compute scores
    iconic_val := compute_iconic_score(place_record.id);
    trending_val := compute_trending_score(place_record.id);

    -- Upsert aggregation
    INSERT INTO "PlaceAggregation" AS pa (
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
      place_record.id,
      iconic_val,
      trending_val,
      COUNT(DISTINCT post_id),
      COUNT(*),
      SUM(score),
      SUM(CASE WHEN ts >= NOW() - INTERVAL '90 days' THEN 1 ELSE 0 END),
      MAX(ts),
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'permalink', permalink,
            'score', score,
            'ts', ts,
            'excerpt_hash', encode(text_hash, 'hex'),
            'excerpt_len', text_len
          ) ORDER BY score DESC
        )
        FROM (
          SELECT permalink, score, ts, text_hash, text_len
          FROM "RedditMention"
          WHERE place_id = place_record.id
          ORDER BY score DESC
          LIMIT 3
        ) top_3
      ),
      NOW()
    FROM "RedditMention"
    WHERE place_id = place_record.id
    ON CONFLICT (place_id) DO UPDATE
      SET iconic_score = EXCLUDED.iconic_score,
          trending_score = EXCLUDED.trending_score,
          unique_threads = EXCLUDED.unique_threads,
          total_mentions = EXCLUDED.total_mentions,
          total_upvotes = EXCLUDED.total_upvotes,
          mentions_90d = EXCLUDED.mentions_90d,
          last_seen = EXCLUDED.last_seen,
          top_snippets = EXCLUDED.top_snippets,
          computed_at = EXCLUDED.computed_at;

    count := count + 1;

    RETURN QUERY SELECT place_record.id, iconic_val, trending_val, count;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION compute_all_place_aggregations IS 'Batch compute/update all place aggregations (idempotent)';
