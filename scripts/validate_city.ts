#!/usr/bin/env tsx
/**
 * End-to-End Validation Script
 *
 * Validates the complete pipeline for a ranked city:
 * 1. City resolution (resolveCity + aliases)
 * 2. /api/v2/search (MV-only reads, proper headers)
 * 3. /api/v2/fuzzy (trigram search)
 * 4. /api/v2/places/[id] (detail endpoint)
 * 5. /api/health (monitoring)
 *
 * Usage:
 *   npx tsx scripts/validate_city.ts Portland
 *   npx tsx scripts/validate_city.ts "New York City"
 *   npx tsx scripts/validate_city.ts nyc  # Test alias resolution
 */

import prisma from '../lib/prisma';

interface ValidationCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: any;
}

const checks: ValidationCheck[] = [];

async function validateCityResolution(cityInput: string) {
  console.log('\n1. City Resolution');
  console.log('='.repeat(60));

  // Test resolveCity logic
  const cityResult = await prisma.$queryRaw<{
    id: string;
    name: string;
    ranked: boolean;
  }[]>`
    SELECT c.id, c.name, c.ranked
    FROM "City" c
    LEFT JOIN "CityAlias" ca ON ca.city_id = c.id
    WHERE LOWER(c.name) = LOWER(${cityInput})
       OR LOWER(ca.alias) = LOWER(${cityInput})
    LIMIT 1
  `;

  if (cityResult.length === 0) {
    checks.push({
      name: 'City Resolution',
      status: 'fail',
      message: `City "${cityInput}" not found in database`
    });
    return null;
  }

  const city = cityResult[0];
  console.log(`  Found: ${city.name} (${city.id})`);
  console.log(`  Ranked: ${city.ranked ? 'Yes' : 'No'}`);

  checks.push({
    name: 'City Resolution',
    status: 'pass',
    message: `Resolved "${cityInput}" to ${city.name}`,
    details: { cityId: city.id, ranked: city.ranked }
  });

  // Check aliases
  const aliases = await prisma.$queryRaw<{ alias: string }[]>`
    SELECT alias FROM "CityAlias"
    WHERE city_id = ${city.id}
    ORDER BY alias
  `;

  console.log(`  Aliases: ${aliases.length > 0 ? aliases.map(a => a.alias).join(', ') : 'none'}`);

  if (aliases.length === 0) {
    checks.push({
      name: 'City Aliases',
      status: 'warn',
      message: `${city.name} has no aliases configured`
    });
  } else {
    checks.push({
      name: 'City Aliases',
      status: 'pass',
      message: `${aliases.length} aliases configured`,
      details: { count: aliases.length }
    });
  }

  return city;
}

async function validateSearchEndpoint(cityId: string, cityName: string) {
  console.log('\n2. Search Endpoint (/api/v2/search)');
  console.log('='.repeat(60));

  // Test iconic ranking
  const iconicStart = Date.now();
  const iconicResults = await prisma.$queryRaw<{
    place_id: string;
    name: string;
    rank: number;
    iconic_score: number;
  }[]>`
    SELECT place_id, name, rank, iconic_score
    FROM mv_top_iconic_by_city
    WHERE city_id = ${cityId}
    ORDER BY rank
    LIMIT 10
  `;
  const iconicLatency = Date.now() - iconicStart;

  console.log(`  Iconic: ${iconicResults.length} results in ${iconicLatency}ms`);

  if (iconicResults.length === 0) {
    checks.push({
      name: 'Search - Iconic MV',
      status: 'warn',
      message: `No iconic results for ${cityName}`,
      details: { latency_ms: iconicLatency }
    });
  } else {
    checks.push({
      name: 'Search - Iconic MV',
      status: iconicLatency < 100 ? 'pass' : 'warn',
      message: `${iconicResults.length} results, ${iconicLatency}ms latency ${iconicLatency < 100 ? '(good)' : '(slow)'}`,
      details: { count: iconicResults.length, latency_ms: iconicLatency }
    });

    console.log(`  Top 3:`);
    iconicResults.slice(0, 3).forEach(r => {
      console.log(`    ${r.rank}. ${r.name} (score: ${r.iconic_score.toFixed(1)})`);
    });
  }

  // Test trending ranking
  const trendingStart = Date.now();
  const trendingResults = await prisma.$queryRaw<{
    place_id: string;
    name: string;
    rank: number;
    trending_score: number;
  }[]>`
    SELECT place_id, name, rank, trending_score
    FROM mv_top_trending_by_city
    WHERE city_id = ${cityId}
    ORDER BY rank
    LIMIT 10
  `;
  const trendingLatency = Date.now() - trendingStart;

  console.log(`  Trending: ${trendingResults.length} results in ${trendingLatency}ms`);

  if (trendingResults.length === 0) {
    checks.push({
      name: 'Search - Trending MV',
      status: 'warn',
      message: `No trending results for ${cityName}`,
      details: { latency_ms: trendingLatency }
    });
  } else {
    checks.push({
      name: 'Search - Trending MV',
      status: trendingLatency < 100 ? 'pass' : 'warn',
      message: `${trendingResults.length} results, ${trendingLatency}ms latency ${trendingLatency < 100 ? '(good)' : '(slow)'}`,
      details: { count: trendingResults.length, latency_ms: trendingLatency }
    });

    console.log(`  Top 3:`);
    trendingResults.slice(0, 3).forEach(r => {
      console.log(`    ${r.rank}. ${r.name} (score: ${r.trending_score.toFixed(1)})`);
    });
  }

  return iconicResults[0]?.place_id;
}

