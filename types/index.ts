// Core data models for Forklore.ai

export interface Restaurant {
  id: string;
  name: string;
  aliases?: string[];
  score: number;
  mentions: number;
  uniqueThreads: number;
  totalUpvotes: number;
  recentMentions: number; // Last 30 days
  topSnippet: CommentSnippet;
  allSnippets: CommentSnippet[];
  lastMentionDate: Date;
}

export interface CommentSnippet {
  text: string;
  upvotes: number;
  postId: string;
  commentId?: string;
  author: string;
  createdAt: Date;
  subreddit: string;
  permalink: string;
}

export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  score: number;
  created_utc: number;
  subreddit: string;
  permalink: string;
  author: string;
  num_comments: number;
}

export interface RedditComment {
  id: string;
  body: string;
  score: number;
  created_utc: number;
  author: string;
  post_id: string;
  permalink: string;
}

export interface GazetteerEntry {
  id: string;
  name: string;
  aliases: string[];
  normalizedName: string;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

export interface SearchParams {
  city: string;
  subreddits: string[];
  daysBack?: number; // Default 90
  minEvidence?: number; // Min threads or upvotes
  sortBy?: 'score' | 'mentions' | 'upvotes' | 'recency';
}

export interface SearchResult {
  city: string;
  restaurants: Restaurant[];
  metadata: {
    totalPosts: number;
    totalComments: number;
    subreddits: string[];
    dateRange: {
      start: Date;
      end: Date;
    };
    cachedAt?: Date;
  };
}

export interface ScoringWeights {
  mentionBase: number;
  commentUpvoteWeight: number;
  postUpvoteWeight: number;
  recencyHalfLife: number; // days
  contextQualityMax: number;
}
