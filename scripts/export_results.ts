#!/usr/bin/env tsx
/**
 * Export top restaurants for each city
 * Generates JSON files showing the final output of the system
 */

import prisma from '../lib/prisma';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('Exporting top restaurants...\n');

  const cities = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM "City" WHERE ranked = true ORDER BY name
  `;

  const results: Record<string, any> = {};

  for (const city of cities) {
    console.log(`Processing ${city.name}...`);

    // Get top iconic restaurants
    const iconic = await prisma.$queryRaw<any[]>`
      SELECT
        name,
        cuisine,
        address,
        iconic_score,
        total_mentions,
        unique_threads
      FROM mv_top_iconic_by_city
      WHERE city_id = ${city.id}
      ORDER BY iconic_score DESC
      LIMIT 20
    `;

    // Get top trending restaurants
    const trending = await prisma.$queryRaw<any[]>`
      SELECT
        name,
        cuisine,
        address,
        trending_score,
        mentions_90d
      FROM mv_top_trending_by_city
      WHERE city_id = ${city.id}
      ORDER BY trending_score DESC
      LIMIT 20
    `;

    // Get stats
    const stats = await prisma.$queryRaw<any[]>`
      SELECT
        COUNT(DISTINCT p.id) as place_count,
        COUNT(DISTINCT rm.id) as mention_count,
        COUNT(DISTINCT rm.post_id) as thread_count
      FROM "Place" p
      LEFT JOIN "RedditMention" rm ON rm.place_id = p.id
      WHERE p.city_id = ${city.id}
    `;

    results[city.name] = {
      stats: {
        places: Number(stats[0].place_count),
        mentions: Number(stats[0].mention_count),
        threads: Number(stats[0].thread_count)
      },
      iconic: iconic.map(r => ({
        name: r.name,
        cuisine: r.cuisine,
        address: r.address,
        score: Number(r.iconic_score).toFixed(1),
        mentions: Number(r.total_mentions),
        threads: Number(r.unique_threads)
      })),
      trending: trending.map(r => ({
        name: r.name,
        cuisine: r.cuisine,
        address: r.address,
        score: Number(r.trending_score).toFixed(1),
        mentions90d: Number(r.mentions_90d)
      }))
    };

    console.log(`  ✓ ${iconic.length} iconic, ${trending.length} trending\n`);
  }

  // Write to file
  const outputPath = path.join(process.cwd(), 'data', 'exports', 'top_restaurants.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log(`✅ Exported to: ${outputPath}`);
  console.log(`\nSummary:`);
  for (const [cityName, data] of Object.entries(results)) {
    console.log(`  ${cityName}: ${data.stats.mentions} mentions, ${data.stats.places} places`);
  }

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
