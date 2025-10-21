/**
 * GET /api/v2/search - Main search endpoint
 *
 * Query params:
 * - city (required): City name or alias
 * - type (required): 'iconic' | 'trending' | 'cuisine'
 * - cuisine: Cuisine filter (for type=cuisine, optional for others)
 * - limit: Results per page (default: 50, max: 100)
 * - offset: Pagination offset (default: 0)
 *
 * Response headers:
 * - Cache-Control: public, max-age=3600, stale-while-revalidate=86400
 * - ETag: <mv_version_hash>
 * - X-RateLimit-*
 *
 * Response body:
 * {
 *   ranked: boolean,           // true if from MVs, false if unranked OSM
 *   rank_source: string,        // 'mv_iconic' | 'mv_trending' | 'unranked_osm'
 *   last_refreshed_at: string,  // ISO timestamp
 *   cache: 'hit' | 'miss',
 *   results: [...],
 *   pagination: { offset, limit, total, has_more }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import tuning from '@/config/tuning.json';
import { generousRateLimit } from '@/lib/rate-limit';
import { createApiResponse, createApiErrorResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  // Apply rate limiting (100 req/min)
  return await generousRateLimit(request, async () => {
    const startTime = Date.now();

    try {
    // Parse query params
    const { searchParams } = new URL(request.url);
    const cityQuery = searchParams.get('city');
    const type = searchParams.get('type') as 'iconic' | 'trending' | 'cuisine' | null;
    const cuisine = searchParams.get('cuisine');
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '50'),
      tuning.pagination.max_limit
    );
    const offset = parseInt(searchParams.get('offset') || '0');

    // Validate required params
    if (!cityQuery) {
      return createApiErrorResponse('Missing required parameter: city', 400, 'MISSING_PARAM');
    }

    if (!type || !['iconic', 'trending', 'cuisine'].includes(type)) {
      return createApiErrorResponse('Invalid type. Must be: iconic, trending, or cuisine', 400, 'INVALID_TYPE');
    }

    // Resolve city (check aliases)
    const city = await resolveCity(cityQuery);

    if (!city) {
      return createApiErrorResponse(`City not found: ${cityQuery}`, 404, 'CITY_NOT_FOUND');
    }

    // Check if city is ranked (has Reddit data)
    if (!city.ranked) {
      // Return unranked results (OSM bootstrap data)
      const unrankedResults = await getUnrankedResults(city.id, limit, offset, cuisine);

      return createApiResponse({
        ranked: false,
        rank_source: 'unranked_osm',
        last_refreshed_at: null,
        cache: 'miss',
        results: unrankedResults.results,
        pagination: {
          offset,
          limit,
          total: unrankedResults.total,
          has_more: offset + limit < unrankedResults.total
        }
      }, startTime, {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600'
      });
    }

    // Get ranked results from MVs
    const mvName = type === 'iconic' ? 'mv_top_iconic_by_city' : 'mv_top_trending_by_city';
    const results = await getRankedResults(city.id, mvName, limit, offset, cuisine);

    // Get MV version for ETag
    const mvVersion = await getMVVersion(mvName);

    // Compute ETag
    const etag = `"${mvVersion.version_hash}-${city.id}-${type}-${cuisine || 'all'}-${offset}-${limit}"`;

    // Check If-None-Match
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
        }
      });
    }

    return createApiResponse({
      ranked: true,
      rank_source: `mv_${type}`,
      last_refreshed_at: mvVersion.refreshed_at.toISOString(),
      cache: 'hit',
      results: results.results,
      pagination: {
        offset,
        limit,
        total: results.total,
        has_more: offset + limit < results.total
      }
    }, startTime, {
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'ETag': etag
    });

    } catch (error) {
      console.error('[search] Error:', error);
      return createApiErrorResponse('Internal server error', 500, 'INTERNAL_ERROR');
    }
  });
}

/**
 * Resolve city from name/alias
 */
async function resolveCity(query: string): Promise<{ id: string; name: string; ranked: boolean } | null> {
  const normalized = query.toLowerCase().trim();

  // Try direct city name match
  const direct = await prisma.$queryRaw<{ id: string; name: string; ranked: boolean }[]>`
    SELECT id, name, ranked
    FROM "City"
    WHERE LOWER(name) = ${normalized}
    LIMIT 1
  `;

  if (direct.length > 0) {
    return direct[0];
  }

  // Try alias match
  const alias = await prisma.$queryRaw<{ id: string; name: string; ranked: boolean }[]>`
    SELECT c.id, c.name, c.ranked
    FROM "City" c
    JOIN "CityAlias" ca ON ca.city_id = c.id
    WHERE LOWER(ca.alias) = ${normalized}
    LIMIT 1
  `;

  if (alias.length > 0) {
    return alias[0];
  }

  return null;
}

