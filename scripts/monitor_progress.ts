#!/usr/bin/env tsx
/**
 * Monitor NYC ingestion progress
 *
 * Usage:
 *   npx tsx scripts/monitor_progress.ts
 */

import prisma from '../lib/prisma';

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 Forklore.ai - NYC Ingestion Monitor');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // Job Queue Status
  const jobStats = await prisma.$queryRaw<{
    status: string;
    count: bigint;
  }[]>`
    SELECT status, COUNT(*) as count
    FROM "JobQueue"
    GROUP BY status
    ORDER BY status
  `;

  console.log('Job Queue:');
  jobStats.forEach(s => {
    const emoji = s.status === 'completed' ? '✅' :
                  s.status === 'running' ? '⏳' :
                  s.status === 'queued' ? '📋' :
                  s.status === 'failed' ? '❌' : '⚠️';
    console.log(`  ${emoji} ${s.status}: ${s.count}`);
  });

  // City Progress
  const cityStats = await prisma.$queryRaw<{
    name: string;
    ranked: boolean;
    place_count: bigint;
    mention_count: bigint;
  }[]>`
    SELECT
      c.name,
      c.ranked,
      COUNT(DISTINCT p.id) as place_count,
      COUNT(DISTINCT rm.id) as mention_count
    FROM "City" c
    LEFT JOIN "Place" p ON p.city_id = c.id
    LEFT JOIN "RedditMention" rm ON rm.place_id = p.id
    WHERE c.name IN ('New York City', 'Portland', 'San Francisco')
    GROUP BY c.id, c.name, c.ranked
    ORDER BY c.name
  `;

  console.log('\nCity Progress:');
  cityStats.forEach(c => {
    const status = c.ranked ? '✅ RANKED' : '⏳ INGESTING';
    console.log(`  ${c.name}: ${Number(c.mention_count).toLocaleString()} mentions, ${Number(c.place_count).toLocaleString()} places [${status}]`);
  });

  // MV Freshness
  const mvStatus = await prisma.$queryRaw<{
    view_name: string;
    refreshed_at: Date;
    age_hours: number;
  }[]>`
    SELECT
      view_name,
      refreshed_at,
      EXTRACT(EPOCH FROM (NOW() - refreshed_at)) / 3600 as age_hours
    FROM "MaterializedViewVersion"
    ORDER BY view_name
  `;

  console.log('\nMaterialized Views:');
  mvStatus.forEach(mv => {
    const age = Number(mv.age_hours);
    const status = age < 1 ? '🟢' : age < 24 ? '🟡' : '🔴';
    console.log(`  ${status} ${mv.view_name}: ${age.toFixed(1)}h old`);
  });

  // Recent Job Activity
  const recentJobs = await prisma.$queryRaw<{
    type: string;
    status: string;
    created_at: Date;
    started_at: Date | null;
    completed_at: Date | null;
  }[]>`
    SELECT type, status, created_at, started_at, completed_at
    FROM "JobQueue"
    ORDER BY created_at DESC
    LIMIT 5
  `;

  console.log('\nRecent Jobs (last 5):');
  recentJobs.forEach(j => {
    const duration = j.started_at && j.completed_at
      ? ((j.completed_at.getTime() - j.started_at.getTime()) / 1000).toFixed(1) + 's'
      : j.started_at
      ? 'running...'
      : 'queued';

    const emoji = j.status === 'completed' ? '✅' :
                  j.status === 'running' ? '⏳' :
                  j.status === 'queued' ? '📋' : '❌';

    console.log(`  ${emoji} ${j.type} - ${j.status} (${duration})`);
  });

  console.log('\n' + '='.repeat(60));

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
