# Testing Guide - Week 1 Improvements

## Quick Start

```bash
# 1. Make sure dev server is running
npm run dev

# 2. In a new terminal, run these tests
```

---

## Test 1: Fuzzy Search (Stricter Threshold)

**What changed**: Threshold increased from 0.3 → 0.5 (fewer false positives)

```bash
# Should return good matches only
curl "http://localhost:3001/api/v2/fuzzy?q=katz" | jq

# Should return fewer/no results (stricter)
curl "http://localhost:3001/api/v2/fuzzy?q=xyz" | jq

# Check match scores - should all be > 0.5
curl "http://localhost:3001/api/v2/fuzzy?q=pizza" | jq '.results[].matchScore'
```

**Expected**: All `matchScore` values should be > 0.5

---

## Test 2: Pagination

**What changed**: Added offset/limit support with metadata

```bash
# Page 1 (first 10)
curl "http://localhost:3001/api/v2/search?city=nyc&type=iconic&limit=10&offset=0" | jq '{count, pagination, results: .results | map(.name)}'

# Page 2 (next 10)
curl "http://localhost:3001/api/v2/search?city=nyc&type=iconic&limit=10&offset=10" | jq '{count, pagination, results: .results | map(.name)}'

# Page 3 (next 10)
curl "http://localhost:3001/api/v2/search?city=nyc&type=iconic&limit=10&offset=20" | jq '{count, pagination, results: .results | map(.name)}'
```

**Expected**:
- Each page returns different results
- `pagination.hasMore` indicates if more results exist
- `pagination.nextOffset` shows next page offset

---

## Test 3: Cache Headers

**What changed**: Added Cache-Control, ETag, and stale-while-revalidate

```bash
# Check cache headers (first request)
curl -I "http://localhost:3001/api/v2/search?city=nyc&type=iconic&limit=5"

# Look for these headers:
# Cache-Control: public, max-age=3600, stale-while-revalidate=86400
# ETag: "abc123..."
# X-RateLimit-Limit: 100
# X-RateLimit-Remaining: 99

# Test ETag (second request with If-None-Match)
ETAG=$(curl -s -I "http://localhost:3001/api/v2/search?city=nyc&type=iconic&limit=5" | grep -i etag | cut -d' ' -f2 | tr -d '\r')
curl -I -H "If-None-Match: $ETAG" "http://localhost:3001/api/v2/search?city=nyc&type=iconic&limit=5"
```

**Expected**:
- First request: 200 OK with ETag
- Second request: 304 Not Modified (if ETag matches)
- Cache-Control headers present

---

## Test 4: Rate Limiting

**What changed**: Added 100 req/hour limit (or 300 for fuzzy)

```bash
# Check rate limit headers
curl -I "http://localhost:3001/api/v2/search?city=nyc&type=iconic&limit=5"

# Should see:
# X-RateLimit-Limit: 100
# X-RateLimit-Remaining: 99 (decreases each request)
# X-RateLimit-Reset: 1234567890 (Unix timestamp)

# Test rapid requests (watch remaining count)
for i in {1..5}; do
  curl -s -I "http://localhost:3001/api/v2/search?city=nyc&type=iconic" | grep -i "x-ratelimit-remaining"
done
```

**Expected**:
- `X-RateLimit-Remaining` decreases each request
- If you hit 100 requests/hour: 429 Too Many Requests

**Note**: If Upstash not configured, rate limiting is disabled (dev mode)

---

## Test 5: Multiple Cuisine Filtering

**What changed**: Support for multiple `cuisine=` params

```bash
# Single cuisine
curl "http://localhost:3001/api/v2/search?city=nyc&type=cuisine&cuisine=pizza_restaurant&limit=5" | jq '{count, cuisines, results: .results | map({name, cuisine})}'

# Multiple cuisines
curl "http://localhost:3001/api/v2/search?city=nyc&type=cuisine&cuisine=pizza_restaurant&cuisine=italian_restaurant&limit=10" | jq '{count, cuisines, results: .results | map({name, cuisine})}'

# With facets
curl "http://localhost:3001/api/v2/search?city=nyc&type=iconic&facets=true&limit=5" | jq '{count, facets: .facets.cuisines[:5]}'
```

**Expected**:
- Single cuisine: Results from one category
- Multiple cuisines: Combined results, no duplicates
- Facets: Top cuisine counts included

---

## Test 6: Cuisines Endpoint

**What changed**: Dedicated endpoint for facet discovery

```bash
# Get all cuisines for NYC
curl "http://localhost:3001/api/v2/cuisines?city=nyc&limit=20" | jq '{count, cuisines: .cuisines | map({key, label, count})}'

# Top 5 cuisines
curl "http://localhost:3001/api/v2/cuisines?city=nyc&limit=5" | jq '.cuisines'
```

**Expected**:
- List of cuisines with counts
- Sorted by count (descending)
- Formatted labels (Title Case)

---

