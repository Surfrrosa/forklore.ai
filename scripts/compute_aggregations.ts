#!/usr/bin/env tsx
/**
 * Compute aggregation scores for all places with Reddit mentions
 *
 * Uses the same logic as the worker's compute_aggregations job handler
 */

import prisma from '../lib/prisma';

async function main() {
  const cityId = process.argv[2];

  if (!cityId) {
    console.error('Usage: npx tsx scripts/compute_aggregations.ts <city-id>');
    process.exit(1);
  }

  console.log(`\nComputing aggregation scores for city: ${cityId}\n`);
  const startTime = Date.now();

  // Get city name
  const city = await prisma.$queryRaw<{ name: string }[]>`
    SELECT name FROM "City" WHERE id = ${cityId} LIMIT 1
  `;

  if (city.length === 0) {
    console.error(`City not found: ${cityId}`);
    process.exit(1);
  }

  console.log(`City: ${city[0].name}`);

  // Compute aggregations using Wilson scoring + exponential decay
  // Formula documented in config/tuning.json
  const result = await prisma.$queryRaw<{ updated: bigint }[]>`
    WITH place_stats AS (
      SELECT
        p.id as place_id,
        COUNT(DISTINCT rm.post_id) as unique_threads,
        COUNT(*) as total_mentions,
        COALESCE(SUM(rm.score), 0) as total_upvotes,
        COUNT(*) FILTER (WHERE rm.ts > NOW() - INTERVAL '90 days') as mentions_90d,
        MAX(rm.ts) as last_seen,
        -- Iconic: raw score with Bayesian smoothing
        (
          COUNT(DISTINCT rm.post_id) * 8.0 +
          COUNT(*) * 2.0 +
          COALESCE(SUM(rm.score), 0)
        ) / GREATEST(COUNT(DISTINCT rm.post_id) + 10.0, 1) as iconic_raw,
        -- Trending: exponential decay (14-day half-life) + recency boost
        SUM(
          CASE WHEN rm.ts > NOW() - INTERVAL '90 days' THEN
            EXP(-LN(2) * EXTRACT(EPOCH FROM (NOW() - rm.ts)) / 86400.0 / 14.0) *
            CASE
              WHEN EXTRACT(EPOCH FROM (NOW() - rm.ts)) / 86400.0 < 1 THEN 2.0
              WHEN EXTRACT(EPOCH FROM (NOW() - rm.ts)) / 86400.0 < 7 THEN 1.5
              ELSE 1.0
            END *
            (1 + GREATEST(rm.score, 0) * 0.02)
          ELSE 0 END
        ) as trending_raw
      FROM "Place" p
      LEFT JOIN "RedditMention" rm ON rm.place_id = p.id
      WHERE p.city_id = ${cityId}
        AND p.status = 'open'
      GROUP BY p.id
      HAVING COUNT(rm.id) > 0
    ),
    normalized AS (
      SELECT
        place_id,
        unique_threads,
        total_mentions,
        total_upvotes,
        mentions_90d,
        last_seen,
        iconic_raw,
        trending_raw,
        -- Normalize to [0,1]
        CASE WHEN MAX(iconic_raw) OVER () > 0
          THEN iconic_raw / MAX(iconic_raw) OVER ()
          ELSE 0 END as iconic_p_hat,
        CASE WHEN MAX(trending_raw) OVER () > 0
          THEN trending_raw / MAX(trending_raw) OVER ()
          ELSE 0 END as trending_p_hat
      FROM place_stats
    )
    INSERT INTO "PlaceAggregation" (
      place_id, iconic_score, trending_score,
      unique_threads, total_mentions, total_upvotes,
      mentions_90d, last_seen, top_snippets, computed_at
    )
    SELECT
      n.place_id,
      -- Wilson lower bound for iconic (z=1.96, prior_n=10, min=3)
      CASE WHEN n.unique_threads + 10 >= 3 THEN
        (
          (n.iconic_p_hat + 3.8416 / (2 * (n.unique_threads + 10)) -
           1.96 * SQRT(
             (n.iconic_p_hat * (1 - n.iconic_p_hat) + 3.8416 / (4 * (n.unique_threads + 10))) /
             (n.unique_threads + 10)
           )) /
          (1 + 3.8416 / (n.unique_threads + 10))
        ) * 100
      ELSE 0 END as iconic_score,
      -- Wilson lower bound for trending (z=1.96, min=2 mentions in 90d)
      CASE WHEN n.mentions_90d >= 2 THEN
        (
          (n.trending_p_hat + 3.8416 / (2 * GREATEST(n.mentions_90d, 1)) -
           1.96 * SQRT(
             (n.trending_p_hat * (1 - n.trending_p_hat) + 3.8416 / (4 * GREATEST(n.mentions_90d, 1))) /
             GREATEST(n.mentions_90d, 1)
           )) /
          (1 + 3.8416 / GREATEST(n.mentions_90d, 1))
        ) * 100
      ELSE 0 END as trending_score,
      n.unique_threads,
      n.total_mentions,
      n.total_upvotes,
      n.mentions_90d,
      n.last_seen,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'permalink', rm2.permalink,
            'score', rm2.score,
            'ts', rm2.ts
          ) ORDER BY rm2.score DESC
        )
        FROM (
          SELECT permalink, score, ts
          FROM "RedditMention"
          WHERE place_id = n.place_id
          ORDER BY score DESC
          LIMIT 3
        ) rm2
      ) as top_snippets,
      NOW() as computed_at
    FROM normalized n
    ON CONFLICT (place_id)
    DO UPDATE SET
      iconic_score = EXCLUDED.iconic_score,
      trending_score = EXCLUDED.trending_score,
      unique_threads = EXCLUDED.unique_threads,
      total_mentions = EXCLUDED.total_mentions,
      total_upvotes = EXCLUDED.total_upvotes,
      mentions_90d = EXCLUDED.mentions_90d,
      last_seen = EXCLUDED.last_seen,
      top_snippets = EXCLUDED.top_snippets,
      computed_at = EXCLUDED.computed_at
    RETURNING place_id
  `;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${elapsed}s`);
  console.log(`Places updated: ${result.length}`);

  // Show top 10 by iconic score
  const top10 = await prisma.$queryRaw<{
    name: string;
    iconic_score: number;
    trending_score: number;
    total_mentions: number;
    unique_threads: number;
  }[]>`
    SELECT
      p.name,
      pa.iconic_score,
      pa.trending_score,
      pa.total_mentions,
      pa.unique_threads
    FROM "PlaceAggregation" pa
    JOIN "Place" p ON p.id = pa.place_id
    WHERE p.city_id = ${cityId}
    ORDER BY pa.iconic_score DESC
    LIMIT 10
  `;

  console.log(`\nTop 10 by Iconic Score:`);
  for (const place of top10) {
    console.log(`  ${place.name}`);
    console.log(`    Iconic: ${Number(place.iconic_score).toFixed(2)}, Trending: ${Number(place.trending_score).toFixed(2)}`);
    console.log(`    Mentions: ${place.total_mentions}, Threads: ${place.unique_threads}`);
  }

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('\nError:', error);
  process.exit(1);
});
