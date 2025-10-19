/**
 * GET /api/v2/fuzzy - Autocomplete/fuzzy search endpoint
 *
 * Query params:
 * - q (required): Search query (min 2 chars)
 * - city: Filter by city (optional)
 * - limit: Results (default: 10, max: 50)
 *
 * Response headers:
 * - Cache-Control: public, max-age=300, stale-while-revalidate=3600
 * - X-RateLimit-*
 *
 * Response body:
 * {
 *   query: string,
 *   results: [
 *     {
 *       place_id, name, city, cuisine, address,
 *       lat, lon, similarity, rank (if ranked)
 *     }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { normalizeName } from '@/lib/match';
import prisma from '@/lib/prisma';
import tuning from '@/config/tuning.json';

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Parse query params
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const cityQuery = searchParams.get('city');
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '10'),
      50
    );

    // Validate required params
    if (!query || query.length < 2) {
      return NextResponse.json(
        { error: 'Query must be at least 2 characters' },
        { status: 400 }
      );
    }

    const normalized = normalizeName(query);
    const threshold = tuning.matching.trigram_threshold_default;

    // Resolve city if provided
    let cityId: string | null = null;
    if (cityQuery) {
      const city = await resolveCity(cityQuery);
      if (city) {
        cityId = city.id;
      }
    }

    // Fuzzy search with trigram similarity
    const cityFilter = cityId ? `AND city_id = '${cityId}'` : '';

    const results = await prisma.$queryRaw<any[]>`
      SELECT
        p.id as place_id,
        p.name,
        c.name as city,
        p.cuisine,
        p.address,
        ST_Y(p.geog::geometry) as lat,
        ST_X(p.geog::geometry) as lon,
        similarity(p.name_norm, ${normalized}) as similarity,
        COALESCE(pa.iconic_score, 0) as score
      FROM "Place" p
      JOIN "City" c ON c.id = p.city_id
      LEFT JOIN "PlaceAggregation" pa ON pa.place_id = p.id
      WHERE p.status = 'open'
        AND similarity(p.name_norm, ${normalized}) >= ${threshold}
        ${cityFilter}
      ORDER BY similarity DESC, score DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({
      query,
      results
    }, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
        'X-Response-Time': `${Date.now() - startTime}ms`
      }
    });

  } catch (error) {
    console.error('[fuzzy] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Resolve city from name/alias
 */
async function resolveCity(query: string): Promise<{ id: string; name: string } | null> {
  const normalized = query.toLowerCase().trim();

  const results = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT c.id, c.name
    FROM "City" c
    LEFT JOIN "CityAlias" ca ON ca.city_id = c.id
    WHERE LOWER(c.name) = ${normalized}
       OR LOWER(ca.alias) = ${normalized}
    LIMIT 1
  `;

  return results.length > 0 ? results[0] : null;
}
