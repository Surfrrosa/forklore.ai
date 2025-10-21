/**
 * GET /api/v2/cities - List all available cities
 *
 * Response:
 * {
 *   cities: [
 *     {
 *       id: string,
 *       name: string,
 *       country: string,
 *       ranked: boolean,
 *       stats: {
 *         total_places: number,
 *         total_mentions: number,
 *         last_refreshed: string | null
 *       }
 *     }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generousRateLimit } from '@/lib/rate-limit';
import { createApiResponse, createApiErrorResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  return await generousRateLimit(request, async () => {
    const startTime = Date.now();

    try {
      const cities = await prisma.$queryRaw<{
        id: string;
        name: string;
        country: string;
        ranked: boolean;
        lat: number | null;
        lon: number | null;
        last_refreshed_at: Date | null;
        total_places: bigint;
        total_mentions: bigint;
      }[]>`
        SELECT
          c.id,
          c.name,
          c.country,
          c.ranked,
          c.lat,
          c.lon,
          c.last_refreshed_at,
          COUNT(DISTINCT p.id) as total_places,
          COUNT(DISTINCT rm.id) as total_mentions
        FROM "City" c
        LEFT JOIN "Place" p ON p.city_id = c.id AND p.status = 'open'
        LEFT JOIN "RedditMention" rm ON rm.place_id = p.id
        GROUP BY c.id, c.name, c.country, c.ranked, c.lat, c.lon, c.last_refreshed_at
        ORDER BY c.ranked DESC, total_mentions DESC, c.name ASC
      `;

      // Convert BigInts to Numbers for JSON serialization
      const serializedCities = cities.map(city => ({
        id: city.id,
        name: city.name,
        country: city.country,
        ranked: city.ranked,
        coordinates: city.lat && city.lon ? {
          lat: city.lat,
          lon: city.lon
        } : null,
        stats: {
          total_places: Number(city.total_places),
          total_mentions: Number(city.total_mentions),
          last_refreshed: city.last_refreshed_at?.toISOString() || null
        }
      }));

      return createApiResponse({
        cities: serializedCities,
        total: serializedCities.length,
        ranked: serializedCities.filter(c => c.ranked).length
      }, startTime, {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600'
      });

    } catch (error) {
      console.error('[cities] Error:', error);
      return createApiErrorResponse('Internal server error', 500, 'INTERNAL_ERROR');
    }
  });
}
