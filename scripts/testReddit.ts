/**
 * Test script for Reddit API integration
 *
 * Verifies OAuth authentication and data fetching.
 * Run with: npx ts-node scripts/testReddit.ts
 */

import { getRedditClient } from '../lib/reddit.js';

async function run() {
  try {
    console.log('🔑 Authenticating with Reddit...');
    const client = getRedditClient();

    console.log('🔍 Fetching posts from r/FoodNYC...');
    const posts = await client.searchPosts('FoodNYC', 'best pizza', 'month', 5);

    console.log(`\n✅ Found ${posts.length} posts:\n`);
    posts.forEach((p, i) => {
      console.log(`${i + 1}. ${p.title}`);
      console.log(`   👍 ${p.score} upvotes | 💬 ${p.num_comments} comments`);
      console.log(`   🔗 https://reddit.com${p.permalink}\n`);
    });

    console.log('🎉 Reddit API test successful!');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

run();
