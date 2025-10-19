# Implementation Notes - Production Rebuild

**Date**: 2025-10-18
**Status**: In Progress - Clean Slate Implementation

## What We're Building

A production-grade restaurant discovery platform where users can search **any city globally** and get Reddit-ranked restaurant recommendations.

## Architecture Decisions

### 1. Global City Support Strategy

**Decision**: Hybrid approach with on-demand bootstrap
- Pre-loaded cities get full Reddit rankings
- Unknown cities bootstrap via Overpass API (OpenStreetMap data)
- Bootstrap returns unranked results immediately, queues Reddit ingestion job
- User sees basic listings instantly, rankings appear after background job completes

**Rationale**: Balances instant global coverage with rich data for popular cities.

### 2. Data Sources

- **Overture Maps**: Monthly Parquet dumps for pre-loaded cities (high quality POI data)
- **Overpass API (OSM)**: On-demand bootstrap for new cities (good coverage, lower quality)
- **Reddit API**: Sentiment/ranking data (rate-limited, requires careful ingestion)

### 3. Scoring Algorithms

**Iconic Score** (all-time popularity):
- Wilson Score Lower Bound (Bayesian smoothing to prevent flukes)
- Minimum 3 mentions required
- Thread diversity bonus + mention bonus
- Soft time normalization (log decay from 2015 epoch)

**Trending Score** (recent activity):
- Exponential time decay (14-day half-life)
- 90-day lookback window
- Minimum 2 mentions required
- Recency multipliers (2x for 24h, 1.5x for 7d)

**Rationale**: Prevents viral flukes, rewards sustained consensus, smooth degradation over time.

### 4. Database Schema

**Core Tables**:
- `City`: Global city registry with bbox for geo queries
- `Place`: Restaurants from all sources (Overture, OSM, bootstrap)
- `RedditMention`: ToS-compliant (metadata only, no raw text)
- `PlaceAggregation`: Pre-computed scores
- `JobQueue`: Async task management
- `Subreddit`: City-to-subreddit mapping

**Materialized Views** (for <100ms queries):
- `mv_top_iconic_by_city`
- `mv_top_trending_by_city`
- `mv_top_by_cuisine`

All MVs have covering indexes: `(city_id, rank) INCLUDE (all displayed fields)`

### 5. API Design

**Endpoints**:
- `GET /api/v2/search` - Main search (iconic/trending/cuisine)
- `GET /api/v2/fuzzy` - Autocomplete
- `GET /api/v2/place/{id}` - Place details
- `GET /api/v2/cities` - Available cities + bootstrap status

**Response Contract**:
```json
{
  "ranked": true|false,
  "rank_source": "mv_iconic"|"mv_trending"|"unranked_osm",
  "last_refreshed_at": "ISO timestamp",
  "cache": "hit"|"miss",
  "results": [],
  "pagination": {}
}
```

### 6. Matching Algorithm (Multi-Stage)

1. **Exact alias match** (normalized canonical name + aliases)
2. **Trigram similarity** (pg_trgm with threshold 0.55)
3. **Geo assist** (within 2km of city centroid → threshold drops to 0.50)
4. **Brand disambiguation** (chain vs single-location rules)
5. **Address hints** (if available in mention text)

**Rationale**: High precision while handling typos, abbreviations, and geo ambiguity.

### 7. Reddit ToS Compliance

**Stored**:
- Permalink (for attribution)
- Text hash (SHA256 for dedup)
- Text length
- Score, timestamp, subreddit

**NOT Stored**:
- Raw comment/post text
- Author information

**Rationale**: Fully compliant with Reddit Data API terms. All data is transformative/derived.

## Directory Structure

```
forklore.ai/
├── prisma/
│   ├── migrations_v2/          # Production migrations (clean slate)
│   │   ├── 001_core_schema.sql
│   │   ├── 002_materialized_views.sql
│   │   └── 003_scoring_functions.sql
│   └── schema_v2.prisma        # Production Prisma schema
├── config/
│   ├── tuning.json             # All tunable constants
│   └── cities.json             # City manifest (bbox + subreddits)
├── lib/
│   ├── match.ts                # Multi-stage matching
│   ├── bootstrap.ts            # On-demand city bootstrap
│   ├── jobs.ts                 # Job queue management
│   └── observability.ts        # Logging + metrics
├── app/api/v2/                 # Clean API implementation
│   ├── search/route.ts
│   ├── fuzzy/route.ts
│   ├── place/[id]/route.ts
│   └── cities/route.ts
├── scripts/
│   ├── places_monthly_duckdb.sql
│   ├── reddit_ingest.ts
│   ├── compute_aggregations.sql
│   ├── refresh_mvs.sql
│   └── bootstrap_city.ts
├── docs/
│   ├── ARCHITECTURE.md
│   ├── RUNBOOKS.md
│   ├── SLOs.md
│   └── SECURITY_COMPLIANCE.md
└── tests/
    ├── matching.test.ts
    ├── scoring.test.ts
    └── api.test.ts
```

## Migration from Old Code

**What to Keep**:
- Nothing - clean slate implementation

**What to Archive**:
- Old `prisma/migrations/` → `prisma/migrations_old/`
- Old API routes → `app/api/v1_archive/`

**Rationale**: Avoid confusion, start fresh with production spec.

## Performance Targets (SLOs)

- Search API: p50 ≤ 40ms, p95 ≤ 100ms (from DB)
- Fuzzy search: p50 ≤ 30ms, p95 ≤ 60ms
- End-to-end (cached): p95 ≤ 200ms
- Bootstrap (first search unknown city): ≤ 3s

## Cost Targets

- Single city (dev): < $25/month
- 10 cities (initial prod): < $100/month

**Breakdown**:
- Neon Postgres (free tier or $20/mo)
- Upstash Redis (free tier)
- Vercel hosting (free tier or $20/mo)
- Overpass API (free, rate-limited)

## Security & Compliance

- Reddit ToS: Fully compliant (no raw text storage)
- Secrets: All in env vars, never committed
- Rate limiting: Upstash Redis (100-300 req/hr per IP)
- CORS: Configured for webapp domain only
- Robots.txt: Block crawlers until public launch

## Testing Strategy

**Unit Tests**:
- Matching algorithm (precision/recall)
- Scoring formulas (Wilson, exponential decay)
- Name normalization

**Integration Tests**:
- API contract compliance
- MV refresh idempotency
- Bootstrap job flow

**Performance Tests**:
- Query latency measurement
- Cache hit ratio
- MV refresh time

## Deployment Plan

1. **Phase 1**: Core infrastructure + NYC only (validate)
2. **Phase 2**: Add 5 major cities (test scale)
3. **Phase 3**: Enable bootstrap for any city (full global)
4. **Phase 4**: Observability + alerting
5. **Phase 5**: Public launch

## Open Questions / Future Work

- [ ] Should we cache Overpass bootstrap results permanently or re-fetch periodically?
- [ ] Multi-language support for city names (aliases)?
- [ ] User-contributed corrections to POI data?
- [ ] API authentication for higher rate limits?

## References

- Reddit API Terms: https://www.reddit.com/wiki/api-terms
- Overture Maps: https://overturemaps.org
- Overpass API: https://wiki.openstreetmap.org/wiki/Overpass_API
- Wilson Score: https://www.evanmiller.org/how-not-to-sort-by-average-rating.html
