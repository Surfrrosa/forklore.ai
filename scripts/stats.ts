#!/usr/bin/env tsx
/**
 * Database statistics viewer
 *
 * Shows current state of the system:
 * - Cities and their ranking status
 * - Place counts per city
 * - Reddit mention statistics
 * - Aggregation coverage
 * - MV status
 */

import prisma from '../lib/prisma';

interface CityStats {
  city_id: string;
  city_name: string;
  ranked: boolean;
  places: bigint;
  mentions: bigint;
  aggregated_places: bigint;
  top_place: string | null;
  top_score: number | null;
}

interface SystemStats {
  total_cities: bigint;
  ranked_cities: bigint;
  total_places: bigint;
  total_mentions: bigint;
  total_aggregations: bigint;
}

async function main() {
  console.log('\n=== Forklore.ai System Statistics ===\n');

  // System-wide stats
  const systemStats = await prisma.$queryRaw<SystemStats[]>`
    SELECT
      (SELECT COUNT(*) FROM "City") as total_cities,
      (SELECT COUNT(*) FROM "City" WHERE ranked = true) as ranked_cities,
      (SELECT COUNT(*) FROM "Place") as total_places,
      (SELECT COUNT(*) FROM "RedditMention") as total_mentions,
      (SELECT COUNT(*) FROM "PlaceAggregation") as total_aggregations
  `;

  console.log('System Overview:');
  console.log(`  Cities: ${systemStats[0].total_cities} (${systemStats[0].ranked_cities} ranked)`);
  console.log(`  Places: ${systemStats[0].total_places}`);
  console.log(`  Reddit Mentions: ${systemStats[0].total_mentions}`);
  console.log(`  Aggregated Places: ${systemStats[0].total_aggregations}`);
  console.log('');

  // Per-city breakdown
  const cityStats = await prisma.$queryRaw<CityStats[]>`
    SELECT
      c.id as city_id,
      c.name as city_name,
      c.ranked,
      COUNT(DISTINCT p.id) as places,
      COUNT(DISTINCT rm.id) as mentions,
      COUNT(DISTINCT pa.place_id) as aggregated_places,
      (
        SELECT p2.name
        FROM "Place" p2
        LEFT JOIN "PlaceAggregation" pa2 ON pa2.place_id = p2.id
        WHERE p2.city_id = c.id
        ORDER BY COALESCE(pa2.iconic_score, 0) DESC
        LIMIT 1
      ) as top_place,
      (
        SELECT COALESCE(pa2.iconic_score, 0)
        FROM "Place" p2
        LEFT JOIN "PlaceAggregation" pa2 ON pa2.place_id = p2.id
        WHERE p2.city_id = c.id
        ORDER BY COALESCE(pa2.iconic_score, 0) DESC
        LIMIT 1
      ) as top_score
    FROM "City" c
    LEFT JOIN "Place" p ON p.city_id = c.id
    LEFT JOIN "RedditMention" rm ON rm.place_id = p.id
    LEFT JOIN "PlaceAggregation" pa ON pa.place_id = p.id
    GROUP BY c.id, c.name, c.ranked
    ORDER BY c.name
  `;

  console.log('Per-City Breakdown:');
  console.log('');

  for (const city of cityStats) {
    const status = city.ranked ? 'RANKED' : 'unranked';
    console.log(`${city.city_name} [${status}]`);
    console.log(`  Places: ${city.places}`);
    console.log(`  Mentions: ${city.mentions}`);
    console.log(`  Aggregated: ${city.aggregated_places}`);

    if (city.top_place) {
      console.log(`  Top Place: ${city.top_place} (score: ${Number(city.top_score).toFixed(2)})`);
    }

    console.log('');
  }

  // Subreddit status
  const subredditStats = await prisma.$queryRaw<{
    subreddit: string;
    city_name: string;
    is_active: boolean;
    total_posts: number;
    last_sync: Date | null;
  }[]>`
    SELECT
      s.name as subreddit,
      c.name as city_name,
      s.is_active,
      s.total_posts,
      s.last_sync
    FROM "Subreddit" s
    LEFT JOIN "City" c ON c.id = s.city_id
    ORDER BY s.name
  `;

  if (subredditStats.length > 0) {
    console.log('Subreddit Status:');
    console.log('');

    for (const sub of subredditStats) {
      const status = sub.is_active ? 'active' : 'inactive';
      const lastSync = sub.last_sync
        ? new Date(sub.last_sync).toISOString().split('T')[0]
        : 'never';

      console.log(`  r/${sub.subreddit} -> ${sub.city_name || 'unmapped'} [${status}]`);
      console.log(`    Posts: ${sub.total_posts}, Last sync: ${lastSync}`);
    }
    console.log('');
  }

  // MV status
  const mvStats = await prisma.$queryRaw<{
    view_name: string;
    row_count: bigint | null;
    refreshed_at: Date;
  }[]>`
    SELECT view_name, row_count, refreshed_at
    FROM "MaterializedViewVersion"
    ORDER BY view_name
  `;

  if (mvStats.length > 0) {
    console.log('Materialized View Status:');
    console.log('');

    for (const mv of mvStats) {
      const refreshed = new Date(mv.refreshed_at).toISOString();
      console.log(`  ${mv.view_name}`);
      console.log(`    Rows: ${mv.row_count || 0}, Refreshed: ${refreshed}`);
    }
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
