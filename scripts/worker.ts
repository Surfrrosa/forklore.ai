#!/usr/bin/env tsx
/**
 * Job worker - processes background jobs from JobQueue
 *
 * Handles:
 * - bootstrap_city: City initialization pipeline
 * - ingest_reddit: Reddit data ingestion for city
 * - compute_aggregations: Compute PlaceAggregation metrics
 * - refresh_mvs: Refresh materialized views
 *
 * Features:
 * - Graceful shutdown (SIGTERM/SIGINT)
 * - Error recovery with retry logic
 * - Atomic job claiming (prevents duplicate processing)
 * - Heartbeat logging for monitoring
 *
 * Usage:
 *   npx tsx scripts/worker.ts
 *   npx tsx scripts/worker.ts --poll-interval 10000
 */

import { processJobs, type JobType } from '../lib/jobs';
import { bootstrapCity } from './bootstrap_city';
import { ingestRedditForCity } from './reddit_ingest';
import prisma from '../lib/prisma';

/**
 * Job handler for bootstrap_city
 */
async function handleBootstrapCity(payload: { cityQuery: string }): Promise<void> {
  console.log(`[worker] Starting bootstrap for: ${payload.cityQuery}`);

  const result = await bootstrapCity(payload.cityQuery);

  console.log(`[worker] Bootstrap complete:`, {
    cityId: result.cityId,
    cityName: result.cityName,
    placesCreated: result.placesCreated,
    placesUpdated: result.placesUpdated,
    elapsed: `${(result.elapsed / 1000).toFixed(1)}s`
  });
}

/**
 * Job handler for ingest_reddit
 */
async function handleIngestReddit(payload: { cityId: string }): Promise<void> {
  console.log(`[worker] Starting Reddit ingestion for city: ${payload.cityId}`);

  const result = await ingestRedditForCity(payload.cityId);

  console.log(`[worker] Reddit ingestion complete:`, {
    cityId: result.cityId,
    cityName: result.cityName,
    mentionsCreated: result.mentionsCreated,
    elapsed: `${(result.elapsed / 1000).toFixed(1)}s`
  });

  // Mark city as ranked (has Reddit data now)
  await prisma.$queryRaw`
    UPDATE "City"
    SET ranked = true
    WHERE id = ${payload.cityId}
  `;

  console.log(`[worker] Marked city ${payload.cityId} as ranked`);
}

/**
 * Job handler for compute_aggregations
 */
async function handleComputeAggregations(payload: { cityId: string }): Promise<void> {
  console.log(`[worker] Computing aggregations for city: ${payload.cityId}`);

  const startTime = Date.now();

  // Compute Wilson-scored aggregations (formula documented in config/tuning.json)
  await prisma.$queryRaw`
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
      WHERE p.city_id = ${payload.cityId}
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
      place_id,
      -- Wilson lower bound for iconic (z=1.96, prior_n=10, min=3)
      CASE WHEN unique_threads + 10 >= 3 THEN
        (
          (iconic_p_hat + 3.8416 / (2 * (unique_threads + 10)) -
           1.96 * SQRT(
             (iconic_p_hat * (1 - iconic_p_hat) + 3.8416 / (4 * (unique_threads + 10))) /
             (unique_threads + 10)
           )) /
          (1 + 3.8416 / (unique_threads + 10))
        ) * 100
      ELSE 0 END as iconic_score,
      -- Wilson lower bound for trending (z=1.96, min=2 mentions in 90d)
      CASE WHEN mentions_90d >= 2 THEN
        (
          (trending_p_hat + 3.8416 / (2 * GREATEST(mentions_90d, 1)) -
           1.96 * SQRT(
             (trending_p_hat * (1 - trending_p_hat) + 3.8416 / (4 * GREATEST(mentions_90d, 1))) /
             GREATEST(mentions_90d, 1)
           )) /
          (1 + 3.8416 / GREATEST(mentions_90d, 1))
        ) * 100
      ELSE 0 END as trending_score,
      unique_threads,
      total_mentions,
      total_upvotes,
      mentions_90d,
      last_seen,
      '[]'::jsonb as top_snippets,
      NOW() as computed_at
    FROM normalized
    ON CONFLICT (place_id)
    DO UPDATE SET
      iconic_score = EXCLUDED.iconic_score,
      trending_score = EXCLUDED.trending_score,
      unique_threads = EXCLUDED.unique_threads,
      total_mentions = EXCLUDED.total_mentions,
      total_upvotes = EXCLUDED.total_upvotes,
      mentions_90d = EXCLUDED.mentions_90d,
      last_seen = EXCLUDED.last_seen,
      computed_at = NOW()
  `;

  const elapsed = Date.now() - startTime;

  console.log(`[worker] Aggregations computed in ${(elapsed / 1000).toFixed(1)}s`);
}