/**
 * Result types
 */
interface UnrankedResult {
  place_id: string;
  name: string;
  cuisine: string[];
  address: string | null;
  lat: number;
  lon: number;
  brand: string | null;
  source: string;
}

interface RankedResult {
  place_id: string;
  city_id: string;
  name: string;
  cuisine: string[];
  address: string | null;
  lat: number;
  lon: number;
  rank: bigint;
  iconic_score?: number;
  trending_score?: number;
  unique_threads: bigint;
  total_mentions: bigint;
}

/**
 * Get unranked results (for cities without Reddit data)
 */
async function getUnrankedResults(
  cityId: string,
  limit: number,
  offset: number,
  cuisine?: string | null
): Promise<{ results: UnrankedResult[]; total: number }> {

  // Build separate queries for cuisine filter vs no filter
  const results = cuisine
    ? await prisma.$queryRaw<UnrankedResult[]>`
        SELECT
          id as place_id,
          name,
          cuisine,
          address,
          ST_Y(geog::geometry) as lat,
          ST_X(geog::geometry) as lon,
          brand,
          source
        FROM "Place"
        WHERE city_id = ${cityId}
          AND status = 'open'
          AND ${cuisine} = ANY(cuisine)
        ORDER BY name
        LIMIT ${limit}
        OFFSET ${offset}
      `
    : await prisma.$queryRaw<UnrankedResult[]>`
        SELECT
          id as place_id,
          name,
          cuisine,
          address,
          ST_Y(geog::geometry) as lat,
          ST_X(geog::geometry) as lon,
          brand,
          source
        FROM "Place"
        WHERE city_id = ${cityId}
          AND status = 'open'
        ORDER BY name
        LIMIT ${limit}
        OFFSET ${offset}
      `;

  const totalResult = cuisine
    ? await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count
        FROM "Place"
        WHERE city_id = ${cityId}
          AND status = 'open'
          AND ${cuisine} = ANY(cuisine)
      `
    : await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count
        FROM "Place"
        WHERE city_id = ${cityId}
          AND status = 'open'
      `;

  return {
    results,
    total: Number(totalResult[0].count)
  };
}

/**
 * Get ranked results from materialized view
 */
async function getRankedResults(
  cityId: string,
  mvName: string,
  limit: number,
  offset: number,
  cuisine?: string | null
): Promise<{ results: RankedResult[]; total: number }> {
  // Validate mvName (whitelist only - table identifiers can't be parameterized)
  const allowedViews = ['mv_top_iconic_by_city', 'mv_top_trending_by_city'];
  if (!allowedViews.includes(mvName)) {
    throw new Error(`Invalid MV name: ${mvName}`);
  }

  // Since mvName is validated via whitelist, we can safely interpolate it
  // Cuisine parameter is still safely parameterized
  const results = cuisine
    ? await prisma.$queryRawUnsafe<RankedResult[]>(
        `SELECT * FROM "${mvName}" WHERE city_id = $1 AND $2 = ANY(cuisine) ORDER BY rank LIMIT $3 OFFSET $4`,
        cityId, cuisine, limit, offset
      )
    : await prisma.$queryRawUnsafe<RankedResult[]>(
        `SELECT * FROM "${mvName}" WHERE city_id = $1 ORDER BY rank LIMIT $2 OFFSET $3`,
        cityId, limit, offset
      );

  const totalResult = cuisine
    ? await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) as count FROM "${mvName}" WHERE city_id = $1 AND $2 = ANY(cuisine)`,
        cityId, cuisine
      )
    : await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) as count FROM "${mvName}" WHERE city_id = $1`,
        cityId
      );

  // Convert BigInts to Numbers for JSON serialization
  const serializedResults = results.map(r => ({
    ...r,
    rank: Number(r.rank),
    unique_threads: Number(r.unique_threads),
    total_mentions: Number(r.total_mentions)
  }));

  return {
    results: serializedResults,
    total: Number(totalResult[0].count)
  };
}

/**
 * Get MV version for ETag
 */
async function getMVVersion(mvName: string): Promise<{ version_hash: string; refreshed_at: Date }> {
  const result = await prisma.$queryRaw<{ version_hash: string; refreshed_at: Date }[]>`
    SELECT version_hash, refreshed_at
    FROM "MaterializedViewVersion"
    WHERE view_name = ${mvName}
    LIMIT 1
  `;

  if (result.length === 0) {
    // No version yet, return default
    return {
      version_hash: 'initial',
      refreshed_at: new Date()
    };
  }

  return result[0];
}
