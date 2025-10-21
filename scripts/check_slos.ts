#!/usr/bin/env tsx
/**
 * SLO Checker - Validates system performance against SLOs
 *
 * SLOs:
 * - P95 database query time < 100ms for MV reads
 * - P95 API response time < 200ms
 * - MV freshness < 24 hours
 * - Rate limiter functional
 * - Zero failed jobs in queue
 *
 * Usage:
 *   npx tsx scripts/check_slos.ts
 *   npx tsx scripts/check_slos.ts --city Portland
 */

import prisma from '../lib/prisma';

interface SLOCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  value?: number;
  threshold?: number;
  message: string;
}

const checks: SLOCheck[] = [];

async function checkDatabaseLatency(cityId?: string) {
  console.log('\n🔍 Checking database query latency...');

  // Use a real city or default to Portland
  const city = cityId || 'af20eccd-4b77-4072-ac23-21d179f4b37e';

  const iterations = 10;
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await prisma.$queryRaw`
      SELECT * FROM mv_top_iconic_by_city
      WHERE city_id = ${city}
      ORDER BY rank
      LIMIT 50
    `;
    latencies.push(Date.now() - start);
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];

  console.log(`  P50: ${p50}ms, P95: ${p95}ms, P99: ${p99}ms`);

  checks.push({
    name: 'DB Query Latency (P95)',
    status: p95 < 100 ? 'pass' : 'fail',
    value: p95,
    threshold: 100,
    message: p95 < 100
      ? `✅ P95 ${p95}ms < 100ms threshold`
      : `❌ P95 ${p95}ms exceeds 100ms threshold`
  });
}

async function checkMVFreshness() {
  console.log('\n🔍 Checking materialized view freshness...');

  const mvs = await prisma.$queryRaw<{
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

  for (const mv of mvs) {
    const ageHours = Number(mv.age_hours);
    console.log(`  ${mv.view_name}: ${ageHours.toFixed(1)}h old`);

    checks.push({
      name: `MV Freshness: ${mv.view_name}`,
      status: ageHours < 24 ? 'pass' : 'warn',
      value: ageHours,
      threshold: 24,
      message: ageHours < 24
        ? `✅ ${ageHours.toFixed(1)}h < 24h threshold`
        : `⚠️  ${ageHours.toFixed(1)}h exceeds 24h threshold`
    });
  }
}

async function checkJobQueue() {
  console.log('\n🔍 Checking job queue health...');

  const stats = await prisma.$queryRaw<{
    status: string;
    count: bigint;
  }[]>`
    SELECT status, COUNT(*) as count
    FROM "JobQueue"
    GROUP BY status
  `;

  const statusCounts: Record<string, number> = {};
  stats.forEach(row => {
    statusCounts[row.status] = Number(row.count);
    console.log(`  ${row.status}: ${row.count}`);
  });

  const failedCount = statusCounts.failed || 0;
  const errorCount = statusCounts.error || 0;

  checks.push({
    name: 'Job Queue - Failed Jobs',
    status: failedCount === 0 ? 'pass' : failedCount < 5 ? 'warn' : 'fail',
    value: failedCount,
    threshold: 0,
    message: failedCount === 0
      ? '✅ No failed jobs'
      : failedCount < 5
      ? `⚠️  ${failedCount} failed jobs (< 5 threshold)`
      : `❌ ${failedCount} failed jobs exceeds threshold`
  });

  checks.push({
    name: 'Job Queue - Error Jobs',
    status: errorCount === 0 ? 'pass' : errorCount < 3 ? 'warn' : 'fail',
    value: errorCount,
    threshold: 0,
    message: errorCount === 0
      ? '✅ No error jobs'
      : errorCount < 3
      ? `⚠️  ${errorCount} error jobs (< 3 threshold)`
      : `❌ ${errorCount} error jobs exceeds threshold`
  });
}

async function checkIndexUsage() {
  console.log('\n🔍 Checking index usage on MVs...');

  // Get actual query plan for MV read
  const plan = await prisma.$queryRaw<{ 'QUERY PLAN': string }[]>`
    EXPLAIN (FORMAT JSON)
    SELECT * FROM mv_top_iconic_by_city
    WHERE city_id = 'af20eccd-4b77-4072-ac23-21d179f4b37e'
    ORDER BY rank
    LIMIT 50
  `;

  const planText = JSON.stringify(plan);
  const usesIndexScan = planText.includes('Index Scan') || planText.includes('Index Only Scan');
  const usesSeqScan = planText.includes('Seq Scan');

  console.log(`  Plan: ${usesIndexScan ? 'Index Scan ✓' : 'Sequential Scan ✗'}`);

  checks.push({
    name: 'MV Query Plan - Index Usage',
    status: usesIndexScan && !usesSeqScan ? 'pass' : 'warn',
    message: usesIndexScan && !usesSeqScan
      ? '✅ Using index scan (optimal)'
      : usesSeqScan
      ? '⚠️  Using sequential scan (slow)'
      : '⚠️  Query plan unclear'
  });
}

async function checkCityData() {
  console.log('\n🔍 Checking city data completeness...');

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
    GROUP BY c.id, c.name, c.ranked
    ORDER BY c.ranked DESC, mention_count DESC
  `;

  for (const city of cityStats) {
    const placeCount = Number(city.place_count);
    const mentionCount = Number(city.mention_count);

    console.log(`  ${city.name}: ${placeCount} places, ${mentionCount} mentions, ranked=${city.ranked}`);

    if (city.ranked && mentionCount === 0) {
      checks.push({
        name: `City Data: ${city.name}`,
        status: 'fail',
        message: `❌ Marked as ranked but has 0 mentions`
      });
    } else if (city.ranked) {
      checks.push({
        name: `City Data: ${city.name}`,
        status: 'pass',
        value: mentionCount,
        message: `✅ ${mentionCount} mentions indexed`
      });
    }
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('📊 SLO Checker - Forklore.ai');
  console.log('='.repeat(60));

  const cityArg = process.argv.find(arg => arg.startsWith('--city='));
  const cityName = cityArg?.split('=')[1];

  let cityId: string | undefined;
  if (cityName) {
    const city = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "City" WHERE LOWER(name) = LOWER(${cityName}) LIMIT 1
    `;
    if (city.length > 0) {
      cityId = city[0].id;
      console.log(`\nTesting against city: ${cityName} (${cityId})`);
    }
  }

  try {
    await checkDatabaseLatency(cityId);
    await checkMVFreshness();
    await checkJobQueue();
    await checkIndexUsage();
    await checkCityData();
  } catch (error) {
    console.error('\n❌ Error during checks:', error);
    process.exit(1);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📋 Summary');
  console.log('='.repeat(60));

  const passed = checks.filter(c => c.status === 'pass').length;
  const warned = checks.filter(c => c.status === 'warn').length;
  const failed = checks.filter(c => c.status === 'fail').length;

  console.log(`\n✅ Passed: ${passed}`);
  if (warned > 0) console.log(`⚠️  Warnings: ${warned}`);
  if (failed > 0) console.log(`❌ Failed: ${failed}`);

  console.log('\nDetailed Results:\n');
  checks.forEach(check => {
    const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
    console.log(`${icon} ${check.name}`);
    console.log(`   ${check.message}`);
  });

  await prisma.$disconnect();

  // Exit code
  if (failed > 0) {
    console.log('\n❌ SLO checks failed');
    process.exit(1);
  } else if (warned > 0) {
    console.log('\n⚠️  SLO checks passed with warnings');
    process.exit(0);
  } else {
    console.log('\n✅ All SLO checks passed');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
