#!/usr/bin/env tsx
/**
 * Reddit ingestion script - ToS compliant
 *
 * Flow:
 * 1. Get city + mapped subreddits
 * 2. Fetch top posts (all-time + recent)
 * 3. Extract place mentions from post titles + selftext
 * 4. Fetch comments for each post
 * 5. Extract place mentions from comments
 * 6. Match mentions to places using matching engine
 * 7. Upsert RedditMention records (idempotent)
 * 8. Update Subreddit.last_sync timestamp
 *
 * COMPLIANCE:
 * - Stores only metadata (permalink, hash, score, timestamp)
 * - NO raw text storage
 * - Attribution via permalinks
 * - Rate limited (1 req/sec)
 */

import { RedditClient, createMentionMetadata } from '../lib/reddit';
import { matchPlace, extractPlaceNames } from '../lib/match';
import prisma from '../lib/prisma';

interface IngestResult {
  cityId: string;
  cityName: string;
  subredditsProcessed: number;
  postsProcessed: number;
  commentsProcessed: number;
  mentionsCreated: number;
  mentionsSkipped: number;
  elapsed: number;
}

/**
 * Main ingestion function
 */
export async function ingestRedditForCity(cityId: string): Promise<IngestResult> {
  const startTime = Date.now();

  console.log(`\n=== Ingesting Reddit data for city: ${cityId} ===\n`);

  // Get city info
  const city = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM "City" WHERE id = ${cityId} LIMIT 1
  `;

  if (city.length === 0) {
    throw new Error(`City not found: ${cityId}`);
  }

  const cityName = city[0].name;
  console.log(`City: ${cityName}`);

  // Get mapped subreddits
  const subreddits = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name
    FROM "Subreddit"
    WHERE city_id = ${cityId}
      AND is_active = true
    ORDER BY name
  `;

  if (subreddits.length === 0) {
    console.warn('⚠ No subreddits mapped for this city');
    return {
      cityId,
      cityName,
      subredditsProcessed: 0,
      postsProcessed: 0,
      commentsProcessed: 0,
      mentionsCreated: 0,
      mentionsSkipped: 0,
      elapsed: Date.now() - startTime
    };
  }

  console.log(`Mapped subreddits: ${subreddits.map(s => s.name).join(', ')}\n`);

  // Initialize Reddit client
  const reddit = new RedditClient(
    process.env.REDDIT_CLIENT_ID!,
    process.env.REDDIT_CLIENT_SECRET!,
    'Forklore.ai/1.0 (https://forklore.ai; contact@forklore.ai)'
  );

  let postsProcessed = 0;
  let commentsProcessed = 0;
  let mentionsCreated = 0;
  let mentionsSkipped = 0;

  // Process each subreddit
  for (const subreddit of subreddits) {
    console.log(`\n[${subreddit.name}] Processing...`);

    try {
      // Fetch top posts (all-time for iconic, recent for trending)
      const allTimePosts = await reddit.getTopPosts(subreddit.name, 'all', 100);
      const recentPosts = await reddit.getTopPosts(subreddit.name, 'month', 50);

      // Merge and dedupe
      const allPosts = [...allTimePosts, ...recentPosts];
      const uniquePosts = Array.from(
        new Map(allPosts.map(p => [p.id, p])).values()
      );

      console.log(`  Fetched ${uniquePosts.length} unique posts`);

      await reddit.waitForRateLimit();

      // Process each post
      for (const post of uniquePosts) {
        postsProcessed++;

        // Extract place mentions from post
        const postText = `${post.title}\n${post.selftext}`;
        const postPlaces = extractPlaceNames(postText);

        if (postPlaces.length > 0) {
          await processPostMentions(cityId, post, postPlaces);
        }

        // Fetch and process comments
        try {
          const comments = await reddit.getPostComments(subreddit.name, post.id, 500);
          commentsProcessed += comments.length;

          await reddit.waitForRateLimit();

          for (const comment of comments) {
            const commentPlaces = extractPlaceNames(comment.body);

            if (commentPlaces.length > 0) {
              const stats = await processCommentMentions(cityId, comment, commentPlaces);
              mentionsCreated += stats.created;
              mentionsSkipped += stats.skipped;
            }
          }

        } catch (error) {
          console.error(`  ✗ Failed to fetch comments for post ${post.id}:`, error);
        }

        // Progress update every 10 posts
        if (postsProcessed % 10 === 0) {
          console.log(`  Progress: ${postsProcessed} posts, ${commentsProcessed} comments`);
        }
      }

      // Update subreddit last_sync
      await prisma.$queryRaw`
        UPDATE "Subreddit"
        SET
          last_sync = NOW(),
          total_posts = ${uniquePosts.length}
        WHERE id = ${subreddit.id}
      `;

      console.log(`  ✓ Completed ${subreddit.name}`);

    } catch (error) {
      console.error(`  ✗ Failed to process ${subreddit.name}:`, error);
    }
  }

  const elapsed = Date.now() - startTime;

  console.log(`\n=== Ingestion complete in ${(elapsed / 1000).toFixed(1)}s ===`);
  console.log(`Posts: ${postsProcessed}`);
  console.log(`Comments: ${commentsProcessed}`);
  console.log(`Mentions created: ${mentionsCreated}`);
  console.log(`Mentions skipped (duplicates): ${mentionsSkipped}\n`);

  return {
    cityId,
    cityName,
    subredditsProcessed: subreddits.length,
    postsProcessed,
    commentsProcessed,
    mentionsCreated,
    mentionsSkipped,
    elapsed
  };
}

