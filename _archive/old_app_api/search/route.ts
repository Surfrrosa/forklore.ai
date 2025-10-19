/**
 * End-to-end search API: Reddit → Extract → Validate with Google Places → Rank
 *
 * GET /api/search?city=nyc&limit=50
 *
 * Strategy:
 * 1. Extract capitalized names from Reddit threads
 * 2. Validate each candidate with Google Places API
 * 3. Rank validated restaurants by Reddit signal
 */

import { NextResponse } from "next/server";
import { extractCandidates, normalizeName } from "@/lib/extractor";
import { rankRestaurants, type Mention } from "@/lib/score";
import { getRedditClient } from "@/lib/reddit";

/** City-specific subreddit mapping */
const CITY_SUBREDDITS: Record<string, string[]> = {
  "nyc": ["FoodNYC", "AskNYC", "nyc"],
  "new york": ["FoodNYC", "AskNYC", "nyc"],
  "sf": ["sanfrancisco", "AskSF", "bayarea"],
  "san francisco": ["sanfrancisco", "AskSF", "bayarea"],
  "la": ["FoodLosAngeles", "AskLosAngeles", "losangeles"],
  "los angeles": ["FoodLosAngeles", "AskLosAngeles", "losangeles"],
  "chicago": ["chicagofood", "AskChicago", "chicago"],
  "austin": ["austinfood", "Austin"],
  "seattle": ["SeattleFood", "AskSeattle", "Seattle"],
  "portland": ["FoodPortland", "askportland", "Portland"],
  "boston": ["BostonFood", "boston"],
  "philadelphia": ["FoodPhilly", "philadelphia"],
  "denver": ["denverfood", "Denver"],
  "miami": ["FoodMiami", "miami"],
  "atlanta": ["ATLFoodies", "Atlanta"],
};

