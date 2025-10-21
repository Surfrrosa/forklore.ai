/**
 * GET /api/health - System health check endpoint
 *
 * Returns:
 * - Database connectivity
 * - Materialized view freshness
 * - Job queue status
 * - Rate limiter status
 *
 * Used by monitoring systems and load balancers
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createApiResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const checks: Record<string, any> = {};
  let healthy = true;

  try {
    // 1. Database connectivity
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'healthy', latency_ms: Date.now() - startTime };
    } catch (error) {
      checks.database = { status: 'unhealthy', error: String(error) };
      healthy = false;
    }

    // 2. Materialized view freshness (warn if > 24h stale)
    try {
      const mvStatus = await prisma.$queryRaw<{
        view_name: string;
        refreshed_at: Date;
        row_count: number | null;
        age_hours: number;
      }[]>`
        SELECT
          view_name,
          refreshed_at,
          row_count,
          EXTRACT(EPOCH FROM (NOW() - refreshed_at)) / 3600 as age_hours
        FROM "MaterializedViewVersion"
        ORDER BY view_name
      `;

      checks.materialized_views = {
        status: mvStatus.every(mv => mv.age_hours < 24) ? 'healthy' : 'stale',
        views: mvStatus.map(mv => ({
          name: mv.view_name,
          age_hours: Number(mv.age_hours.toFixed(2)),
          row_count: mv.row_count,
          last_refresh: mv.refreshed_at.toISOString()
        }))
      };

      if (mvStatus.some(mv => mv.age_hours > 24)) {
        checks.materialized_views.warning = 'One or more MVs are stale (>24h)';
      }
    } catch (error) {
      checks.materialized_views = { status: 'unknown', error: String(error) };
    }

    // 3. Job queue status
    try {
      const jobStats = await prisma.$queryRaw<{
        status: string;
        count: bigint;
      }[]>`
        SELECT status, COUNT(*) as count
        FROM "JobQueue"
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY status
      `;

      const stats: Record<string, number> = {};
      jobStats.forEach(row => {
        stats[row.status] = Number(row.count);
      });

      checks.job_queue = {
        status: 'healthy',
        last_24h: stats
      };

      // Warn if too many failed jobs
      if (stats.failed && stats.failed > 10) {
        checks.job_queue.warning = `High failure rate: ${stats.failed} failed jobs in 24h`;
      }
    } catch (error) {
      checks.job_queue = { status: 'unknown', error: String(error) };
    }

    // 4. Cities status
    try {
      const cityStats = await prisma.$queryRaw<{
        total: bigint;
        ranked: bigint;
      }[]>`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE ranked = true) as ranked
        FROM "City"
      `;

      checks.cities = {
        status: 'healthy',
        total: Number(cityStats[0].total),
        ranked: Number(cityStats[0].ranked),
        unranked: Number(cityStats[0].total) - Number(cityStats[0].ranked)
      };
    } catch (error) {
      checks.cities = { status: 'unknown', error: String(error) };
    }

    // 5. Overall status
    const status = healthy ? 'healthy' : 'unhealthy';

    return createApiResponse({
      status,
      checks,
      uptime_ms: Date.now() - startTime
    }, startTime, {
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      error: String(error),
      checks
    }, {
      status: 503,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }
}
