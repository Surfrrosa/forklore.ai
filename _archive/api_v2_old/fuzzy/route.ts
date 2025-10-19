/**
 * API v2: Fuzzy name search
 *
 * GET /api/v2/fuzzy?q=katz&city=nyc
 *
 * Uses pg_trgm trigram similarity for fast fuzzy matching
 * Perfect for autocomplete and "did you mean?" suggestions
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
  // Rate limiting: 300 req/hour (generous for autocomplete)
  const rateLimitCheck = await checkRateLimit(req, RateLimitPresets.GENEROUS);
  if (!rateLimitCheck.success) return rateLimitCheck.response!;

  try {
    const url = new URL(req.url);
    const query = url.searchParams.get("q");
    const cityParam = url.searchParams.get("city");
    const limit = Number(url.searchParams.get("limit") || 10);

    if (!query || query.length < 2) {
      return NextResponse.json(
        { error: "Query must be at least 2 characters" },
        { status: 400 }
      );
    }

    const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();

    // Use pg_trgm similarity search with proper Prisma.sql
    const cityFilter = cityParam
      ? Prisma.sql`AND c.name ILIKE ${"%" + cityParam + "%"}`
      : Prisma.empty;

    const results = await prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        address: string | null;
        city_name: string;
        cuisine: string[];
        similarity: number;
      }>
    >(Prisma.sql`
      SELECT
        p.id,
        p.name,
        p.address,
        c.name as city_name,
        p.cuisine,
        similarity(p."nameNorm", ${normalizedQuery}) as similarity
      FROM "Place" p
      JOIN "City" c ON p."cityId" = c.id
      WHERE
        p.status = 'active'
        ${cityFilter}
        AND similarity(p."nameNorm", ${normalizedQuery}) > 0.5
      ORDER BY similarity DESC
      LIMIT ${limit}
    `);

    const cachedResponse = cachedJson(
      {
        query,
        city: cityParam || "all",
        count: results.length,
        results: results.map((r) => ({
          id: r.id,
          name: r.name,
          address: r.address,
          city: r.city_name,
          cuisine: r.cuisine,
          matchScore: Number(r.similarity.toFixed(2)),
        })),
      },
      CachePresets.FUZZY
    );

    // Add rate limit headers
    return rateLimitCheck.wrap(cachedResponse);
  } catch (err: any) {
    console.error("❌ API v2 fuzzy search error:", err);
    return NextResponse.json(
      { error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