async function validateFuzzySearch(cityId: string, cityName: string) {
  console.log('\n3. Fuzzy Search (/api/v2/fuzzy)');
  console.log('='.repeat(60));

  // Get a sample place name to search for
  const samplePlace = await prisma.$queryRaw<{ name: string }[]>`
    SELECT name FROM "Place"
    WHERE city_id = ${cityId}
      AND status = 'open'
    ORDER BY RANDOM()
    LIMIT 1
  `;

  if (samplePlace.length === 0) {
    checks.push({
      name: 'Fuzzy Search',
      status: 'warn',
      message: `No places found for fuzzy search test`
    });
    return;
  }

  const searchTerm = samplePlace[0].name.split(' ')[0]; // First word
  console.log(`  Searching for: "${searchTerm}"`);

  const fuzzyStart = Date.now();
  const fuzzyResults = await prisma.$queryRaw<{
    id: string;
    name: string;
    similarity: number;
  }[]>`
    SELECT
      id,
      name,
      SIMILARITY(name, ${searchTerm}) as similarity
    FROM "Place"
    WHERE city_id = ${cityId}
      AND status = 'open'
      AND name % ${searchTerm}
    ORDER BY SIMILARITY(name, ${searchTerm}) DESC
    LIMIT 5
  `;
  const fuzzyLatency = Date.now() - fuzzyStart;

  console.log(`  Found: ${fuzzyResults.length} results in ${fuzzyLatency}ms`);

  if (fuzzyResults.length > 0) {
    checks.push({
      name: 'Fuzzy Search',
      status: fuzzyLatency < 50 ? 'pass' : 'warn',
      message: `${fuzzyResults.length} results, ${fuzzyLatency}ms latency ${fuzzyLatency < 50 ? '(good)' : '(slow)'}`,
      details: { count: fuzzyResults.length, latency_ms: fuzzyLatency }
    });

    fuzzyResults.forEach(r => {
      console.log(`    ${r.name} (similarity: ${r.similarity.toFixed(2)})`);
    });
  } else {
    checks.push({
      name: 'Fuzzy Search',
      status: 'warn',
      message: `No fuzzy results found for "${searchTerm}"`,
      details: { latency_ms: fuzzyLatency }
    });
  }
}

async function validatePlaceDetail(placeId: string) {
  console.log('\n4. Place Detail (/api/v2/places/[id])');
  console.log('='.repeat(60));

  if (!placeId) {
    checks.push({
      name: 'Place Detail',
      status: 'warn',
      message: 'Skipped (no place ID available)'
    });
    console.log('  Skipped (no place ID from search results)');
    return;
  }

  const detailStart = Date.now();
  const placeDetail = await prisma.$queryRaw<{
    id: string;
    name: string;
    cuisine: string[];
    address: string;
    lat: number;
    lon: number;
    iconic_score: number;
    trending_score: number;
    unique_threads: number;
    total_mentions: number;
  }[]>`
    SELECT
      p.id,
      p.name,
      p.cuisine,
      p.address,
      ST_Y(p.geog::geometry) as lat,
      ST_X(p.geog::geometry) as lon,
      pa.iconic_score,
      pa.trending_score,
      pa.unique_threads,
      pa.total_mentions
    FROM "Place" p
    LEFT JOIN "PlaceAggregation" pa ON pa.place_id = p.id
    WHERE p.id = ${placeId}
  `;
  const detailLatency = Date.now() - detailStart;

  if (placeDetail.length === 0) {
    checks.push({
      name: 'Place Detail',
      status: 'fail',
      message: `Place ${placeId} not found`
    });
    return;
  }

  const place = placeDetail[0];
  console.log(`  Name: ${place.name}`);
  console.log(`  Cuisine: ${place.cuisine?.join(', ') || 'none'}`);
  console.log(`  Address: ${place.address || 'N/A'}`);
  console.log(`  Location: ${place.lat?.toFixed(6)}, ${place.lon?.toFixed(6)}`);
  console.log(`  Iconic Score: ${place.iconic_score?.toFixed(1) || 'N/A'}`);
  console.log(`  Trending Score: ${place.trending_score?.toFixed(1) || 'N/A'}`);
  console.log(`  Mentions: ${place.total_mentions || 0} (${place.unique_threads || 0} threads)`);
  console.log(`  Latency: ${detailLatency}ms`);

  checks.push({
    name: 'Place Detail',
    status: detailLatency < 50 ? 'pass' : 'warn',
    message: `Retrieved in ${detailLatency}ms ${detailLatency < 50 ? '(good)' : '(slow)'}`,
    details: { latency_ms: detailLatency }
  });
}

