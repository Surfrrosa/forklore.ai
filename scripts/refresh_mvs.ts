#!/usr/bin/env tsx
/**
 * Refresh materialized views and update version tracking
 *
 * This script:
 * 1. Refreshes mv_top_iconic_by_city
 * 2. Refreshes mv_top_trending_by_city
 * 3. Updates MaterializedViewVersion for ETag support
 * 4. Optionally marks cities as ranked
 */

import prisma from '../lib/prisma';

async function main() {
  console.log('\n=== Refreshing Materialized Views ===\n');
  const startTime = Date.now();

  // Refresh mv_top_iconic_by_city
  console.log('Refreshing mv_top_iconic_by_city...');
  await prisma.$queryRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_iconic_by_city`;

  // Update version tracking
  const iconicHash = `v${Date.now()}`;
  const iconicResult = await prisma.$queryRaw<{ row_count: bigint }[]>`
    WITH row_count AS (
      SELECT COUNT(*) as count FROM mv_top_iconic_by_city
    )
    INSERT INTO "MaterializedViewVersion" (view_name, version_hash, refreshed_at, row_count)
    SELECT 'mv_top_iconic_by_city', ${iconicHash}, NOW(), count
    FROM row_count
    ON CONFLICT (view_name)
    DO UPDATE SET
      version_hash = EXCLUDED.version_hash,
      refreshed_at = NOW(),
      row_count = EXCLUDED.row_count
    RETURNING row_count
  `;

  console.log(`  Rows: ${iconicResult[0].row_count}`);
  console.log(`  Version: ${iconicHash}\n`);

  // Refresh mv_top_trending_by_city
  console.log('Refreshing mv_top_trending_by_city...');
  await prisma.$queryRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_trending_by_city`;

  const trendingHash = `v${Date.now()}`;
  const trendingResult = await prisma.$queryRaw<{ row_count: bigint }[]>`
    WITH row_count AS (
      SELECT COUNT(*) as count FROM mv_top_trending_by_city
    )
    INSERT INTO "MaterializedViewVersion" (view_name, version_hash, refreshed_at, row_count)
    SELECT 'mv_top_trending_by_city', ${trendingHash}, NOW(), count
    FROM row_count
    ON CONFLICT (view_name)
    DO UPDATE SET
      version_hash = EXCLUDED.version_hash,
      refreshed_at = NOW(),
      row_count = EXCLUDED.row_count
    RETURNING row_count
  `;

  console.log(`  Rows: ${trendingResult[0].row_count}`);
  console.log(`  Version: ${trendingHash}\n`);

  // Mark cities as ranked if they have aggregations
  const rankedCities = await prisma.$queryRaw<{ id: string; name: string }[]>`
    UPDATE "City" c
    SET ranked = true, last_refreshed_at = NOW()
    WHERE EXISTS (
      SELECT 1
      FROM "Place" p
      JOIN "PlaceAggregation" pa ON pa.place_id = p.id
      WHERE p.city_id = c.id
    )
    AND ranked = false
    RETURNING id, name
  `;

  if (rankedCities.length > 0) {
    console.log('Cities marked as ranked:');
    for (const city of rankedCities) {
      console.log(`  - ${city.name} (${city.id})`);
    }
    console.log('');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Completed in ${elapsed}s\n`);

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('\nError:', error);
  process.exit(1);
});
