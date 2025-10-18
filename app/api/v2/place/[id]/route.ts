/**
 * API v2: Restaurant details
 *
 * GET /api/v2/place/{id}
 *
 * Returns full details for a single restaurant including:
 * - Basic info (name, address, location)
 * - Aggregated scores
 * - Top snippets
 * - Recent mentions
 */

import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // Fetch place with aggregation
    const place = await prisma.place.findUnique({
      where: { id },
      include: {
        city: true,
        agg: true,
      },
    });

    if (!place) {
      return NextResponse.json(
        { error: "Restaurant not found" },
        { status: 404 }
      );
    }

    // Fetch recent mentions (last 50)
    const mentions = await prisma.redditMention.findMany({
      where: { placeId: id },
      orderBy: { timestamp: "desc" },
      take: 50,
      select: {
        id: true,
        subreddit: true,
        postId: true,
        commentId: true,
        score: true,
        timestamp: true,
        snippet: true,
      },
    });

    // Extract lat/lon from geography
    const geog = place.geog as any;
    let lat = null;
    let lon = null;

    // If geog is stored as WKB or text, parse it
    // For now, we'll use a raw query to extract coordinates
    const coords = await prisma.$queryRaw<Array<{ lat: number; lon: number }>>`
      SELECT
        ST_Y(geog::geometry) as lat,
        ST_X(geog::geometry) as lon
      FROM "Place"
      WHERE id = ${id}
    `;

    if (coords && coords.length > 0) {
      lat = coords[0].lat;
      lon = coords[0].lon;
    }

    return NextResponse.json({
      id: place.id,
      name: place.name,
      address: place.address,
      city: place.city.name,
      cuisine: place.cuisine,
      location: { lat, lon },
      status: place.status,
      scores: place.agg
        ? {
            iconic: Number(place.agg.iconicScore),
            trending: Number(place.agg.trendingScore),
            mentions90d: place.agg.mentions90d,
            uniqueThreads: place.agg.uniqueThreads,
            totalMentions: place.agg.totalMentions,
            totalUpvotes: place.agg.totalUpvotes,
            lastSeen: place.agg.lastSeen,
            topSnippets: place.agg.topSnippets,
          }
        : null,
      recentMentions: mentions.map((m) => ({
        subreddit: m.subreddit,
        score: m.score,
        timestamp: m.timestamp,
        snippet: m.snippet,
        permalink: `https://reddit.com/r/${m.subreddit}/comments/${m.postId.replace("t3_", "")}`
          + (m.commentId ? `/_/${m.commentId.replace("t1_", "")}` : ""),
      })),
    });
  } catch (err: any) {
    console.error("❌ API v2 place details error:", err);
    return NextResponse.json(
      { error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
