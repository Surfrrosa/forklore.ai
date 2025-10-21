/**
 * GET /api/v2/places/:id - Get single place details with all mentions
 *
 * Response:
 * {
 *   id: string,
 *   name: string,
 *   city: { id, name, country },
 *   coordinates: { lat, lon },
 *   address: string | null,
 *   cuisine: string[],
 *   brand: string | null,
 *   scores: {
 *     iconic: number,
 *     trending: number
 *   },
 *   mentions: {
 *     total: number,
 *     unique_threads: number,
 *     total_upvotes: number,
 *     recent_count: number,
 *     last_seen: string
 *   },
 *   top_mentions: [...],
 *   source: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { standardRateLimit } from '@/lib/rate-limit';
import { createApiResponse, createApiErrorResponse } from '@/lib/api-response';

interface PlaceDetail {
  id: string;
  name: string;
  city_id: string;
  city_name: string;
  city_country: string;
  lat: number;
  lon: number;
  address: string | null;
  cuisine: string[];
  brand: string | null;
  source: string;
  iconic_score: number | null;
  trending_score: number | null;
  unique_threads: number | null;
  total_mentions: number | null;
  total_upvotes: number | null;
  mentions_90d: number | null;
  last_seen: Date | null;
  top_snippets: any;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return await standardRateLimit(request, async () => {
    const startTime = Date.now();
    const { id } = params;

    try {
      // Get place with aggregation data
      const result = await prisma.$queryRaw<PlaceDetail[]>`
        SELECT
          p.id,
          p.name,
          p.city_id,
          c.name as city_name,
          c.country as city_country,
          ST_Y(p.geog::geometry) as lat,
          ST_X(p.geog::geometry) as lon,
          p.address,
          p.cuisine,
          p.brand,
          p.source,
          pa.iconic_score,
          pa.trending_score,
          pa.unique_threads,
          pa.total_mentions,
          pa.total_upvotes,
          pa.mentions_90d,
          pa.last_seen,
          pa.top_snippets
        FROM "Place" p
        JOIN "City" c ON c.id = p.city_id
        LEFT JOIN "PlaceAggregation" pa ON pa.place_id = p.id
        WHERE p.id = ${id}
        LIMIT 1
      `;

      if (result.length === 0) {
        return createApiErrorResponse('Place not found', 404, 'PLACE_NOT_FOUND');
      }

      const place = result[0];

      // Get recent mentions (last 10)
      const recentMentions = await prisma.$queryRaw<{
        permalink: string;
        score: number;
        ts: Date;
        subreddit: string;
      }[]>`
        SELECT permalink, score, ts, subreddit
        FROM "RedditMention"
        WHERE place_id = ${id}
        ORDER BY ts DESC
        LIMIT 10
      `;

      return createApiResponse({
        id: place.id,
        name: place.name,
        city: {
          id: place.city_id,
          name: place.city_name,
          country: place.city_country
        },
        coordinates: {
          lat: place.lat,
          lon: place.lon
        },
        address: place.address,
        cuisine: place.cuisine,
        brand: place.brand,
        scores: place.iconic_score ? {
          iconic: Number(place.iconic_score),
          trending: Number(place.trending_score)
        } : null,
        mentions: place.total_mentions ? {
          total: place.total_mentions,
          unique_threads: place.unique_threads,
          total_upvotes: place.total_upvotes,
          recent_count: place.mentions_90d,
          last_seen: place.last_seen?.toISOString() || null
        } : null,
        top_mentions: place.top_snippets || [],
        recent_mentions: recentMentions.map(m => ({
          permalink: m.permalink,
          score: m.score,
          timestamp: m.ts.toISOString(),
          subreddit: m.subreddit
        })),
        source: place.source
      }, startTime, {
        'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600'
      });

    } catch (error) {
      console.error('[places/:id] Error:', error);
      return createApiErrorResponse('Internal server error', 500, 'INTERNAL_ERROR');
    }
  });
}
