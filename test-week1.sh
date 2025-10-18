#!/bin/bash

echo "🧪 Testing Week 1 Improvements..."
echo ""

BASE_URL="http://localhost:3000"

# Test 1: Fuzzy search
echo "1️⃣  Testing fuzzy search threshold..."
FUZZY=$(curl -s "$BASE_URL/api/v2/fuzzy?q=pizza&limit=3")
MATCH_SCORE=$(echo $FUZZY | jq -r '.results[0].matchScore // 0')
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
  echo $PAGE1 | jq '.pagination'
else
  echo "❌ Pagination metadata missing"
fi
echo ""

# Test 3: Cache headers
echo "3️⃣  Testing cache headers..."
CACHE_HEADER=$(curl -s -I "$BASE_URL/api/v2/search?city=nyc&type=iconic&limit=1" | grep -i "cache-control")
ETAG_HEADER=$(curl -s -I "$BASE_URL/api/v2/search?city=nyc&type=iconic&limit=1" | grep -i "etag")
if [ -n "$CACHE_HEADER" ]; then
  echo "✅ Cache headers present: $CACHE_HEADER"
else
  echo "❌ Cache headers missing"
fi
if [ -n "$ETAG_HEADER" ]; then
  echo "✅ ETag present: $ETAG_HEADER"
else
  echo "❌ ETag missing"
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
COUNT=$(echo $MULTI | jq '.count')
if [ "$CUISINES" != "null" ] && [ "$COUNT" != "null" ]; then
  echo "✅ Multiple cuisines working: $CUISINES ($COUNT results)"
else
  echo "❌ Multiple cuisines not working"
fi
echo ""

# Test 6: Cuisines endpoint
echo "6️⃣  Testing cuisines endpoint..."
CUISINES_EP=$(curl -s "$BASE_URL/api/v2/cuisines?city=nyc&limit=5")
CUISINE_COUNT=$(echo $CUISINES_EP | jq '.count')
if [ "$CUISINE_COUNT" -gt 0 ] 2>/dev/null; then
  echo "✅ Cuisines endpoint working ($CUISINE_COUNT cuisines)"
  echo $CUISINES_EP | jq '.cuisines[:3]'
else
  echo "❌ Cuisines endpoint not working"
fi
echo ""

echo "✨ Tests complete!"