/** Validate restaurant with Google Places API */
async function validateRestaurant(name: string, city: string): Promise<{
  isValid: boolean;
  officialName?: string;
  placeId?: string;
  address?: string;
  cuisine?: string;
}> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn("No Google Places API key - skipping validation");
    return { isValid: false };
  }

  try {
    // Use Text Search to find restaurant
    const searchQuery = `${name} restaurant ${city}`;
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchQuery)}&key=${apiKey}`;

    const response = await fetch(searchUrl);
    const data = await response.json();

    if (data.status !== "OK") {
      if (data.status === "REQUEST_DENIED") {
        console.error(`❌ Google Places API: ${data.error_message || 'REQUEST_DENIED'}`);
      }
      return { isValid: false };
    }

    if (!data.results || data.results.length === 0) {
      return { isValid: false };
    }

    const place = data.results[0];

    // Check if it's actually a restaurant
    const types = place.types || [];
    const isRestaurant = types.some((t: string) =>
      ["restaurant", "food", "bar", "cafe", "meal_takeaway", "meal_delivery"].includes(t)
    );

    if (!isRestaurant) {
      return { isValid: false };
    }

    // CRITICAL: Verify the restaurant is actually in the requested city
    const address = place.formatted_address || "";
    const cityName = city.split(",")[0].trim().toLowerCase(); // "logan" from "logan, wv"
    const addressLower = address.toLowerCase();

    // City name mapping for common aliases
    const cityAliases: Record<string, string[]> = {
      "nyc": ["new york", "brooklyn", "queens", "bronx", "manhattan", "staten island"],
      "new york": ["new york", "brooklyn", "queens", "bronx", "manhattan", "staten island"],
      "sf": ["san francisco"],
      "san francisco": ["san francisco"],
      "la": ["los angeles"],
      "los angeles": ["los angeles"],
    };

    // Check if city name or any alias appears in address
    const validNames = cityAliases[cityName] || [cityName];
    const matchesCity = validNames.some(name => addressLower.includes(name));

    if (!matchesCity) {
      console.log(`❌ Rejected "${place.name}": Not in ${city} (address: ${address})`);
      return { isValid: false };
    }

    // Extract cuisine from types
    const cuisineTypes = types.filter((t: string) =>
      !["restaurant", "food", "point_of_interest", "establishment"].includes(t)
    );
    const cuisine = cuisineTypes.length > 0
      ? cuisineTypes[0].replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())
      : undefined;

    return {
      isValid: true,
      officialName: place.name,
      placeId: place.place_id,
      address: place.formatted_address,
      cuisine,
    };
  } catch (err) {
    console.warn(`Failed to validate "${name}":`, err);
    return { isValid: false };
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const city = (url.searchParams.get("city") || "nyc").toLowerCase();
    const limit = Number(url.searchParams.get("limit") || 50);

    // Get subreddits for this city, or fall back to general food subs
    const subs = CITY_SUBREDDITS[city] || ["food", "AskReddit", "restaurants"];

    // Focused category queries - top 20 most popular food types
    // This balances coverage with performance (20 queries × 3 subs = 60 requests, under rate limit)
    const searchQueries = CITY_SUBREDDITS[city]
      ? [
          // General & most searched
          "best restaurant", "restaurant recommendation", "hidden gem",
          // Top cuisines
          "best pizza", "best ramen", "best sushi", "best burger", "best taco",
          "best chinese", "best italian", "best mexican", "best thai", "best indian",
          // NYC/Urban staples
          "best deli", "best bagel", "best steakhouse", "best sandwich",
          // Other popular
          "best breakfast", "best brunch", "best bbq", "best fried chicken", "best seafood"
        ]
      : [`best restaurant ${city}`, `where to eat ${city}`, `best food ${city}`];

    console.log(`🔍 Searching ${city} across ${subs.length} subreddits (${subs.join(", ")}) with ${searchQueries.length} queries...`);

    const client = getRedditClient();

    // STRATEGY: Category-specific queries to catch iconic restaurants
    // - 20 queries × 3 subs = 60 parallel requests (under 100/min rate limit)
    // - Get top 50 posts per query from last year
    // - After deduplication + sorting by score, we'll have ~200-300 unique high-quality posts
    const postsPerQuery = 50;
    const allPostPromises = [];

    for (const sub of subs) {
      for (const query of searchQueries) {
        allPostPromises.push(
          client.searchPosts(sub, query, "year", postsPerQuery)
        );
      }
    }

    const postArrays = await Promise.all(allPostPromises);

    // Deduplicate posts by ID and sort by score (upvotes) to prioritize quality threads
    const postMap = new Map();
    for (const posts of postArrays) {
      for (const post of posts) {
        if (!postMap.has(post.id)) {
          postMap.set(post.id, post);
        }
      }
    }
    const allPosts = Array.from(postMap.values());

    // Sort by score and take top 150 posts - this focuses on the most valuable threads
    const posts = allPosts
      .sort((a, b) => b.score - a.score)
      .slice(0, 150);

    console.log(`📝 Found ${posts.length} posts`);

    // Fetch comments
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

    // Extract candidates and group by normalized name
    type MentionData = {
      threadId: string;
      postUpvotes: number;
      commentUpvotes: number;
      ageDays: number;
      contextChars: number;
    };

    const groupedMentions = new Map<string, MentionData[]>();
    let totalCandidates = 0;

    // Extract city name for context filtering (e.g., "logan" from "logan, wv")
    const targetCity = city.split(",")[0].trim();

    for (const { post, comments } of commentPayloads) {
      const sources = [
        { text: `${post.title}\n\n${post.selftext || ""}`, upvotes: post.score, created: post.created_utc, isPost: true },
        ...comments.map(c => ({ text: c.body || "", upvotes: c.score, created: c.created_utc, isPost: false }))
      ];

      for (const source of sources) {
        // Pass targetCity to filter out mentions from wrong location contexts
        const candidates = extractCandidates(source.text, targetCity);
        totalCandidates += candidates.length;

        for (const candidate of candidates) {
          const normalized = normalizeName(candidate.raw);

          // Basic filtering - must be multi-word or have food suffix
          const words = normalized.split(' ');
          if (words.length === 1 && !candidate.hasFoodWord) continue;

          const ageDays = (Date.now() / 1000 - source.created) / 86400;

          if (!groupedMentions.has(normalized)) {
            groupedMentions.set(normalized, []);
          }

          groupedMentions.get(normalized)!.push({
            threadId: post.id,
            postUpvotes: source.isPost ? source.upvotes : 0,  // Only count post upvotes if mentioned in post
            commentUpvotes: source.isPost ? 0 : source.upvotes, // Only count comment upvotes if mentioned in comment
            ageDays,
            contextChars: source.text.length,
          });
        }
      }
    }

    console.log(`📊 Extracted ${totalCandidates} candidates → ${groupedMentions.size} unique candidates`);

    // Validate candidates with Google Places API
    console.log(`🔍 Validating candidates with Google Places API...`);

    type ValidatedVenue = {
      name: string;
      officialName: string;
      placeId: string;
      address?: string;
      cuisine?: string;
      mentions: MentionData[];
    };

    const validatedVenues: ValidatedVenue[] = [];
    const seenPlaceIds = new Set<string>(); // Deduplicate by Place ID
    let validationCount = 0;

    // Sort by mention count to prioritize likely restaurants
    // Increased from 100 to 200 to catch more potential matches
    const sortedCandidates = Array.from(groupedMentions.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 200); // Validate top 200 candidates

    for (const [name, mentions] of sortedCandidates) {
      validationCount++;
      const validation = await validateRestaurant(name, city);

      if (validation.isValid && validation.officialName && validation.placeId) {
        // Skip if we've already seen this Place ID
        if (seenPlaceIds.has(validation.placeId)) {
          // Merge mentions for duplicate
          const existing = validatedVenues.find(v => v.placeId === validation.placeId);
          if (existing) {
            existing.mentions.push(...mentions);
          }
          continue;
        }

        seenPlaceIds.add(validation.placeId);
        validatedVenues.push({
          name,
          officialName: validation.officialName,
          placeId: validation.placeId,
          address: validation.address,
          cuisine: validation.cuisine,
          mentions,
        });
      }

      // Rate limiting: 50 requests per second max
      if (validationCount % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`✅ Validated ${validatedVenues.length} restaurants from ${validationCount} candidates`);

    // Convert to scorer format and rank
    const scorerInput = validatedVenues.map(v => ({
      name: v.officialName,
      mentions: v.mentions.map(m => ({
        commentUpvotes: m.commentUpvotes,
        postUpvotes: m.postUpvotes,
        ageDays: m.ageDays,
        contextChars: m.contextChars,
        threadId: m.threadId,
      } as Mention))
    }));

    const ranked = rankRestaurants(scorerInput);

    // Add metadata back
    const results = ranked.map(r => {
      const venue = validatedVenues.find(v => v.officialName === r.name);
      return {
        ...r,
        placeId: venue?.placeId,
        address: venue?.address,
        cuisine: venue?.cuisine || null,
      };
    });

    return NextResponse.json({
      city,
      totalThreads: posts.length,
      totalSources: commentPayloads.reduce((sum, p) => sum + 1 + p.comments.length, 0),
      totalCandidates,
      validatedRestaurants: validatedVenues.length,
      results: results.slice(0, 50),
    });
  } catch (err: any) {
    console.error("❌ Search error:", err);
    return NextResponse.json(
      { error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
