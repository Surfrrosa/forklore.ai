-- Migration 008: Add BRIN index on RedditMention.timestamp
-- BRIN (Block Range Index) is perfect for chronologically-inserted data
-- Provides fast 90-day window queries with minimal storage overhead
-- Typical BRIN index is 100-1000x smaller than B-tree for time-series data

-- Create BRIN index on timestamp for efficient date range queries
CREATE INDEX IF NOT EXISTS idx_reddit_mention_timestamp_brin
  ON "RedditMention" USING BRIN (timestamp);

-- Also add a B-tree index on (placeId, timestamp) for per-place time queries
-- This supports queries like "mentions for this place in last 90 days"
CREATE INDEX IF NOT EXISTS idx_reddit_mention_place_time
  ON "RedditMention" (("placeId"), timestamp DESC)
  WHERE "placeId" IS NOT NULL;

-- Verify indexes created
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'RedditMention'
ORDER BY indexname;

-- Expected performance improvement:
-- Before: Sequential scan of entire table for 90-day queries
-- After: BRIN skips old data blocks, B-tree speeds per-place lookups
-- Cost: ~1-5KB for BRIN vs ~10MB+ for full B-tree on timestamp
