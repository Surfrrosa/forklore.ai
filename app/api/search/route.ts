/**
 * End-to-end search API: Reddit → Extract → Resolve → Geofence → Bucket → Score
 *
 * GET /api/search?city=nyc&q=best&limit=50
 */

import { NextResponse } from "next/server";
import { extractCandidates } from "@/lib/extractor";
import { resolveDeterministic } from "@/lib/resolver";
import { NYC_SEED, NYC_SEED_DATA, NYC_CENTER, NYC_RADIUS_KM } from "@/lib/gazetteer";
import { inCityRadius } from "@/lib/geo";
import { bucketMentions, type Source } from "@/lib/bucketer";
import { rankRestaurants } from "@/lib/score";
import { getRedditClient } from "@/lib/reddit";

/** Simple subreddit set for pilot city */
const NYC_SUBS = ["FoodNYC", "AskNYC", "nyc"];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const city = (url.searchParams.get("city") || "nyc").toLowerCase();
    const q = url.searchParams.get("q") || "best";
    const limit = Number(url.searchParams.get("limit") || 50);

    // For MVP we only support NYC, but structure is city-agnostic
    const subs = city === "nyc" ? NYC_SUBS : NYC_SUBS;
    const center = city === "nyc" ? NYC_CENTER : NYC_CENTER;
    const radiusKm = city === "nyc" ? NYC_RADIUS_KM : NYC_RADIUS_KM;

    console.log(`🔍 Searching ${city} for "${q}" across ${subs.length} subreddits...`);

    const client = getRedditClient();

    // Fetch posts from each subreddit
    const postsPerSub = Math.ceil(limit / subs.length);
    const postArrays = await Promise.all(
      subs.map((sub) => client.searchPosts(sub, q, "month", postsPerSub))
    );
    const posts = postArrays.flat();

    console.log(`📝 Found ${posts.length} posts`);

    // Fetch comments for each post
    const commentPayloads = await Promise.all(
      posts.map(async (p) => {
        try {
          const comments = await client.getPostComments(p.subreddit, p.id, 100);
          return { post: p, comments };
        } catch (err) {
          console.warn(`Failed to fetch comments for post ${p.id}:`, err);
          return { post: p, comments: [] };
        }
      })
    );

    console.log(`💬 Fetched comments for ${commentPayloads.length} posts`);

    // Build "sources" for bucketer
    const sources: Source[] = commentPayloads.flatMap(({ post, comments }) => {
      const postSource: Source = {
        threadId: post.id,
        postUpvotes: post.score,
        commentUpvotes: 0,
        createdUtc: post.created_utc,
        text: `${post.title}\n\n${post.selftext || ""}`,
      };

      const commentSources: Source[] = comments.map((c) => ({
        threadId: post.id,
        postUpvotes: post.score,
        commentUpvotes: c.score,
        createdUtc: c.created_utc,
        text: c.body || "",
      }));

      return [postSource, ...commentSources];
    });

    console.log(`📊 Processing ${sources.length} sources...`);

    // Resolver with geofence
    const byId = new Map(NYC_SEED_DATA.map((v) => [v.id, v]));
    const resolve = (norm: string) => {
      const canon = resolveDeterministic(norm, NYC_SEED);
      if (!canon || canon.lat == null || canon.lon == null) return null;
      if (!inCityRadius({ lat: canon.lat, lon: canon.lon }, center, radiusKm)) return null;
      return canon;
    };

    // Bucket mentions by venue id
    const buckets = bucketMentions(sources, resolve, extractCandidates);

    console.log(`🏪 Found ${buckets.size} restaurants with mentions`);

    // Convert to scorer input
    const scorerInput = [...buckets.entries()].map(([id, mentions]) => {
      const venue = byId.get(id)!;
      return { name: venue.name, mentions };
    });

    // Rank
    const ranked = rankRestaurants(scorerInput);

    console.log(`✅ Ranked ${ranked.length} restaurants`);

    return NextResponse.json({
      city,
      query: q,
      totalThreads: posts.length,
      totalSources: sources.length,
      results: ranked.slice(0, 25),
    });
  } catch (err: any) {
    console.error("❌ Search error:", err);
    return NextResponse.json(
      { error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