/**
 * Job handler for refresh_mvs
 */
async function handleRefreshMVs(payload: Record<string, any>): Promise<void> {
  console.log('[worker] Refreshing materialized views...');

  const startTime = Date.now();

  // Refresh mv_top_iconic_by_city
  console.log('[worker] Refreshing mv_top_iconic_by_city...');
  await prisma.$queryRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_iconic_by_city`;

  // Update version tracking
  const iconicHash = `v${Date.now()}`;
  await prisma.$queryRaw`
    INSERT INTO "MaterializedViewVersion" (view_name, version_hash, refreshed_at)
    VALUES ('mv_top_iconic_by_city', ${iconicHash}, NOW())
    ON CONFLICT (view_name)
    DO UPDATE SET
      version_hash = EXCLUDED.version_hash,
      refreshed_at = NOW()
  `;

  // Refresh mv_top_trending_by_city
  console.log('[worker] Refreshing mv_top_trending_by_city...');
  await prisma.$queryRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_trending_by_city`;

  const trendingHash = `v${Date.now()}`;
  await prisma.$queryRaw`
    INSERT INTO "MaterializedViewVersion" (view_name, version_hash, refreshed_at)
    VALUES ('mv_top_trending_by_city', ${trendingHash}, NOW())
    ON CONFLICT (view_name)
    DO UPDATE SET
      version_hash = EXCLUDED.version_hash,
      refreshed_at = NOW()
  `;

  const elapsed = Date.now() - startTime;

  console.log(`[worker] Materialized views refreshed in ${(elapsed / 1000).toFixed(1)}s`);
}

/**
 * Main worker process
 */
async function main() {
  console.log('='.repeat(60));
  console.log('🚀 Job Worker Starting...');
  console.log('='.repeat(60));

  // Parse CLI args
  const args = process.argv.slice(2);
  let pollInterval = 5000; // 5 seconds default

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--poll-interval' && args[i + 1]) {
      pollInterval = parseInt(args[i + 1]);
      i++;
    }
  }

  console.log(`Poll interval: ${pollInterval}ms`);
  console.log(`Handlers: bootstrap_city, ingest_reddit, compute_aggregations, refresh_mvs`);
  console.log('='.repeat(60) + '\n');

  // Register job handlers
  const handlers: Partial<Record<JobType, (payload: any) => Promise<void>>> = {
    bootstrap_city: handleBootstrapCity,
    ingest_reddit: handleIngestReddit,
    compute_aggregations: handleComputeAggregations,
    refresh_mvs: handleRefreshMVs
  };

  // Graceful shutdown handler
  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) {
      console.log('\n[worker] Forced shutdown...');
      process.exit(1);
    }

    isShuttingDown = true;
    console.log('\n[worker] Graceful shutdown initiated...');
    console.log('[worker] Waiting for current job to complete...');

    // Give current job up to 30s to complete
    setTimeout(() => {
      console.log('[worker] Shutdown timeout - forcing exit');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start processing jobs
  try {
    await processJobs(handlers, pollInterval);
  } catch (error) {
    console.error('\n[worker] Fatal error:', error);
    process.exit(1);
  }
}

/**
 * CLI entry point
 */
if (require.main === module) {
  main().catch(error => {
    console.error('Worker startup failed:', error);
    process.exit(1);
  });
}

export { main as startWorker };
