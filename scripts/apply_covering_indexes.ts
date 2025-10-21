#!/usr/bin/env tsx
/**
 * Apply covering indexes to materialized views
 */

import prisma from '../lib/prisma';

async function main() {
  console.log('Creating covering indexes on MVs...\n');

  try {
    // Drop existing if they exist
    console.log('[1/6] Dropping existing indexes...');
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS idx_mv_iconic_city_rank_covering`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS idx_mv_trending_city_rank_covering`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS idx_mv_iconic_city_cuisine`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS idx_mv_trending_city_cuisine`);

    // Create covering index for iconic
    console.log('[2/6] Creating covering index for mv_top_iconic_by_city...');
    await prisma.$executeRawUnsafe(`
      CREATE INDEX idx_mv_iconic_city_rank_covering
      ON mv_top_iconic_by_city (city_id, rank)
      INCLUDE (
        place_id, name, cuisine, lat, lon, address,
        iconic_score, unique_threads, total_mentions, last_seen
      )
    `);

    // Create covering index for trending
    console.log('[3/6] Creating covering index for mv_top_trending_by_city...');
    await prisma.$executeRawUnsafe(`
      CREATE INDEX idx_mv_trending_city_rank_covering
      ON mv_top_trending_by_city (city_id, rank)
      INCLUDE (
        place_id, name, cuisine, lat, lon, address,
        trending_score, unique_threads, total_mentions, last_seen
      )
    `);

    // Create GIN index for cuisine filtering on iconic
    console.log('[4/6] Creating GIN index for cuisine on mv_top_iconic_by_city...');
    await prisma.$executeRawUnsafe(`
      CREATE INDEX idx_mv_iconic_city_cuisine
      ON mv_top_iconic_by_city USING GIN (cuisine)
    `);

    // Create GIN index for cuisine filtering on trending
    console.log('[5/6] Creating GIN index for cuisine on mv_top_trending_by_city...');
    await prisma.$executeRawUnsafe(`
      CREATE INDEX idx_mv_trending_city_cuisine
      ON mv_top_trending_by_city USING GIN (cuisine)
    `);

    console.log('[6/6] Verifying indexes...');
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND (
          indexname LIKE 'idx_mv_iconic%'
          OR indexname LIKE 'idx_mv_trending%'
        )
      ORDER BY indexname
    `;

    console.log('\nCreated indexes:');
    indexes.forEach(idx => console.log(`  ✓ ${idx.indexname}`));

    console.log('\n✅ Covering indexes created successfully!');

  } catch (error) {
    console.error('\n❌ Error creating indexes:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
