/**
 * Pull top/all-time + recent posts/comments from curated subs,
 * extract restaurant mentions, and insert RedditMention rows.
 *
 * Uses the existing RedditClient (client credentials OAuth)
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { RedditClient } from "../lib/reddit";

const prisma = new PrismaClient();
const reddit = new RedditClient();

const SUBS = ["nyc", "AskNYC", "FoodNYC"]; // expand later
const CONTEXT_WINDOW = 240; // chars around match

function extractCandidates(text: string): string[] {
  // Lightweight heuristic: split on punctuation, keep 1–4 word capitalized phrases and words with apostrophes.
  return (text || "")
    .match(/\b([A-Z][\w'&.-]{1,})(?:\s+[A-Z][\w'&.-]{1,}){0,3}\b/g) || [];
}

async function getCityIdForSubreddit(sub: string) {
  const s = await prisma.subreddit.findFirst({ where: { name: sub } });
  return s?.cityIds[0] ?? null;
}

async function insertMentionRow(row: {
  placeId: string | null;
  subreddit: string;
  postId: string;
  commentId: string | null;
  score: number;
  timestamp: Date;
  text: string; // Original text for hashing
}) {
  try {
    // Generate ToS-compliant metadata
    const permalink = row.commentId
      ? `/r/${row.subreddit}/comments/${row.postId.replace('t3_', '')}/_/${row.commentId.replace('t1_', '')}`
      : `/r/${row.subreddit}/comments/${row.postId.replace('t3_', '')}`;

    const crypto = await import('crypto');
    const contentHash = crypto.createHash('md5').update(row.text).digest('hex');

    await prisma.redditMention.create({
      data: {
        placeId: row.placeId,
        subreddit: row.subreddit,
        postId: row.postId,
        commentId: row.commentId,
        score: row.score,
        timestamp: row.timestamp,
        permalink,
        contentHash,
        charCount: row.text.length,
        sentiment: null, // TODO: Add sentiment analysis
      },
    });
  } catch (e: any) {
    // Ignore duplicates (unique constraint on postId+commentId)
    if (!e.code || e.code !== "P2002") {
      console.error("Error inserting mention:", e.message);
    }
  }
}

async function matchPlaceId(cityId: string, snippet: string) {
  const res = await prisma.$queryRaw<{ match_place_for_text: string | null }[]>(
    Prisma.sql`SELECT match_place_for_text(${cityId}, ${snippet})`
  );
  return res[0]?.match_place_for_text ?? null;
}

async function run() {
  console.log("🚀 Starting Reddit mention ingestion...\n");

  let totalMentions = 0;
  let totalMatched = 0;
  let totalPosts = 0;

  for (const sub of SUBS) {
    console.log(`\n📍 Processing r/${sub}...`);
    const cityId = await getCityIdForSubreddit(sub);
    if (!cityId) {
      console.log(`  ⚠️  No city mapping found for r/${sub}, skipping`);
      continue;
    }

    // 1) All-time top posts (consensus)
    console.log(`  Fetching top all-time posts...`);
    const topPosts = await reddit.getTopPosts(sub, "all", 100);
    console.log(`  Fetching top recent (month) posts...`);
    const recentPosts = await reddit.getTopPosts(sub, "month", 100);

    const allPosts = [...topPosts, ...recentPosts];
    const uniquePosts = Array.from(
      new Map(allPosts.map((p) => [p.id, p])).values()
    );

    console.log(`  Processing ${uniquePosts.length} unique posts...`);
    totalPosts += uniquePosts.length;

    for (const post of uniquePosts) {
      // Process post title + selftext
      const postBody = `${post.title}\n${post.selftext || ""}`.slice(0, 5_000);
      const postCandidates = extractCandidates(postBody);

      for (const cand of postCandidates) {
        const idx = postBody.indexOf(cand);
        if (idx === -1) continue;

        const snippet = postBody.slice(
          Math.max(0, idx - CONTEXT_WINDOW / 2),
          Math.min(postBody.length, idx + cand.length + CONTEXT_WINDOW / 2)
        );
        const placeId = await matchPlaceId(cityId, snippet);

        await insertMentionRow({
          placeId,
          subreddit: sub,
          postId: `t3_${post.id}`,
          commentId: null,
          score: post.score,
          timestamp: new Date(post.created_utc * 1000),
          text: snippet, // Store as text for hashing, not raw storage
        });

        totalMentions++;
        if (placeId) totalMatched++;
      }

      // Process comments
      try {
        const comments = await reddit.getPostComments(sub, post.id, 100);

        for (const comment of comments) {
          const commentBody = comment.body.slice(0, 5_000);
          const commentCandidates = extractCandidates(commentBody);

          for (const cand of commentCandidates) {
            const idx = commentBody.indexOf(cand);
            if (idx === -1) continue;

            const snippet = commentBody.slice(
              Math.max(0, idx - CONTEXT_WINDOW / 2),
              Math.min(commentBody.length, idx + cand.length + CONTEXT_WINDOW / 2)
            );
            const placeId = await matchPlaceId(cityId, snippet);

            await insertMentionRow({
              placeId,
              subreddit: sub,
              postId: `t3_${post.id}`,
              commentId: `t1_${comment.id}`,
              score: comment.score,
              timestamp: new Date(comment.created_utc * 1000),
              text: snippet, // Store as text for hashing, not raw storage
            });

            totalMentions++;
            if (placeId) totalMatched++;
          }
        }
      } catch (e: any) {
        console.error(`  ⚠️  Error fetching comments for post ${post.id}:`, e.message);
      }

      // Rate limiting - small delay between posts
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`  ✓ Processed r/${sub}`);
  }

  await prisma.$disconnect();

  console.log(`\n✅ Ingestion complete!`);
  console.log(`   Total posts processed: ${totalPosts}`);
  console.log(`   Total mention candidates extracted: ${totalMentions}`);
  console.log(`   Successfully matched to places: ${totalMatched} (${totalMentions > 0 ? Math.round((totalMatched / totalMentions) * 100) : 0}%)`);
  console.log(`\n📊 Next steps:`);
  console.log(`  1. Compute aggregations: bash -c 'source .env.local && psql "$DATABASE_URL" -f scripts/compute_aggregations.sql'`);
  console.log(`  2. Refresh views: bash -c 'source .env.local && psql "$DATABASE_URL" -c "SELECT refresh_all_materialized_views()"'`);
  console.log(`  3. Test API: curl "http://localhost:3001/api/v2/search?city=nyc&type=iconic&limit=10" | jq`);
}

run().catch(async (e) => {
  console.error("❌ Error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