/**
 * Process place mentions from a post
 */
async function processPostMentions(
  cityId: string,
  post: any,
  placeNames: string[]
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const placeName of placeNames) {
    try {
      // Match place
      const match = await matchPlace({
        cityId,
        mentionText: placeName
      });

      if (!match) {
        skipped++;
        continue;
      }

      // Create metadata (ToS compliant - no raw text)
      const metadata = createMentionMetadata(post, [placeName]);

      // Upsert mention (idempotent)
      await prisma.$queryRaw`
        INSERT INTO "RedditMention" (
          place_id,
          subreddit,
          post_id,
          comment_id,
          score,
          ts,
          permalink,
          text_hash,
          text_len,
          created_at
        )
        VALUES (
          ${match.placeId},
          ${metadata.subreddit},
          ${metadata.postId},
          ${metadata.commentId},
          ${metadata.score},
          ${metadata.timestamp},
          ${metadata.permalink},
          decode(${metadata.textHash}, 'hex'),
          ${metadata.textLength},
          NOW()
        )
        ON CONFLICT (post_id, comment_id, place_id)
        DO UPDATE SET
          score = EXCLUDED.score,
          ts = EXCLUDED.ts
      `;

      created++;

    } catch (error) {
      console.error(`  ✗ Failed to process mention: ${placeName}`, error);
      skipped++;
    }
  }

  return { created, skipped };
}

/**
 * Process place mentions from a comment
 */
async function processCommentMentions(
  cityId: string,
  comment: any,
  placeNames: string[]
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const placeName of placeNames) {
    try {
      // Match place
      const match = await matchPlace({
        cityId,
        mentionText: placeName
      });

      if (!match) {
        skipped++;
        continue;
      }

      // Create metadata (ToS compliant - no raw text)
      const metadata = createMentionMetadata(comment, [placeName]);

      // Upsert mention (idempotent)
      await prisma.$queryRaw`
        INSERT INTO "RedditMention" (
          place_id,
          subreddit,
          post_id,
          comment_id,
          score,
          ts,
          permalink,
          text_hash,
          text_len,
          created_at
        )
        VALUES (
          ${match.placeId},
          ${metadata.subreddit},
          ${metadata.postId},
          ${metadata.commentId},
          ${metadata.score},
          ${metadata.timestamp},
          ${metadata.permalink},
          decode(${metadata.textHash}, 'hex'),
          ${metadata.textLength},
          NOW()
        )
        ON CONFLICT (post_id, comment_id, place_id)
        DO UPDATE SET
          score = EXCLUDED.score,
          ts = EXCLUDED.ts
      `;

      created++;

    } catch (error) {
      // Silently skip (too verbose to log every failed match)
      skipped++;
    }
  }

  return { created, skipped };
}

/**
 * CLI entry point
 */
if (require.main === module) {
  const cityId = process.argv[2];

  if (!cityId) {
    console.error('Usage: npx tsx scripts/reddit_ingest.ts <city-id>');
    process.exit(1);
  }

  if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET) {
    console.error('Error: REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set');
    process.exit(1);
  }

  ingestRedditForCity(cityId)
    .then(result => {
      console.log('\nResult:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Ingestion failed:', error);
      process.exit(1);
    });
}
