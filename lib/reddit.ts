/**
 * Reddit API client - ToS compliant
 *
 * COMPLIANCE:
 * - Only stores metadata (permalink, hash, score, timestamp)
 * - NO raw text storage
 * - Uses official Reddit API (requires OAuth)
 * - Respects rate limits
 * - Attribution via permalinks
 */

import crypto from 'crypto';

export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  selftext: string;
  author: string;
  score: number;
  numComments: number;
  created: number;
  permalink: string;
  url: string;
}

export interface RedditComment {
  id: string;
  postId: string;
  subreddit: string;
  body: string;
  author: string;
  score: number;
  created: number;
  permalink: string;
}

export interface RedditMentionMetadata {
  subreddit: string;
  postId: string;
  commentId: string | null;
  score: number;
  timestamp: Date;
  permalink: string;
  textHash: string;  // SHA256 hash
  textLength: number;
  extractedPlaces: string[];  // Just the names, not the context
}

/**
 * Reddit API client with OAuth
 */
export class RedditClient {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private userAgent: string
  ) {}

  /**
   * Get OAuth access token (caches until expiry)
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent
      },
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
      throw new Error(`Reddit OAuth failed: ${response.status}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // 1min buffer

    return this.accessToken;
  }

  /**
   * Fetch top posts from subreddit
   */
  async getTopPosts(
    subreddit: string,
    timeframe: 'all' | 'year' | 'month' | 'week' = 'all',
    limit: number = 100
  ): Promise<RedditPost[]> {
    const token = await this.getAccessToken();

    const url = `https://oauth.reddit.com/r/${subreddit}/top?t=${timeframe}&limit=${limit}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': this.userAgent
      }
    });

    if (!response.ok) {
      throw new Error(`Reddit API error: ${response.status}`);
    }

    const data = await response.json();

    return data.data.children.map((child: any) => ({
      id: child.data.id,
      subreddit: child.data.subreddit,
      title: child.data.title,
      selftext: child.data.selftext || '',
      author: child.data.author,
      score: child.data.score,
      numComments: child.data.num_comments,
      created: child.data.created_utc,
      permalink: `https://reddit.com${child.data.permalink}`,
      url: child.data.url
    }));
  }

  /**
   * Fetch comments from post
   */
  async getPostComments(
    subreddit: string,
    postId: string,
    limit: number = 500
  ): Promise<RedditComment[]> {
    const token = await this.getAccessToken();

    const url = `https://oauth.reddit.com/r/${subreddit}/comments/${postId}?limit=${limit}&depth=10`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': this.userAgent
      }
    });

    if (!response.ok) {
      throw new Error(`Reddit API error: ${response.status}`);
    }

    const data = await response.json();

    // Flatten comment tree
    const comments: RedditComment[] = [];

    function extractComments(items: any[], postId: string, subreddit: string) {
      for (const item of items) {
        if (item.kind === 't1' && item.data) {
          comments.push({
            id: item.data.id,
            postId,
            subreddit,
            body: item.data.body || '',
            author: item.data.author,
            score: item.data.score,
            created: item.data.created_utc,
            permalink: `https://reddit.com${item.data.permalink}`
          });

          // Recursively extract replies
          if (item.data.replies?.data?.children) {
            extractComments(item.data.replies.data.children, postId, subreddit);
          }
        }
      }
    }

    // data[1] contains comments (data[0] is the post itself)
    if (data[1]?.data?.children) {
      extractComments(data[1].data.children, postId, subreddit);
    }

    return comments;
  }

  /**
   * Rate limit helper (Reddit allows 60 req/min with OAuth)
   */
  async waitForRateLimit(): Promise<void> {
    // Conservative: 1 req/sec = 60 req/min
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Create ToS-compliant metadata from post/comment
 * DOES NOT STORE RAW TEXT - only hash and length
 */
export function createMentionMetadata(
  item: RedditPost | RedditComment,
  extractedPlaces: string[]
): Omit<RedditMentionMetadata, 'placeId'> {
  const text = 'body' in item ? item.body : `${item.title}\n${item.selftext}`;

  return {
    subreddit: item.subreddit,
    postId: 'postId' in item ? item.postId : item.id,
    commentId: 'postId' in item ? item.id : null,
    score: item.score,
    timestamp: new Date(item.created * 1000),
    permalink: item.permalink,
    textHash: hashText(text),
    textLength: text.length,
    extractedPlaces
  };
}

/**
 * SHA256 hash of text (for deduplication)
 */
export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Check if we've already processed this mention (by hash)
 */
export async function mentionExists(
  postId: string,
  commentId: string | null,
  placeId: string
): Promise<boolean> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const result = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count
    FROM "RedditMention"
    WHERE post_id = ${postId}
      AND comment_id = ${commentId}
      AND place_id = ${placeId}
    LIMIT 1
  `;

  return Number(result[0].count) > 0;
}
