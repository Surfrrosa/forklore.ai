/**
 * Test endpoint for Reddit API integration
 * Visit: http://localhost:3000/api/test-reddit
 */

import { getRedditClient } from '@/lib/reddit';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    console.log('🔑 Authenticating with Reddit...');
    const client = getRedditClient();

    console.log('🔍 Fetching posts from r/FoodNYC...');
    const posts = await client.searchPosts('FoodNYC', 'best pizza', 'month', 5);

    console.log(`✅ Found ${posts.length} posts`);

    return NextResponse.json({
      success: true,
      message: `Found ${posts.length} posts from r/FoodNYC`,
      posts: posts.map(p => ({
        title: p.title,
        score: p.score,
        comments: p.num_comments,
        permalink: `https://reddit.com${p.permalink}`,
        created: new Date(p.created_utc * 1000).toLocaleDateString(),
      })),
    });
  } catch (error) {
    console.error('❌ Test failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
