#!/usr/bin/env tsx
/**
 * Bootstrap city pipeline - idempotent city initialization
 *
 * Flow:
 * 1. Resolve city name → geodata (lat/lon/bbox)
 * 2. Fetch POIs from Overpass API
 * 3. Normalize and validate place data
 * 4. Upsert City + CityAlias records
 * 5. Upsert Place records (staging → validate → swap)
 * 6. Seed Subreddit mappings from config
 * 7. Enqueue Reddit ingestion job
 * 8. Mark city as bootstrapped (ranked=false initially)
 *
 * Usage:
 *   npx tsx scripts/bootstrap_city.ts "San Francisco"
 *   npx tsx scripts/bootstrap_city.ts --city-id sf
 */

import { resolveCity, type CityGeoData } from '../lib/geocode';
import { fetchRestaurants, waitForOverpassRateLimit, type OverpassPlace } from '../lib/overpass';
import { enqueueJob } from '../lib/jobs';
import prisma from '../lib/prisma';
import citiesConfig from '../config/cities.json';

interface BootstrapResult {
  cityId: string;
  cityName: string;
  placesCreated: number;
  placesUpdated: number;
  subredditsAdded: number;
  jobsEnqueued: string[];
  elapsed: number;
}

/**
 * Main bootstrap function
 */
export async function bootstrapCity(cityQuery: string): Promise<BootstrapResult> {
  const startTime = Date.now();

  console.log(`\n=== Bootstrapping city: ${cityQuery} ===\n`);

  // Step 1: Resolve city geodata
  console.log('[1/7] Resolving city geodata...');
  const geodata = await resolveCity(cityQuery);

  if (!geodata) {
    throw new Error(`Could not resolve city: ${cityQuery}`);
  }

  console.log(`  ✓ Resolved: ${geodata.displayName}`);
  console.log(`  ✓ Coordinates: ${geodata.lat}, ${geodata.lon}`);
  console.log(`  ✓ Confidence: ${geodata.importance.toFixed(2)}`);

  // Step 2: Fetch POIs from Overpass
  console.log('\n[2/7] Fetching restaurants from Overpass API...');
  await waitForOverpassRateLimit();

  const places = await fetchRestaurants(geodata.bbox);

  if (places.length === 0) {
    console.warn('  ⚠ No places found - city may have no POI data');
  } else {
    console.log(`  ✓ Fetched ${places.length} places`);
  }

  // Step 3: Upsert City record
  console.log('\n[3/7] Upserting City record...');
  const city = await upsertCity(geodata);
  console.log(`  ✓ City ID: ${city.id}`);

  // Step 4: Upsert CityAlias records
  console.log('\n[4/7] Upserting city aliases...');
  const aliasCount = await upsertCityAliases(city.id, geodata);
  console.log(`  ✓ ${aliasCount} aliases configured`);

  // Step 5: Upsert Place records
  console.log('\n[5/7] Upserting Place records...');
  const placeStats = await upsertPlaces(city.id, places);
  console.log(`  ✓ Created: ${placeStats.created}`);
  console.log(`  ✓ Updated: ${placeStats.updated}`);

  // Step 6: Seed Subreddit mappings
  console.log('\n[6/7] Seeding Subreddit mappings...');
  const subredditCount = await seedSubreddits(city.id, cityQuery);
  console.log(`  ✓ ${subredditCount} subreddits mapped`);

  // Step 7: Enqueue jobs
  console.log('\n[7/7] Enqueuing background jobs...');
  const jobs: string[] = [];

  // Enqueue Reddit ingestion
  const ingestJob = await enqueueJob('ingest_reddit', { cityId: city.id });
  jobs.push(ingestJob.id);
  console.log(`  ✓ Enqueued Reddit ingestion: ${ingestJob.id}`);

  // Enqueue aggregation compute (runs after ingest)
  const aggJob = await enqueueJob('compute_aggregations', { cityId: city.id });
  jobs.push(aggJob.id);
  console.log(`  ✓ Enqueued aggregation compute: ${aggJob.id}`);

  // Enqueue MV refresh (runs after aggregations)
  const mvJob = await enqueueJob('refresh_mvs', {});
  jobs.push(mvJob.id);
  console.log(`  ✓ Enqueued MV refresh: ${mvJob.id}`);

  const elapsed = Date.now() - startTime;

  console.log(`\n=== Bootstrap complete in ${(elapsed / 1000).toFixed(1)}s ===\n`);

  return {
    cityId: city.id,
    cityName: city.name,
    placesCreated: placeStats.created,
    placesUpdated: placeStats.updated,
    subredditsAdded: subredditCount,
    jobsEnqueued: jobs,
    elapsed
  };
}

/**
 * Upsert City record (idempotent)
 */