## Test 7: Database Migrations (Manual)

**What changed**: 3 new migrations (007, 008, 009)

### Option A: Fresh Database

If you want to test from scratch:

```bash
# Connect to your database
source .env.local
psql "$DATABASE_URL"

# Run migrations in order
\i prisma/migrations/001_trgm_idx.sql
\i prisma/migrations/002_subreddit_seed.sql
\i prisma/migrations/003_match_fn.sql
\i prisma/migrations/004_materialized_views.sql
\i prisma/migrations/005_refresh_fn.sql
\i prisma/migrations/006_mv_unique_indexes.sql
\i prisma/migrations/007_improve_matching_threshold.sql
\i prisma/migrations/008_brin_timestamp_index.sql
\i prisma/migrations/009_reddit_tos_compliance.sql
```

### Option B: Existing Database

If you already have data:

```bash
source .env.local
psql "$DATABASE_URL"

# Run new migrations only
\i prisma/migrations/007_improve_matching_threshold.sql
\i prisma/migrations/008_brin_timestamp_index.sql
\i prisma/migrations/009_reddit_tos_compliance.sql

# Verify changes
\d "RedditMention"  -- Should show new columns: permalink, contentHash, charCount
\di                 -- Should show new indexes
```

**Expected**:
- Migration 007: Function updated, threshold = 0.55
- Migration 008: BRIN index created
- Migration 009: Schema updated (no snippet, added permalink/hash)

---

## Test 8: Scoring Formulas (Manual)

**What changed**: Wilson smoothing + exponential decay

```bash
source .env.local

# Run new aggregation script
psql "$DATABASE_URL" -f scripts/compute_aggregations.sql

# Check output for:
# - places_meeting_iconic_threshold (>= 3 mentions)
# - places_meeting_trending_threshold (>= 2 recent mentions)
# - Top 10 iconic (Wilson-smoothed)
# - Top 10 trending (exponential decay)
```

**Expected**:
- Iconic scores should be lower for low-sample places
- Trending scores should favor very recent mentions
- No single-mention places in top rankings

---

## Test 9: Reddit Ingestion (Manual)

**What changed**: ToS-compliant (permalink + hash, no raw text)

```bash
# Run ingestion script
npx dotenv -e .env.local -- npx tsx scripts/ingest_reddit_mentions.ts

# Check database
source .env.local
psql "$DATABASE_URL" -c "SELECT subreddit, \"postId\", \"commentId\", permalink, \"charCount\", sentiment FROM \"RedditMention\" LIMIT 5;"
```

**Expected**:
- `permalink` populated (Reddit URL format)
- `contentHash` populated (MD5 hash)
- `charCount` > 0
- NO `snippet` column (should not exist)

---

## Test 10: End-to-End API Flow

**Complete user journey test**:

```bash
# 1. User searches for "pizza" (autocomplete)
curl "http://localhost:3001/api/v2/fuzzy?q=pizza&city=nyc&limit=5" | jq

# 2. User gets iconic pizza places
curl "http://localhost:3001/api/v2/search?city=nyc&type=iconic&limit=10" | jq

# 3. User filters by cuisine
curl "http://localhost:3001/api/v2/search?city=nyc&type=cuisine&cuisine=pizza_restaurant&limit=10" | jq

# 4. User browses facets
curl "http://localhost:3001/api/v2/cuisines?city=nyc&limit=20" | jq

# 5. User paginates through results
curl "http://localhost:3001/api/v2/search?city=nyc&type=iconic&limit=20&offset=0" | jq
curl "http://localhost:3001/api/v2/search?city=nyc&type=iconic&limit=20&offset=20" | jq

# 6. Check rate limits didn't block us
curl -I "http://localhost:3001/api/v2/search?city=nyc&type=iconic" | grep -i "x-ratelimit"
```

**Expected**: All requests succeed with proper data

---

## Test 11: Performance Baseline

**Measure API latency**:

```bash
# Iconic search (should be <100ms)
time curl -s "http://localhost:3001/api/v2/search?city=nyc&type=iconic&limit=50" > /dev/null

# Trending search
time curl -s "http://localhost:3001/api/v2/search?city=nyc&type=trending&limit=50" > /dev/null

# Fuzzy search (should be <50ms)
time curl -s "http://localhost:3001/api/v2/fuzzy?q=pizza&city=nyc" > /dev/null

# Cuisines (should be <20ms)
time curl -s "http://localhost:3001/api/v2/cuisines?city=nyc" > /dev/null
```

**Expected**:
- Iconic/Trending: <100ms
- Fuzzy: <50ms
- Cuisines: <20ms

---

## Test 12: Error Handling

```bash
# Invalid city
curl "http://localhost:3001/api/v2/search?city=invalid&type=iconic" | jq

# Missing cuisine param
curl "http://localhost:3001/api/v2/search?city=nyc&type=cuisine" | jq

# Invalid fuzzy query (too short)
curl "http://localhost:3001/api/v2/fuzzy?q=a" | jq

# Rate limit exceeded (if Upstash configured)
# Run 101 requests rapidly, last should return 429
```

