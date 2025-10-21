#!/usr/bin/env tsx
/**
 * Add comprehensive city aliases for resolveCity()
 */

import prisma from '../lib/prisma';

const CITY_ALIASES = {
  'New York City': [
    'nyc', 'new york', 'manhattan', 'brooklyn', 'queens', 'bronx', 'staten island',
    'new york ny', 'ny', 'new york city ny', 'the big apple', 'gotham'
  ],
  'Portland': [
    'pdx', 'portland or', 'portland oregon', 'portland ore', 'rip city'
  ],
  'San Francisco': [
    'sf', 'san fran', 'frisco', 'san francisco ca', 'the city', 'san francisco california',
    'sf bay', 'san fran ca', 'city by the bay'
  ],
  'Los Angeles': [
    'la', 'los angeles ca', 'l.a.', 'los', 'los angeles california', 'la ca',
    'city of angels', 'lax'
  ],
  'Chicago': [
    'chi', 'chicago il', 'chitown', 'the windy city', 'chicago illinois', 'chi town',
    'second city'
  ],
  'Seattle': [
    'sea', 'seattle wa', 'seattle washington', 'emerald city', 'the emerald city'
  ],
  'Boston': [
    'bos', 'boston ma', 'boston massachusetts', 'beantown'
  ],
  'Austin': [
    'atx', 'austin tx', 'austin texas', 'live music capital'
  ],
  'Denver': [
    'den', 'denver co', 'mile high city', 'denver colorado', 'the mile high city'
  ],
  'Miami': [
    'mia', 'miami fl', 'miami florida', 'the magic city', 'south beach'
  ],
  'Washington': [
    'dc', 'washington dc', 'washington d.c.', 'district of columbia', 'the district',
    'd.c.', 'dmv'
  ],
  'Philadelphia': [
    'philly', 'philadelphia pa', 'phila', 'philadelphia pennsylvania', 'the city of brotherly love',
    'city of brotherly love'
  ],
  'Atlanta': [
    'atl', 'atlanta ga', 'atlanta georgia', 'the a', 'hotlanta'
  ],
  'Dallas': [
    'dfw', 'dallas tx', 'dallas texas', 'big d'
  ],
  'Houston': [
    'hou', 'houston tx', 'houston texas', 'h-town', 'space city'
  ],
  'Phoenix': [
    'phx', 'phoenix az', 'phoenix arizona'
  ],
  'San Diego': [
    'sd', 'san diego ca', 'san diego california', 'america\'s finest city'
  ],
  'Las Vegas': [
    'vegas', 'las vegas nv', 'lv', 'las vegas nevada', 'sin city'
  ],
  'Detroit': [
    'det', 'detroit mi', 'motor city', 'detroit michigan', 'motown', 'the d'
  ],
  'Minneapolis': [
    'mpls', 'minneapolis mn', 'twin cities', 'minneapolis minnesota', 'mini apple'
  ],
  'Nashville': [
    'nash', 'nashville tn', 'music city', 'nashville tennessee', 'nashvegas'
  ],
  'New Orleans': [
    'nola', 'new orleans la', 'the big easy', 'new orleans louisiana', 'nola la',
    'big easy', 'the crescent city'
  ],
  'Baltimore': [
    'bmore', 'baltimore md', 'baltimore maryland', 'charm city', 'b-more'
  ],
  'Pittsburgh': [
    'pgh', 'pittsburgh pa', 'pitt', 'pittsburgh pennsylvania', 'steel city', 'the burgh'
  ],
  'Cleveland': [
    'cle', 'cleveland oh', 'cleveland ohio', 'the land', 'the cle'
  ],
  'Cincinnati': [
    'cincy', 'cincinnati oh', 'cincinnati ohio', 'the queen city', 'cincy oh'
  ],
  'Milwaukee': [
    'mke', 'milwaukee wi', 'milwaukee wisconsin', 'brew city'
  ],
  'Kansas City': [
    'kc', 'kansas city mo', 'kansas city missouri', 'kcmo'
  ],
  'St. Louis': [
    'stl', 'st louis mo', 'saint louis', 'st louis missouri', 'saint louis mo',
    'gateway city'
  ],
  'San Antonio': [
    'sat', 'san antonio tx', 'san antonio texas', 'alamo city'
  ],
  'San Jose': [
    'sj', 'san jose ca', 'san jose california', 'capital of silicon valley'
  ]
};

async function main() {
  console.log('Adding city aliases...\n');

  let totalAdded = 0;
  let totalSkipped = 0;

  for (const [cityName, aliases] of Object.entries(CITY_ALIASES)) {
    // Find city by name
    const city = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "City" WHERE name = ${cityName} LIMIT 1
    `;

    if (city.length === 0) {
      console.log(`⚠️  City not found: ${cityName} (skipping)`);
      totalSkipped++;
      continue;
    }

    const cityId = city[0].id;
    console.log(`\n${cityName} (${cityId}):`);

    for (const alias of aliases) {
      try {
        await prisma.$queryRaw`
          INSERT INTO "CityAlias" (city_id, alias)
          VALUES (${cityId}, ${alias})
          ON CONFLICT (city_id, alias) DO NOTHING
        `;
        console.log(`  ✓ ${alias}`);
        totalAdded++;
      } catch (error) {
        console.log(`  ✗ ${alias} (error: ${error})`);
      }
    }
  }

  console.log(`\n\n=== Summary ===`);
  console.log(`Total aliases added: ${totalAdded}`);
  console.log(`Cities skipped: ${totalSkipped}`);
  console.log(`\n✅ City aliases updated!`);

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('\n❌ Error:', error);
  process.exit(1);
});