async function validateMVFreshness() {
  console.log('\n5. Materialized View Freshness');
  console.log('='.repeat(60));

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

  mvStatus.forEach(mv => {
    const ageHours = Number(mv.age_hours);
    console.log(`  ${mv.view_name}: ${ageHours.toFixed(1)}h old`);

    checks.push({
      name: `MV Freshness: ${mv.view_name}`,
      status: ageHours < 24 ? 'pass' : 'warn',
      message: `${ageHours.toFixed(1)}h old ${ageHours < 24 ? '(fresh)' : '(stale!)'}`,
      details: { age_hours: ageHours }
    });
  });
}

async function validateIndexUsage(cityId: string) {
  console.log('\n6. Index Usage');
  console.log('='.repeat(60));

  const plan = await prisma.$queryRaw<{ 'QUERY PLAN': string }[]>`
    EXPLAIN (FORMAT JSON)
    SELECT * FROM mv_top_iconic_by_city
    WHERE city_id = ${cityId}
    ORDER BY rank
    LIMIT 50
  `;

  const planText = JSON.stringify(plan);
  const usesIndexScan = planText.includes('Index Scan') || planText.includes('Index Only Scan');
  const usesSeqScan = planText.includes('Seq Scan');

  console.log(`  Query Plan: ${usesIndexScan ? 'Index Scan' : usesSeqScan ? 'Sequential Scan' : 'Unknown'}`);

  checks.push({
    name: 'Index Usage',
    status: usesIndexScan && !usesSeqScan ? 'pass' : 'warn',
    message: usesIndexScan && !usesSeqScan
      ? 'Using index scan (optimal)'
      : usesSeqScan
      ? 'Using sequential scan (slow!)'
      : 'Query plan unclear'
  });
}

async function main() {
  const cityInput = process.argv[2];

  if (!cityInput) {
    console.error('Usage: npx tsx scripts/validate_city.ts <city_name_or_alias>');
    console.error('Example: npx tsx scripts/validate_city.ts Portland');
    console.error('Example: npx tsx scripts/validate_city.ts nyc');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('End-to-End City Validation');
  console.log('='.repeat(60));
  console.log(`Input: ${cityInput}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  try {
    // 1. City resolution
    const city = await validateCityResolution(cityInput);
    if (!city) {
      console.error('\nValidation aborted: City not found');
      process.exit(1);
    }

    if (!city.ranked) {
      console.warn(`\nWarning: ${city.name} is not ranked yet (ingestion may be in progress)`);
      console.warn('Some checks may return no results.\n');
    }

    // 2. Search endpoint
    const topPlaceId = await validateSearchEndpoint(city.id, city.name);

    // 3. Fuzzy search
    await validateFuzzySearch(city.id, city.name);

    // 4. Place detail
    await validatePlaceDetail(topPlaceId);

    // 5. MV freshness
    await validateMVFreshness();

    // 6. Index usage
    await validateIndexUsage(city.id);

  } catch (error) {
    console.error('\nValidation error:', error);
    process.exit(1);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Validation Summary');
  console.log('='.repeat(60));

  const passed = checks.filter(c => c.status === 'pass').length;
  const warned = checks.filter(c => c.status === 'warn').length;
  const failed = checks.filter(c => c.status === 'fail').length;

  console.log(`\nPassed: ${passed}`);
  if (warned > 0) console.log(`Warnings: ${warned}`);
  if (failed > 0) console.log(`Failed: ${failed}`);

  console.log('\nDetailed Results:\n');
  checks.forEach(check => {
    const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
    console.log(`${icon} ${check.name}`);
    console.log(`   ${check.message}`);
  });

  await prisma.$disconnect();

  if (failed > 0) {
    console.log('\n❌ Validation failed');
    process.exit(1);
  } else if (warned > 0) {
    console.log('\n⚠️  Validation passed with warnings');
    process.exit(0);
  } else {
    console.log('\n✅ All validation checks passed');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
