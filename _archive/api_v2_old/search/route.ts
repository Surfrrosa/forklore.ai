/**
 * API v2: Pre-computed restaurant rankings
 *
 * GET /api/v2/search?city=nyc&type=iconic&limit=50&offset=0
 * GET /api/v2/search?city=nyc&type=cuisine&cuisine=pizza_restaurant&cuisine=italian_restaurant
 * GET /api/v2/search?city=nyc&type=iconic&facets=true
 * GET /api/v2/search?city=nyc&type=trending&limit=20&offset=20
 *
 * Query params:
 * - city: City code (nyc, sf, la) or name
 * - type: iconic | trending | cuisine
 * - cuisine: Cuisine type(s) for type=cuisine (can specify multiple)
 * - limit: Results per page (default: 50, max: 100)
 * - offset: Pagination offset (default: 0)
 * - facets: Include cuisine facets (true/false)
 *
 * Strategy:
 * - Query materialized views (mv_top_iconic_by_city, mv_top_trending_by_city, mv_top_by_cuisine)
 * - Sub-100ms latency (<10ms typical)
 * - Zero runtime API costs
 * - All data pre-computed from historical Reddit + Overture Places
 * - Aggressive caching (1hr + 24hr stale-while-revalidate)
 */

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { cachedJson, CachePresets } from "@/lib/cache";
import { checkRateLimit, RateLimitPresets } from "@/lib/ratelimit";

const prisma = getPrisma();

/** City name normalization */
const CITY_ALIASES: Record<string, string> = {
  "nyc": "New York",
  "sf": "San Francisco",
  "la": "Los Angeles",
};

type RankingType = "iconic" | "trending" | "cuisine";

export async function GET(req: Request) {
  // Rate limiting: 100 req/hour per IP
  const rateLimitCheck = await checkRateLimit(req, RateLimitPresets.STANDARD);
  if (!rateLimitCheck.success) return rateLimitCheck.response!;

  try {
    const url = new URL(req.url);
    const cityParam = (url.searchParams.get("city") || "nyc").toLowerCase();
    const type = (url.searchParams.get("type") || "iconic") as RankingType;
    const cuisines = url.searchParams.getAll("cuisine"); // Support multiple cuisines
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100); // Max 100
    const offset = Number(url.searchParams.get("offset") || 0);
    const includeFacets = url.searchParams.get("facets") === "true";

    // Normalize city name
    const cityName = CITY_ALIASES[cityParam] || cityParam
      .split(",")[0]
      .trim()
      .replace(/^\w/, (c) => c.toUpperCase());

    // Find city in database
    const city = await prisma.city.findFirst({
      where: {
        name: {
          contains: cityName,
          mode: "insensitive",
        },
      },
    });

    if (!city) {
      return NextResponse.json(
        { error: `City "${cityName}" not found` },
        { status: 404 }
      );
    }

    let results;

    if (type === "iconic") {
      // Query mv_top_iconic_by_city materialized view
      results = await prisma.$queryRaw`
        SELECT
          place_id AS "placeId",
          name,
          cuisine,
          address,
          lat,
          lon,
          iconic_score AS score,
          unique_threads AS "uniqueThreads",
          total_mentions AS "totalMentions",
          total_upvotes AS "totalUpvotes",
          last_seen AS "lastSeen",
          top_snippets AS "topSnippets",
          rank::int AS rank
        FROM mv_top_iconic_by_city
        WHERE city_id = ${city.id}
          AND rank > ${offset}
          AND rank <= ${offset + limit}
        ORDER BY rank ASC
      `;
    } else if (type === "trending") {
      // Query mv_top_trending_by_city materialized view
      results = await prisma.$queryRaw`
        SELECT
          place_id AS "placeId",
          name,
          cuisine,
          address,
          lat,
          lon,
          trending_score AS score,
          mentions_90d AS "mentions90d",
          last_seen AS "lastSeen",
          top_snippets AS "topSnippets",
          rank::int AS rank
        FROM mv_top_trending_by_city
        WHERE city_id = ${city.id}
          AND rank > ${offset}
          AND rank <= ${offset + limit}
        ORDER BY rank ASC
      `;
    } else if (type === "cuisine") {
      if (cuisines.length === 0) {
        return NextResponse.json(
          { error: "At least one cuisine parameter required for type=cuisine" },
          { status: 400 }
        );
      }

      // Support multiple cuisines with deduplication
      results = await prisma.$queryRaw`
        SELECT DISTINCT ON (place_id)
          place_id AS "placeId",
          name,
          cuisine_type AS cuisine,
          address,
          lat,
          lon,
          iconic_score AS score,
          total_mentions AS "totalMentions",
          rank::int AS rank
        FROM mv_top_by_cuisine
        WHERE city_id = ${city.id}
          AND cuisine_type = ANY(${cuisines}::text[])
          AND rank > ${offset}
          AND rank <= ${offset + limit}
        ORDER BY place_id, rank ASC
        LIMIT ${limit}
      `;
    } else {
      return NextResponse.json(
        { error: "Invalid query parameters" },
        { status: 400 }
      );
    }

    // Optionally include facets (cuisine counts)
    let facets = null;
    if (includeFacets) {
      const cuisineFacets = await prisma.$queryRaw<
        Array<{ cuisine_type: string; count: number }>
      >(Prisma.sql`
        SELECT
          cuisine_type,
          COUNT(*)::int AS count
        FROM mv_top_by_cuisine
        WHERE city_id = ${city.id}
        GROUP BY cuisine_type
        ORDER BY count DESC
        LIMIT 50
      `);

      facets = {
        cuisines: cuisineFacets.map((c) => ({
          key: c.cuisine_type,
          label: c.cuisine_type
            .replace(/_/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase()),
          count: c.count,
        })),
      };
    }

    const response: any = {
      city: cityName,
      type,
      count: (results as any[]).length,
      results,
      pagination: {
        limit,
        offset,
        hasMore: (results as any[]).length === limit, // If full page, likely more results
        nextOffset: offset + limit,
      },
      cached: true, // All results from materialized views
      timestamp: new Date().toISOString(),
    };

    if (cuisines.length > 0) {
      response.cuisines = cuisines;
    }

    if (facets) {
      response.facets = facets;
    }

    // Add cache headers with ETag based on timestamp
    // MV data is stable between refreshes, so cache aggressively
    const cachedResponse = cachedJson(response, {
      ...CachePresets.MV,
      etagData: response.timestamp,
    });

    // Add rate limit headers
    return rateLimitCheck.wrap(cachedResponse);
  } catch (err: any) {
    console.error("❌ API v2 error:", err);
    return NextResponse.json(
      { error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
