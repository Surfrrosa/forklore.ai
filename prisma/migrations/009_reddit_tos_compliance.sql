-- Migration 009: Reddit ToS Compliance
-- Replace raw text snippets with metadata + permalinks
--
-- BEFORE: snippet (raw text, violates ToS)
-- AFTER:  permalink, contentHash, charCount, sentiment (compliant)
--
-- This migration:
-- 1. Adds new ToS-compliant columns
-- 2. Backfills data from existing snippets (where possible)
-- 3. Drops the old snippet column
-- 4. Adds unique constraint to prevent duplicates

-- Step 1: Add new columns (nullable initially for backfill)
ALTER TABLE "RedditMention"
  ADD COLUMN IF NOT EXISTS permalink TEXT,
  ADD COLUMN IF NOT EXISTS "contentHash" TEXT,
  ADD COLUMN IF NOT EXISTS "charCount" INTEGER,
  ADD COLUMN IF NOT EXISTS sentiment TEXT;

-- Step 2: Backfill permalink from postId/commentId
-- Reddit permalink format: /r/{subreddit}/comments/{postId}/_/{commentId}
UPDATE "RedditMention"
SET permalink = CASE
  WHEN "commentId" IS NOT NULL
    THEN '/r/' || subreddit || '/comments/' || REPLACE("postId", 't3_', '') || '/_/' || REPLACE("commentId", 't1_', '')
  ELSE '/r/' || subreddit || '/comments/' || REPLACE("postId", 't3_', '')
END
WHERE permalink IS NULL;

-- Step 3: Backfill contentHash from snippet (if exists)
-- Use MD5 for simplicity (SHA-256 would require pgcrypto extension)
UPDATE "RedditMention"
SET "contentHash" = MD5(snippet)
WHERE "contentHash" IS NULL AND snippet IS NOT NULL;

-- Step 4: Backfill charCount from snippet length
UPDATE "RedditMention"
SET "charCount" = LENGTH(snippet)
WHERE "charCount" IS NULL AND snippet IS NOT NULL;

-- Step 5: Set default charCount for nulls (can't infer from missing data)
UPDATE "RedditMention"
SET "charCount" = 0
WHERE "charCount" IS NULL;

-- Step 6: Make new columns NOT NULL (now that backfill is done)
ALTER TABLE "RedditMention"
  ALTER COLUMN permalink SET NOT NULL,
  ALTER COLUMN "contentHash" SET NOT NULL,
  ALTER COLUMN "charCount" SET NOT NULL;

-- Step 7: Drop old snippet column (point of no return!)
-- IMPORTANT: Comment this out if you want to keep snippets for testing
ALTER TABLE "RedditMention"
  DROP COLUMN IF EXISTS snippet;

-- Step 8: Add unique constraint on (postId, commentId) to prevent duplicates
-- This makes ingestion idempotent
CREATE UNIQUE INDEX IF NOT EXISTS idx_reddit_mention_unique
  ON "RedditMention" ("postId", COALESCE("commentId", ''));

-- Step 9: Add index on contentHash for deduplication queries
CREATE INDEX IF NOT EXISTS idx_reddit_mention_hash
  ON "RedditMention" ("contentHash");

-- Verify migration
SELECT
  'RedditMention schema updated' AS status,
  COUNT(*) AS total_mentions,
  COUNT(*) FILTER (WHERE permalink IS NOT NULL) AS with_permalink,
  COUNT(*) FILTER (WHERE "contentHash" IS NOT NULL) AS with_hash,
  AVG("charCount") AS avg_chars
FROM "RedditMention";

-- Show sample of new format
SELECT
  subreddit,
  "postId",
  "commentId",
  permalink,
  "charCount",
  sentiment,
  timestamp
FROM "RedditMention"
ORDER BY timestamp DESC
LIMIT 5;
