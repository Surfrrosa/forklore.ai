/**
 * Wilson Score + Bayesian Smoothing + Exponential Decay
 *
 * Formulas documented in config/tuning.json
 *
 * ICONIC SCORE (All-time quality):
 *   1. raw_score = (unique_threads * alpha + total_mentions * beta + total_upvotes) / (unique_threads + prior_n)
 *   2. p_hat = raw_score / max(raw_score)  // Normalize to [0,1]
 *   3. wilson_lower = Wilson lower bound with confidence z
 *   4. iconic_score = wilson_lower * 100
 *
 * TRENDING SCORE (Recency-weighted):
 *   1. For each mention: weight = exp(-ln(2) * age_days / half_life) * recency_multiplier
 *   2. raw_score = sum(weight * (1 + score * upvote_boost))
 *   3. Apply Wilson smoothing as above
 *   4. trending_score = wilson_lower * 100
 */

import tuning from '../config/tuning.json';

/**
 * Wilson score lower bound
 * https://www.evanmiller.org/how-not-to-sort-by-average-rating.html
 *
 * @param p_hat - Observed proportion (normalized score)
 * @param n - Sample size (with priors)
 * @param z - Confidence level (1.96 for 95%)
 */
export function wilsonLowerBound(p_hat: number, n: number, z: number = 1.96): number {
  if (n === 0) return 0;

  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = p_hat + z2 / (2 * n);
  const margin = z * Math.sqrt((p_hat * (1 - p_hat) + z2 / (4 * n)) / n);

  return Math.max(0, (center - margin) / denominator);
}

/**
 * Exponential decay weight
 *
 * @param age_days - Age in days
 * @param half_life_days - Half-life for decay (default: 14)
 */
export function exponentialDecayWeight(age_days: number, half_life_days: number = 14): number {
  return Math.exp(-Math.LN2 * age_days / half_life_days);
}

/**
 * Recency multiplier based on age buckets
 */
export function recencyMultiplier(age_days: number): number {
  const multipliers = tuning.scoring.trending.recency_multipliers;

  if (age_days < 1) return multipliers.last_24h;
  if (age_days < 7) return multipliers.last_7d;
  return multipliers.older;
}

/**
 * SQL fragment for Wilson-scored iconic ranking
 *
 * This generates the SQL to compute iconic_score using:
 * 1. Raw score with Bayesian smoothing
 * 2. Normalization (requires window function for max)
 * 3. Wilson lower bound
 */
export function iconicScoreSQL(): string {
  const cfg = tuning.scoring.iconic;

  return `
    -- Step 1: Compute raw score with Bayesian smoothing
    WITH raw_scores AS (
      SELECT
        place_id,
        unique_threads,
        total_mentions,
        total_upvotes,
        (
          unique_threads * ${cfg.alpha_thread_weight} +
          total_mentions * ${cfg.beta_mention_weight} +
          total_upvotes
        )::float / GREATEST(unique_threads + ${cfg.prior_n}, 1) as raw_score
      FROM place_aggregates
    ),
    -- Step 2: Normalize to [0,1]
    normalized AS (
      SELECT
        place_id,
        unique_threads,
        raw_score,
        CASE
          WHEN MAX(raw_score) OVER () > 0
          THEN raw_score / MAX(raw_score) OVER ()
          ELSE 0
        END as p_hat
      FROM raw_scores
    )
    -- Step 3: Apply Wilson lower bound
    SELECT
      place_id,
      CASE
        WHEN unique_threads + ${cfg.prior_n} >= ${cfg.min_mentions}
        THEN (
          (p_hat + ${cfg.wilson_confidence * cfg.wilson_confidence} / (2 * (unique_threads + ${cfg.prior_n})) -
           ${cfg.wilson_confidence} * SQRT(
             (p_hat * (1 - p_hat) + ${cfg.wilson_confidence * cfg.wilson_confidence} / (4 * (unique_threads + ${cfg.prior_n}))) /
             (unique_threads + ${cfg.prior_n})
           )) /
          (1 + ${cfg.wilson_confidence * cfg.wilson_confidence} / (unique_threads + ${cfg.prior_n}))
        ) * 100
        ELSE 0
      END as iconic_score
    FROM normalized
  `;
}

/**
 * SQL fragment for exponential-decay trending score
 *
 * This generates the SQL to compute trending_score using:
 * 1. Per-mention exponential decay weights
 * 2. Upvote boost
 * 3. Aggregate weighted score
 * 4. Wilson smoothing
 */
export function trendingScoreSQL(): string {
  const cfg = tuning.scoring.trending;
  const half_life = cfg.half_life_days;
  const lookback = cfg.lookback_days;
  const upvote_boost = cfg.upvote_boost_factor;

  return `
    -- Step 1: Compute weighted scores per mention with exponential decay
    WITH mention_weights AS (
      SELECT
        place_id,
        post_id,
        score,
        EXTRACT(EPOCH FROM (NOW() - ts)) / 86400.0 as age_days,
        EXP(-LN(2) * EXTRACT(EPOCH FROM (NOW() - ts)) / 86400.0 / ${half_life}) as decay_weight,
        CASE
          WHEN EXTRACT(EPOCH FROM (NOW() - ts)) / 86400.0 < 1 THEN ${cfg.recency_multipliers.last_24h}
          WHEN EXTRACT(EPOCH FROM (NOW() - ts)) / 86400.0 < 7 THEN ${cfg.recency_multipliers.last_7d}
          ELSE ${cfg.recency_multipliers.older}
        END as recency_mult
      FROM "RedditMention"
      WHERE ts > NOW() - INTERVAL '${lookback} days'
    ),
    -- Step 2: Aggregate weighted scores
    place_weighted_scores AS (
      SELECT
        place_id,
        COUNT(DISTINCT post_id) as unique_threads_90d,
        SUM(
          decay_weight * recency_mult * (1 + GREATEST(score, 0) * ${upvote_boost})
        ) as raw_score
      FROM mention_weights
      GROUP BY place_id
    ),
    -- Step 3: Normalize
    normalized AS (
      SELECT
        place_id,
        unique_threads_90d,
        raw_score,
        CASE
          WHEN MAX(raw_score) OVER () > 0
          THEN raw_score / MAX(raw_score) OVER ()
          ELSE 0
        END as p_hat
      FROM place_weighted_scores
    )
    -- Step 4: Apply Wilson lower bound
    SELECT
      place_id,
      CASE
        WHEN unique_threads_90d >= ${cfg.min_mentions_90d}
        THEN (
          (p_hat + ${tuning.scoring.iconic.wilson_confidence ** 2} / (2 * unique_threads_90d) -
           ${tuning.scoring.iconic.wilson_confidence} * SQRT(
             (p_hat * (1 - p_hat) + ${tuning.scoring.iconic.wilson_confidence ** 2} / (4 * unique_threads_90d)) /
             unique_threads_90d
           )) /
          (1 + ${tuning.scoring.iconic.wilson_confidence ** 2} / unique_threads_90d)
        ) * 100
        ELSE 0
      END as trending_score
    FROM normalized
  `;
}
