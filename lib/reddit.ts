/**
 * Reddit API Client
 *
 * Handles OAuth authentication and data fetching from Reddit.
 * Uses application-only OAuth (no user context needed).
 *
 * Rate limits: 100 requests/minute on free tier
 * Documentation: https://www.reddit.com/dev/api
 */

import { RedditPost, RedditComment } from '@/types';

export class RedditAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public endpoint?: string
  ) {
    super(message);
    this.name = 'RedditAPIError';
  }
}

interface RedditAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class RedditClient {
  private clientId: string;
  private clientSecret: string;
  private userAgent: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    clientId?: string,
    clientSecret?: string,
    userAgent?: string
  ) {
    this.clientId = clientId || process.env.REDDIT_CLIENT_ID || '';
    this.clientSecret = clientSecret || process.env.REDDIT_CLIENT_SECRET || '';
    this.userAgent = userAgent || process.env.REDDIT_USER_AGENT || 'forklore.ai/0.1.0';

    if (!this.clientId || !this.clientSecret) {
      throw new RedditAPIError('Reddit API credentials not configured');
    }
  }

  /**
   * Authenticate with Reddit using OAuth2 client credentials flow
   */
  private async authenticate(): Promise<void> {
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    try {
      const response = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
        },
        body: 'grant_type=client_credentials',
      });

      if (!response.ok) {
        throw new RedditAPIError(
          `Authentication failed: ${response.statusText}`,
          response.status,
          'access_token'
        );
      }

      const data: RedditAuthResponse = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 min early
    } catch (error) {
      if (error instanceof RedditAPIError) throw error;
      throw new RedditAPIError(`Authentication error: ${(error as Error).message}`);
    }
  }

  /**
   * Ensure we have a valid access token
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      await this.authenticate();
    }
  }

  /**
   * Make an authenticated request to Reddit API
   */
  private async request<T>(endpoint: string): Promise<T> {
    await this.ensureAuthenticated();

    try {
      const response = await fetch(`https://oauth.reddit.com${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'User-Agent': this.userAgent,
        },
      });

      if (!response.ok) {
        throw new RedditAPIError(
          `Reddit API error: ${response.statusText}`,
          response.status,
          endpoint
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof RedditAPIError) throw error;
      throw new RedditAPIError(
        `Request failed: ${(error as Error).message}`,
        undefined,
        endpoint
      );
    }
  }

  /**
   * Search for posts in specific subreddits
   *
   * @param subreddit - Subreddit name (without r/)
   * @param query - Search query
   * @param timeFilter - Time filter (day, week, month, year, all)
   * @param limit - Max results (default 100, max 100)
   */
  async searchPosts(
    subreddit: string,
    query: string,
    timeFilter: 'day' | 'week' | 'month' | 'year' | 'all' = 'all',
    limit: number = 100
  ): Promise<RedditPost[]> {
    const params = new URLSearchParams({
      q: query,
      restrict_sr: 'true',
      sort: 'top',
      t: timeFilter,
      limit: limit.toString(),
    });

    const response = await this.request<any>(`/r/${subreddit}/search?${params}`);

    return response.data.children.map((child: any) => ({
      id: child.data.id,
      title: child.data.title,
      selftext: child.data.selftext || '',
      score: child.data.score,
      created_utc: child.data.created_utc,
      subreddit: child.data.subreddit,
      permalink: child.data.permalink,
      author: child.data.author,
      num_comments: child.data.num_comments,
    }));
  }

  /**
   * Get comments from a post
   *
   * @param subreddit - Subreddit name
   * @param postId - Post ID
   * @param limit - Max comments to fetch
   */
  async getPostComments(
    subreddit: string,
    postId: string,
    limit: number = 500
  ): Promise<RedditComment[]> {
    const response = await this.request<any>(
      `/r/${subreddit}/comments/${postId}?limit=${limit}&depth=10`
    );

    const comments: RedditComment[] = [];

    // Response is [post, comments]
    const commentListing = response[1];

    const extractComments = (children: any[]) => {
      for (const child of children) {
        if (child.kind === 't1') { // t1 = comment
          const comment = child.data;
          comments.push({
            id: comment.id,
            body: comment.body || '',
            score: comment.score,
            created_utc: comment.created_utc,
            author: comment.author,
            post_id: postId,
            permalink: comment.permalink,
          });

          // Recursively extract replies
          if (comment.replies && comment.replies.data) {
            extractComments(comment.replies.data.children);
          }
        }
      }
    };

    extractComments(commentListing.data.children);
    return comments;
  }

  /**
   * Get hot posts from a subreddit
   */
  async getHotPosts(subreddit: string, limit: number = 100): Promise<RedditPost[]> {
    const response = await this.request<any>(`/r/${subreddit}/hot?limit=${limit}`);

    return response.data.children.map((child: any) => ({
      id: child.data.id,
      title: child.data.title,
      selftext: child.data.selftext || '',
      score: child.data.score,
      created_utc: child.data.created_utc,
      subreddit: child.data.subreddit,
      permalink: child.data.permalink,
      author: child.data.author,
      num_comments: child.data.num_comments,
    }));
  }

  /**
   * Get top posts from a subreddit
   */
  async getTopPosts(
    subreddit: string,
    timeFilter: 'day' | 'week' | 'month' | 'year' | 'all' = 'month',
    limit: number = 100
  ): Promise<RedditPost[]> {
    const response = await this.request<any>(
      `/r/${subreddit}/top?t=${timeFilter}&limit=${limit}`
    );

    return response.data.children.map((child: any) => ({
      id: child.data.id,
      title: child.data.title,
      selftext: child.data.selftext || '',
      score: child.data.score,
      created_utc: child.data.created_utc,
      subreddit: child.data.subreddit,
      permalink: child.data.permalink,
      author: child.data.author,
      num_comments: child.data.num_comments,
    }));
  }
}

// Singleton instance
let redditClient: RedditClient | null = null;

/**
 * Get or create Reddit API client instance
 */
export function getRedditClient(): RedditClient {
  if (!redditClient) {
    redditClient = new RedditClient();
  }
  return redditClient;
}