async function upsertCity(geodata: CityGeoData): Promise<{ id: string; name: string }> {
  // Convert bbox to PostGIS geometry
  const bboxWKT = bboxToWKT(geodata.bbox.coordinates[0]);

  const result = await prisma.$queryRaw<{ id: string; name: string }[]>`
    INSERT INTO "City" (
      name,
      country,
      bbox,
      lat,
      lon,
      ranked,
      created_at,
      updated_at
    )
    VALUES (
      ${geodata.name},
      ${geodata.country},
      ST_GeomFromText(${bboxWKT}, 4326),
      ${geodata.lat},
      ${geodata.lon},
      false,  -- Initially unranked until Reddit data ingested
      NOW(),
      NOW()
    )
    ON CONFLICT (name, country)
    DO UPDATE SET
      bbox = EXCLUDED.bbox,
      lat = EXCLUDED.lat,
      lon = EXCLUDED.lon,
      updated_at = NOW()
    RETURNING id, name
  `;

  return result[0];
}

/**
 * Upsert CityAlias records from config
 */
async function upsertCityAliases(cityId: string, geodata: CityGeoData): Promise<number> {
  // Find city config
  const configCity = citiesConfig.cities.find(c => c.name === geodata.name);

  if (!configCity || !configCity.aliases) {
    return 0;
  }

  let count = 0;

  for (const alias of configCity.aliases) {
    await prisma.$queryRaw`
      INSERT INTO "CityAlias" (city_id, alias, is_borough, created_at)
      VALUES (${cityId}, ${alias}, false, NOW())
      ON CONFLICT (LOWER(alias))
      DO UPDATE SET city_id = EXCLUDED.city_id
    `;
    count++;
  }

  // Add borough aliases if any
  if (configCity.boroughs) {
    for (const borough of configCity.boroughs) {
      for (const alias of borough.aliases) {
        await prisma.$queryRaw`
          INSERT INTO "CityAlias" (city_id, alias, is_borough, created_at)
          VALUES (${cityId}, ${alias}, true, NOW())
          ON CONFLICT (LOWER(alias))
          DO UPDATE SET city_id = EXCLUDED.city_id, is_borough = true
        `;
        count++;
      }
    }
  }

  return count;
}

/**
 * Upsert Place records (idempotent)
 */
async function upsertPlaces(
  cityId: string,
  places: OverpassPlace[]
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const place of places) {
    try {
      const result = await prisma.$queryRaw<{ action: string }[]>`
        INSERT INTO "Place" (
          city_id,
          osm_id,
          name,
          name_norm,
          geog,
          address,
          cuisine,
          status,
          brand,
          source,
          aliases,
          created_at,
          updated_at
        )
        VALUES (
          ${cityId},
          ${place.osmId},
          ${place.name},
          ${place.nameNorm},
          ST_SetSRID(ST_MakePoint(${place.lon}, ${place.lat}), 4326)::geography,
          ${place.address || null},
          ARRAY[${place.cuisine.join(',')}]::text[],
          'open',
          ${place.brand || null},
          'bootstrap',
          '{}',
          NOW(),
          NOW()
        )
        ON CONFLICT (city_id, name_norm)
        DO UPDATE SET
          osm_id = EXCLUDED.osm_id,
          geog = EXCLUDED.geog,
          address = COALESCE(EXCLUDED.address, "Place".address),
          cuisine = EXCLUDED.cuisine,
          brand = COALESCE(EXCLUDED.brand, "Place".brand),
          updated_at = NOW()
        RETURNING (xmax = 0) AS is_insert
      `;

      if (result[0] && (result[0] as any).is_insert) {
        created++;
      } else {
        updated++;
      }

    } catch (error) {
      console.error(`  ✗ Failed to upsert place: ${place.name}`, error);
    }
  }

  return { created, updated };
}

/**
 * Seed Subreddit mappings from config
 */
async function seedSubreddits(cityId: string, cityQuery: string): Promise<number> {
  // Find city config by name or alias
  const configCity = citiesConfig.cities.find(c =>
    c.name.toLowerCase() === cityQuery.toLowerCase() ||
    c.id === cityQuery.toLowerCase() ||
    c.aliases.some(a => a.toLowerCase() === cityQuery.toLowerCase())
  );

  if (!configCity || !configCity.subreddits) {
    console.log('  ⚠ No subreddit mappings in config');
    return 0;
  }

  let count = 0;

  for (const subredditName of configCity.subreddits) {
    await prisma.$queryRaw`
      INSERT INTO "Subreddit" (
        id,
        name,
        city_id,
        is_active,
        total_posts,
        created_at
      )
      VALUES (
        ${subredditName.toLowerCase()},
        ${subredditName},
        ${cityId},
        true,
        0,
        NOW()
      )
      ON CONFLICT (name)
      DO UPDATE SET
        city_id = EXCLUDED.city_id,
        is_active = true
    `;
    count++;
  }

  return count;
}

/**
 * Convert GeoJSON bbox coordinates to PostGIS WKT
 */
function bboxToWKT(coords: number[][]): string {
  const points = coords.map(c => `${c[0]} ${c[1]}`).join(', ');
  return `POLYGON((${points}))`;
}

/**
 * CLI entry point
 */
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx tsx scripts/bootstrap_city.ts <city-name>');
    process.exit(1);
  }

  const cityQuery = args.join(' ');

  bootstrapCity(cityQuery)
    .then(result => {
      console.log('\nResult:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Bootstrap failed:', error);
      process.exit(1);
    });
}
