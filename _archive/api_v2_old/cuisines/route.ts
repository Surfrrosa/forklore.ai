/**
 * API v2: Cuisine facets for dynamic filtering
 *
 * GET /api/v2/cuisines?city=nyc
 *
 * Returns available cuisines with counts for a given city.
 * Powers UI filter dropdowns and category browsing.
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

export async function GET(req: Request) {
  // Rate limiting: 100 req/hour
  const rateLimitCheck = await checkRateLimit(req, RateLimitPresets.STANDARD);
  if (!rateLimitCheck.success) return rateLimitCheck.response!;

  try {
    const url = new URL(req.url);
    const cityParam = url.searchParams.get("city") || "nyc";
    const limit = Number(url.searchParams.get("limit") || 50);

    // Normalize city name
    const cityName = CITY_ALIASES[cityParam.toLowerCase()] || cityParam
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

    // Get cuisine counts from materialized view (fast!)
    const cuisines = await prisma.$queryRaw<
      Array<{ cuisine_type: string; count: number }>
    >(Prisma.sql`
      SELECT
        cuisine_type,
        COUNT(*)::int AS count
      FROM mv_top_by_cuisine
      WHERE city_id = ${city.id}
      GROUP BY cuisine_type
      ORDER BY count DESC
      LIMIT ${limit}
    `);

    // Format cuisine names for display
    const formatted = cuisines.map((c) => ({
      key: c.cuisine_type,
      label: c.cuisine_type
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase()),
      count: c.count,
    }));

    const cachedResponse = cachedJson(
      {
        city: cityName,
        count: formatted.length,
        cuisines: formatted,
      },
      CachePresets.FACETS
    );

    // Add rate limit headers
    return rateLimitCheck.wrap(cachedResponse);
  } catch (err: any) {
    console.error("❌ Cuisines API error:", err);
    return NextResponse.json(
      { error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