**Expected**:
- Proper error messages
- Correct HTTP status codes (400, 404, 429)

---

## Automated Test Script

Create `test-week1.sh`:

```bash
#!/bin/bash

echo "🧪 Testing Week 1 Improvements..."
echo ""

BASE_URL="http://localhost:3001"

# Test 1: Fuzzy search
echo "1️⃣  Testing fuzzy search threshold..."
FUZZY=$(curl -s "$BASE_URL/api/v2/fuzzy?q=pizza&limit=3")
MATCH_SCORE=$(echo $FUZZY | jq '.results[0].matchScore')
if (( $(echo "$MATCH_SCORE > 0.5" | bc -l) )); then
  echo "✅ Fuzzy threshold working (score: $MATCH_SCORE)"
else
  echo "❌ Fuzzy threshold too low (score: $MATCH_SCORE)"
fi
echo ""

# Test 2: Pagination
echo "2️⃣  Testing pagination..."
PAGE1=$(curl -s "$BASE_URL/api/v2/search?city=nyc&type=iconic&limit=5&offset=0")
HAS_PAGINATION=$(echo $PAGE1 | jq 'has("pagination")')
if [ "$HAS_PAGINATION" = "true" ]; then
  echo "✅ Pagination metadata present"
else
  echo "❌ Pagination metadata missing"
fi
echo ""

# Test 3: Cache headers
echo "3️⃣  Testing cache headers..."
CACHE_HEADER=$(curl -s -I "$BASE_URL/api/v2/search?city=nyc&type=iconic&limit=1" | grep -i "cache-control")
if [ -n "$CACHE_HEADER" ]; then
  echo "✅ Cache headers present: $CACHE_HEADER"
else
  echo "❌ Cache headers missing"
fi
echo ""

# Test 4: Rate limit headers
echo "4️⃣  Testing rate limit headers..."
RATE_HEADER=$(curl -s -I "$BASE_URL/api/v2/search?city=nyc&type=iconic&limit=1" | grep -i "x-ratelimit-limit")
if [ -n "$RATE_HEADER" ]; then
  echo "✅ Rate limit headers present: $RATE_HEADER"
else
  echo "⚠️  Rate limit headers missing (Upstash not configured?)"
fi
echo ""

# Test 5: Multiple cuisines
echo "5️⃣  Testing multiple cuisine filtering..."
MULTI=$(curl -s "$BASE_URL/api/v2/search?city=nyc&type=cuisine&cuisine=pizza_restaurant&cuisine=italian_restaurant&limit=5")
CUISINES=$(echo $MULTI | jq '.cuisines')
if [ "$CUISINES" != "null" ]; then
  echo "✅ Multiple cuisines working: $CUISINES"
else
  echo "❌ Multiple cuisines not working"
fi
echo ""

# Test 6: Cuisines endpoint
echo "6️⃣  Testing cuisines endpoint..."
CUISINES_EP=$(curl -s "$BASE_URL/api/v2/cuisines?city=nyc&limit=5")
CUISINE_COUNT=$(echo $CUISINES_EP | jq '.count')
if [ "$CUISINE_COUNT" -gt 0 ]; then
  echo "✅ Cuisines endpoint working ($CUISINE_COUNT cuisines)"
else
  echo "❌ Cuisines endpoint not working"
fi
echo ""

echo "✨ Tests complete!"
```

Run it:

```bash
chmod +x test-week1.sh
./test-week1.sh
```

---

## What If Tests Fail?

### Fuzzy Search Returns Nothing
- Database might be empty
- Run: `npx prisma db push` then load data

### Pagination Missing
- Server might not have reloaded
- Restart: `npm run dev`

### Cache Headers Missing
- Check imports in route files
- Verify `lib/cache.ts` exists

### Rate Limit Headers Missing
- Normal if Upstash not configured
- Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to `.env.local`

### Migration Errors
- Check database connection: `psql "$DATABASE_URL"`
- Run migrations manually (see Test 7)

---

## Success Criteria

✅ All endpoints return 200 OK
✅ Fuzzy match scores > 0.5
✅ Pagination metadata present
✅ Cache headers present
✅ Rate limit headers present (if Upstash configured)
✅ Multiple cuisines work
✅ Cuisines endpoint returns data
✅ API latency < 100ms

---

## Next Steps After Testing

If all tests pass:
1. ✅ Mark Week 1 complete
2. 🚀 Deploy to Vercel (optional)
3. 📊 Set up monitoring (Sentry, Upstash dashboard)
4. 📝 Start Week 2 items (if desired)

If tests fail:
1. 🔍 Check console logs (`npm run dev` output)
2. 🔍 Check database connection
3. 🔍 Verify migrations ran successfully
4. 🔍 Ask for help debugging specific failures

---

**Happy Testing!** 🧪
