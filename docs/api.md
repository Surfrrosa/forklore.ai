# Forklore.ai API Documentation

Version: 2.0
Base URL: `https://forklore.ai/api/v2`

## Table of Contents

1. [Authentication & Rate Limiting](#authentication--rate-limiting)
2. [Common Headers](#common-headers)
3. [Error Responses](#error-responses)
4. [Endpoints](#endpoints)
   - [GET /cities](#get-cities)
   - [GET /search](#get-search)
   - [GET /fuzzy](#get-fuzzy)
   - [GET /places/:id](#get-placesid)
   - [GET /health](#get-health)

---

## Authentication & Rate Limiting

Currently, the API does not require authentication. Rate limits are enforced per IP address:

| Endpoint | Rate Limit | Window |
|----------|------------|--------|
| `/search`, `/cities` | 100 requests | 1 minute |
| `/fuzzy` | 30 requests | 1 minute |

### Rate Limit Headers

All responses include rate limit information:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1234567890
```

When rate limited, the API returns HTTP 429 with:

```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "retry_after": 60
}
```

---

## Common Headers

### Request Headers

| Header | Description | Required |
|--------|-------------|----------|
| `If-None-Match` | ETag for conditional requests | No |

### Response Headers

| Header | Description |
|--------|-------------|
| `Cache-Control` | Caching directives |
| `ETag` | Version identifier for conditional requests |
| `X-Response-Time` | Server processing time in milliseconds |
| `X-RateLimit-*` | Rate limiting information |

---

## Error Responses

All error responses follow this format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "timestamp": "2025-10-19T06:00:00.000Z"
}
```

### Common Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `MISSING_PARAM` | Required parameter missing |
| 400 | `INVALID_TYPE` | Invalid type parameter |
| 400 | `INVALID_QUERY` | Query parameter invalid or too short |
| 404 | `CITY_NOT_FOUND` | Requested city does not exist |
| 429 | `RATE_LIMIT_EXCEEDED` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Internal server error |

---

## Endpoints

### GET /cities

List all available cities with statistics.

**Query Parameters:** None

**Response Headers:**
```
Cache-Control: public, max-age=300, stale-while-revalidate=3600
```

**Response Body:**

```json
{
  "cities": [
    {
      "id": "af20eccd-4b77-4072-ac23-21d179f4b37e",
      "name": "Portland",
      "country": "USA",
      "ranked": true,
      "coordinates": {
        "lat": 45.5152,
        "lon": -122.6784
      },
      "stats": {
        "total_places": 2586,
        "total_mentions": 5210,
        "last_refreshed": "2025-10-19T05:00:00.000Z"
      }
    }
  ],
  "total": 2,
  "ranked": 1,
  "response_time_ms": 45
}
```

**Field Descriptions:**

- `ranked`: `true` if city has Reddit-based rankings, `false` if OSM-only
- `coordinates`: City center coordinates (null if not set)
- `stats.total_places`: Number of places in database
- `stats.total_mentions`: Number of Reddit mentions (0 if unranked)
- `stats.last_refreshed`: Last materialized view refresh (null if unranked)

**Example Request:**

```bash
curl https://forklore.ai/api/v2/cities
```

---

### GET /search

Main search endpoint for ranked and unranked cities.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `city` | string | Yes | City name or alias (e.g., "Portland", "PDX", "NYC") |
| `type` | string | Yes | Ranking type: `iconic`, `trending`, or `cuisine` |
| `cuisine` | string | No | Filter by cuisine (e.g., "coffee_shop", "vietnamese") |
| `limit` | integer | No | Results per page (default: 50, max: 100) |
| `offset` | integer | No | Pagination offset (default: 0) |

**Response Headers:**
```
Cache-Control: public, max-age=3600, stale-while-revalidate=86400
ETag: "<mv_version_hash>-<city_id>-<type>-<cuisine>-<offset>-<limit>"
```

**Response Body (Ranked City):**

```json
{
  "ranked": true,
  "rank_source": "mv_iconic",
  "last_refreshed_at": "2025-10-19T05:00:00.000Z",
  "cache": "hit",
  "results": [
    {
      "place_id": "123e4567-e89b-12d3-a456-426614174000",
      "city_id": "af20eccd-4b77-4072-ac23-21d179f4b37e",
      "name": "Portland Cà Phê",
      "cuisine": ["coffee_shop", "vietnamese"],
      "address": "2601 Northeast Martin Luther King Junior Boulevard Portland 97212",
      "lat": 45.490501,
      "lon": -122.637224,
      "rank": 1,
      "iconic_score": 47.8,
      "unique_threads": 126,
      "total_mentions": 2038
    }
  ],
  "pagination": {
    "offset": 0,
    "limit": 50,
    "total": 250,
    "has_more": true
  },
  "response_time_ms": 62
}
```

**Response Body (Unranked City):**

```json
{
  "ranked": false,
  "rank_source": "unranked_osm",
  "last_refreshed_at": null,
  "cache": "miss",
  "results": [
    {
      "place_id": "987fcdeb-51a2-43f7-8c9d-123456789abc",
      "name": "Sample Restaurant",
      "cuisine": ["italian"],
      "address": "123 Main St",
      "lat": 40.7128,
      "lon": -74.0060,
      "brand": null,
      "source": "overture"
    }
  ],
  "pagination": {
    "offset": 0,
    "limit": 50,
    "total": 1200,
    "has_more": true
  },
  "response_time_ms": 45
}
```

**Field Descriptions:**

- `rank_source`: Source of rankings
  - `mv_iconic`: Materialized view for iconic (all-time best)
  - `mv_trending`: Materialized view for trending (recent popularity)
  - `unranked_osm`: Unranked OpenStreetMap/Overture data
- `cache`: `hit` if ETag matched, `miss` otherwise
- `iconic_score`: Wilson-smoothed score 0-100 (ranked only)
- `trending_score`: Time-decayed score 0-100 (ranked only)
- `unique_threads`: Number of unique Reddit threads mentioning place
- `total_mentions`: Total Reddit mentions across all threads

**Example Requests:**

```bash
# Get top iconic places in Portland
curl "https://forklore.ai/api/v2/search?city=Portland&type=iconic&limit=10"

# Get trending coffee shops in NYC
curl "https://forklore.ai/api/v2/search?city=nyc&type=trending&cuisine=coffee_shop&limit=20"

# Pagination
curl "https://forklore.ai/api/v2/search?city=pdx&type=iconic&limit=50&offset=50"

# Conditional request (uses ETag)
curl -H "If-None-Match: \"abc123-...-50-0\"" \
  "https://forklore.ai/api/v2/search?city=Portland&type=iconic&limit=50"
```

**Supported Cuisine Types:**

Common cuisine values include: `coffee_shop`, `vietnamese`, `mexican`, `italian`, `japanese`, `chinese`, `thai`, `indian`, `pizza`, `burger`, `breakfast`, `bakery`, `bar`, `brewery`, `seafood`, `steakhouse`, `american`, `fast_food`

For a complete list, query places and inspect `cuisine` arrays.

---

### GET /fuzzy

Autocomplete and fuzzy search endpoint using trigram similarity.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query (minimum 2 characters) |
| `city` | string | No | Filter by city name or alias |
| `limit` | integer | No | Results limit (default: 10, max: 50) |

**Response Headers:**
```
Cache-Control: public, max-age=300, stale-while-revalidate=3600
```

**Response Body:**

```json
{
  "query": "pho",
  "results": [
    {
      "place_id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "Pho Oregon",
      "city": "Portland",
      "cuisine": ["vietnamese"],
      "address": "2518 Southeast 82nd Avenue Portland 97266",
      "lat": 45.496789,
      "lon": -122.578901,
      "similarity": 0.75,
      "score": 43.0
    }
  ],
  "response_time_ms": 66
}
```

**Field Descriptions:**

- `similarity`: Trigram similarity score 0-1 (higher is better match)
- `score`: Iconic score if available, 0 otherwise (used for tie-breaking)

**Example Requests:**

```bash
# Fuzzy search across all cities
curl "https://forklore.ai/api/v2/fuzzy?q=coffee"

# Search within specific city
curl "https://forklore.ai/api/v2/fuzzy?q=pho&city=Portland"

# Autocomplete with limit
curl "https://forklore.ai/api/v2/fuzzy?q=star&limit=5"
```

**Notes:**

- Minimum query length: 2 characters
- Uses PostgreSQL pg_trgm for fuzzy matching
- Results ordered by similarity DESC, then score DESC
- Faster than full-text search for short queries

---

### GET /places/:id

Get detailed information about a specific place (not yet implemented).

**Planned Response:**

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "name": "Portland Cà Phê",
  "city": "Portland",
  "cuisine": ["coffee_shop", "vietnamese"],
  "address": "2601 Northeast Martin Luther King Junior Boulevard Portland 97212",
  "coordinates": {
    "lat": 45.490501,
    "lon": -122.637224
  },
  "scores": {
    "iconic": 47.8,
    "trending": 84.6
  },
  "mentions": {
    "total": 2038,
    "unique_threads": 126,
    "recent_snippets": [
      {
        "text": "Best coffee in Portland!",
        "score": 142,
        "posted_at": "2024-10-15T12:00:00.000Z",
        "subreddit": "Portland"
      }
    ]
  }
}
```

---

### GET /health

System health check endpoint for monitoring and load balancers.

**Query Parameters:** None

**Response Headers:**
```
Cache-Control: no-cache, no-store, must-revalidate
```

**Response Body:**

```json
{
  "status": "healthy",
  "checks": {
    "database": {
      "status": "healthy",
      "latency_ms": 12
    },
    "materialized_views": {
      "status": "healthy",
      "views": [
        {
          "name": "mv_top_iconic_by_city",
          "age_hours": 1.2,
          "row_count": 5000,
          "last_refresh": "2025-10-19T05:00:00.000Z"
        }
      ]
    },
    "job_queue": {
      "status": "healthy",
      "last_24h": {
        "completed": 12,
        "running": 1,
        "queued": 2,
        "failed": 0
      }
    },
    "cities": {
      "status": "healthy",
      "total": 2,
      "ranked": 1,
      "unranked": 1
    }
  },
  "uptime_ms": 45,
  "response_time_ms": 45
}
```

**Status Values:**

- `healthy`: All systems operational
- `stale`: MVs are >24h old (warning)
- `unhealthy`: Critical failure (database down, etc.)

**Example Request:**

```bash
curl https://forklore.ai/api/health
```

---

## Best Practices

### Caching

1. **Use ETags**: Send `If-None-Match` header to leverage HTTP 304 responses
2. **Respect Cache-Control**: Cache responses according to `max-age` and `stale-while-revalidate`
3. **MV-based Caching**: `/search` responses are stable between MV refreshes (hourly)

### Pagination

1. Use `limit` and `offset` for large result sets
2. Check `pagination.has_more` to determine if more results exist
3. Maximum limit is 100 for `/search`, 50 for `/fuzzy`

### City Resolution

Cities can be queried by:
- Full name: `"Portland"`, `"San Francisco"`
- Aliases: `"PDX"`, `"SF"`, `"NYC"`
- State abbreviation: `"Portland OR"`, `"Seattle WA"`
- Nicknames: `"The Big Apple"`, `"Emerald City"`

### Error Handling

Always check for:
1. HTTP status codes (400, 404, 429, 500)
2. `error` and `code` fields in response body
3. Rate limit headers to implement backoff

### Performance

Expected response times (P95):
- `/search`: <100ms (ranked cities)
- `/fuzzy`: <50ms
- `/cities`: <100ms
- `/health`: <50ms

If experiencing slow responses, check:
1. Network latency to server
2. Pagination (reduce `limit` if needed)
3. Cuisine filters (may be slower on large datasets)

---

## Rate Limit Handling Example

```javascript
async function searchWithRetry(city, type) {
  const response = await fetch(
    `https://forklore.ai/api/v2/search?city=${city}&type=${type}`
  );

  if (response.status === 429) {
    const retryAfter = response.headers.get('X-RateLimit-Reset');
    const waitTime = (parseInt(retryAfter) * 1000) - Date.now();
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return searchWithRetry(city, type);
  }

  return response.json();
}
```

## ETag Caching Example

```javascript
let cachedETag = null;

async function searchWithCache(city, type) {
  const headers = {};
  if (cachedETag) {
    headers['If-None-Match'] = cachedETag;
  }

  const response = await fetch(
    `https://forklore.ai/api/v2/search?city=${city}&type=${type}`,
    { headers }
  );

  if (response.status === 304) {
    // Use cached data
    return cachedData;
  }

  cachedETag = response.headers.get('ETag');
  const data = await response.json();
  return data;
}
```
