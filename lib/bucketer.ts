/**
 * Bucketer: Converts Reddit data + extracted candidates → Mention[] for scoring
 *
 * Takes Reddit posts/comments with extracted restaurant names and converts them
 * into the Mention format that the scoring algorithm expects.
 */

import { RedditPost, RedditComment } from '@/types';
import { Mention } from './score';
import { extractCandidates } from './extractor';
import { Gazetteer, resolveDeterministic } from './resolver';

export type BucketedRestaurant = {
  restaurantId: string;
  restaurantName: string;
  mentions: Mention[];
};

/**
 * Process Reddit posts and comments to extract restaurant mentions
 * and bucket them by restaurant ID
 */
export function bucketMentions(
  posts: RedditPost[],
  comments: RedditComment[],
  gazetteer: Gazetteer
): Map<string, BucketedRestaurant> {
  const buckets = new Map<string, BucketedRestaurant>();
  const now = Date.now() / 1000; // current time in seconds

  // Process posts
  for (const post of posts) {
    const text = `${post.title} ${post.selftext}`.trim();
    if (!text) continue;

    const candidates = extractCandidates(text);
    const ageDays = (now - post.created_utc) / 86400;

    for (const candidate of candidates) {
      const resolved = resolveDeterministic(candidate.norm, gazetteer);
      if (!resolved) continue; // Skip unresolved candidates

      const mention: Mention = {
        commentUpvotes: 0, // Posts don't have comment upvotes
        postUpvotes: post.score,
        ageDays,
        contextChars: text.length,
        threadId: post.id,
      };

      if (!buckets.has(resolved.id)) {
        buckets.set(resolved.id, {
          restaurantId: resolved.id,
          restaurantName: resolved.name,
          mentions: [],
        });
      }

      buckets.get(resolved.id)!.mentions.push(mention);
    }
  }

  // Process comments
  for (const comment of comments) {
    const text = comment.body.trim();
    if (!text) continue;

    const candidates = extractCandidates(text);
    const ageDays = (now - comment.created_utc) / 86400;

    for (const candidate of candidates) {
      const resolved = resolveDeterministic(candidate.norm, gazetteer);
      if (!resolved) continue;

      // Find the parent post to get post upvotes
      const parentPost = posts.find(p => p.id === comment.post_id);

      const mention: Mention = {
        commentUpvotes: comment.score,
        postUpvotes: parentPost?.score ?? 0,
        ageDays,
        contextChars: text.length,
        threadId: comment.post_id,
      };

      if (!buckets.has(resolved.id)) {
        buckets.set(resolved.id, {
          restaurantId: resolved.id,
          restaurantName: resolved.name,
          mentions: [],
        });
      }

      buckets.get(resolved.id)!.mentions.push(mention);
    }
  }

  return buckets;
}

/**
 * Convert bucketed mentions to format expected by rankRestaurants()
 */
export function prepareScoringInput(
  buckets: Map<string, BucketedRestaurant>
): { name: string; mentions: Mention[] }[] {
  return Array.from(buckets.values()).map(bucket => ({
    name: bucket.restaurantName,
    mentions: bucket.mentions,
  }));
}
