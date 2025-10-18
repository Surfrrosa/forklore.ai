# Reddit ToS Compliance

## Overview

Forklore.ai complies with Reddit's Terms of Service and Data API Terms by:
1. **Not storing raw user-generated content**
2. **Linking back to original Reddit posts** via permalinks
3. **Deriving aggregate metrics** from engagement data (votes, timestamps)
4. **Not republishing Reddit content** without attribution

This document explains our compliance strategy and implementation.

---

## Reddit ToS Requirements

### What Reddit Prohibits

From [Reddit Data API Terms](https://www.reddit.com/wiki/api-terms):

> You may not use Reddit Data for any purpose except for Reddit Data that is available via the Data API and your permitted use of such data.

> If you display Reddit Data, you must **attribute the content to Reddit** and provide a **link back to Reddit**.

### What This Means for Us

❌ **Prohibited**: Storing raw comment/post text and displaying it without attribution
✅ **Allowed**: Storing metadata (votes, timestamps) + permalink to original

---

## Our Implementation

### Old Schema (Non-Compliant)

```sql
CREATE TABLE "RedditMention" (
  id        TEXT PRIMARY KEY,
  placeId   TEXT REFERENCES "Place"(id),
  subreddit TEXT NOT NULL,
  postId    TEXT NOT NULL,
  commentId TEXT,
  score     INTEGER NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  snippet   TEXT NOT NULL  -- ❌ RAW CONTENT STORAGE (VIOLATES ToS)
);
```

**Problem**: `snippet` column stored raw Reddit text without attribution/linking.

---

### New Schema (ToS-Compliant)

```sql
CREATE TABLE "RedditMention" (
  id          TEXT PRIMARY KEY,
  placeId     TEXT REFERENCES "Place"(id),
  subreddit   TEXT NOT NULL,
  postId      TEXT NOT NULL,
  commentId   TEXT,
  score       INTEGER NOT NULL,
  timestamp   TIMESTAMP NOT NULL,
  permalink   TEXT NOT NULL,      -- ✅ Link back to Reddit
  contentHash TEXT NOT NULL,      -- ✅ Hash for dedup (not raw text)
  charCount   INTEGER NOT NULL,   -- ✅ Derived metric
  sentiment   TEXT,               -- ✅ Derived metric (optional)

  UNIQUE (postId, commentId)      -- ✅ Idempotent ingestion
);
```

**Changes**:
1. **Removed `snippet`**: No raw text storage
2. **Added `permalink`**: Links back to original Reddit content
3. **Added `contentHash`**: MD5 hash for deduplication (can't reverse to original)
4. **Added `charCount`**: Derived metric (length, not content)
5. **Added `sentiment`**: Optional derived analysis
6. **Added unique constraint**: Prevents duplicate mentions

---

## Data Flow

### Ingestion (ToS-Compliant)

```typescript
// 1. Fetch Reddit content via API (permitted)
const post = await reddit.getPost(postId);

// 2. Extract restaurant mentions (NER/regex)
const candidates = extractCandidates(post.body);

// 3. Match to Place database (fuzzy matching)
const placeId = await matchPlace(candidate, cityId);

// 4. Store METADATA ONLY (not raw text)
await prisma.redditMention.create({
  data: {
    placeId,
    subreddit: post.subreddit,
    postId: `t3_${post.id}`,
    commentId: null,
    score: post.score,
    timestamp: new Date(post.created_utc * 1000),

    // ToS-compliant fields:
    permalink: `/r/${post.subreddit}/comments/${post.id}`,  // Link back
    contentHash: md5(post.body),                            // Hash, not text
    charCount: post.body.length,                            // Derived metric
    sentiment: analyzeSentiment(post.body),                 // Derived metric
  }
});
```

**Key Points**:
- Raw text (`post.body`) **never stored** in database
- Used temporarily for matching, then discarded
- Only metadata + permalink persisted

---

### Display (ToS-Compliant)

When showing "top mentions" in API responses:

```json
{
  "topSnippets": [
    {
      "subreddit": "FoodNYC",
      "score": 152,
      "timestamp": "2025-10-15T14:30:00Z",
      "permalink": "/r/FoodNYC/comments/abc123/_/def456",
      "charCount": 240,
      "sentiment": "positive"
    }
  ]
}
```

**What we show**:
- ✅ Engagement metrics (score, timestamp)
- ✅ Permalink to original (attribution)
- ✅ Derived metrics (charCount, sentiment)

**What we DON'T show**:
- ❌ Raw text from Reddit
- ❌ Excerpts without attribution
- ❌ Republished content

**User flow**: Click permalink → Opens Reddit → Sees original content with full context

---

## Migration Path

### Step 1: Schema Migration (Backward Compatible)

```sql
-- Add new columns (nullable initially)
ALTER TABLE "RedditMention"
  ADD COLUMN permalink TEXT,
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "charCount" INTEGER,
  ADD COLUMN sentiment TEXT;

-- Backfill from existing snippets (where possible)
UPDATE "RedditMention"
SET
  permalink = '/r/' || subreddit || '/comments/' || REPLACE("postId", 't3_', ''),
  "contentHash" = MD5(snippet),
  "charCount" = LENGTH(snippet);

-- Make required fields NOT NULL
ALTER TABLE "RedditMention"
  ALTER COLUMN permalink SET NOT NULL,
  ALTER COLUMN "contentHash" SET NOT NULL,
  ALTER COLUMN "charCount" SET NOT NULL;

-- Drop old snippet column
ALTER TABLE "RedditMention"
  DROP COLUMN snippet;
```

### Step 2: Update Ingestion Script

```typescript
// Before (non-compliant):
await prisma.redditMention.create({
  data: { ...mention, snippet: fullText }  // ❌
});

// After (compliant):
await prisma.redditMention.create({
  data: {
    ...mention,
    permalink: buildPermalink(mention),
    contentHash: md5(fullText),            // ✅
    charCount: fullText.length,
  }
});
```

### Step 3: Update Aggregation Queries

```sql
-- Before (references snippet):
SELECT snippet FROM "RedditMention" WHERE ...  -- ❌

-- After (references permalink):
SELECT permalink, charCount FROM "RedditMention" WHERE ...  -- ✅
```

---

## Legal Rationale

### Fair Use Analysis

Our use qualifies as **transformative fair use**:

1. **Purpose**: Restaurant discovery (different from Reddit's purpose)
2. **Nature**: Factual mentions → aggregate rankings (highly transformative)
3. **Amount**: Metadata only, not substantive content
4. **Effect**: Drives traffic TO Reddit via permalinks (positive market effect)

### Reddit API ToS Compliance

✅ **Permitted Uses**:
- Accessing data via official API
- Deriving aggregate metrics
- Linking back to Reddit with attribution

❌ **Prohibited Uses** (we avoid):
- Storing raw content without attribution
- Republishing content elsewhere
- Circumventing API rate limits

---

## Example: Compliant vs Non-Compliant

### ❌ Non-Compliant Display

```json
{
  "mention": {
    "text": "I love Katz's Delicatessen! Best pastrami in NYC.",
    "author": "foodlover123",
    "upvotes": 152
  }
}
```

**Why prohibited**: Republishing raw user content without attribution/link.

---

### ✅ Compliant Display

```json
{
  "mention": {
    "score": 152,
    "timestamp": "2025-10-15T14:30:00Z",
    "permalink": "/r/FoodNYC/comments/abc123/_/def456",
    "charCount": 52,
    "sentiment": "positive",
    "attribution": "View original on Reddit →"
  }
}
```

**Why compliant**:
- No raw text reproduced
- Permalink for attribution
- User must click to Reddit to see content
- Drives traffic TO Reddit

---

## Monitoring Compliance

### Automated Checks

Add to CI/CD pipeline:

```bash
# Ensure no snippet column exists
psql -c "SELECT * FROM information_schema.columns
         WHERE table_name = 'RedditMention'
         AND column_name = 'snippet';"
# Should return 0 rows

# Ensure permalink column exists
psql -c "SELECT COUNT(*) FROM information_schema.columns
         WHERE table_name = 'RedditMention'
         AND column_name = 'permalink';"
# Should return 1
```

### Code Review Checklist

Before merging any Reddit-related code:

- [ ] No raw text storage in database
- [ ] Permalinks included for all mentions
- [ ] API responses include attribution
- [ ] No text excerpts shown without links
- [ ] Deduplication uses hashes, not content matching

---

## FAQ

**Q: Can we cache Reddit content for performance?**
A: Yes, temporarily (in-memory), not persistently. Use for matching/analysis during ingestion, then discard.

**Q: Can we show "top comment" preview?**
A: No, not without fetching live from Reddit API each time. Better: show permalink + "View on Reddit →"

**Q: What about deleted/removed comments?**
A: Our metadata persists (score, timestamp, permalink), but permalink will show [deleted]. This is fine - we're not storing the content.

**Q: Can we use sentiment analysis on Reddit text?**
A: Yes! Derived metrics are permitted. Just don't store the raw text used for analysis.

**Q: Do we need Reddit's permission for this?**
A: Using public API for aggregate metrics + attribution is within ToS. For commercial use at scale, consider Reddit Enterprise API.

---

## References

- [Reddit Data API Terms](https://www.reddit.com/wiki/api-terms)
- [Reddit API Rules](https://github.com/reddit-archive/reddit/wiki/API)
- [Fair Use Doctrine](https://www.copyright.gov/fair-use/)
- [Transformative Use Case Law](https://en.wikipedia.org/wiki/Transformative_use)

---

**Last Updated**: 2025-10-18
**Version**: 1.0 (ToS-Compliant Schema)
**Status**: ✅ Fully Compliant
