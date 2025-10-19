# Forklore.ai

Production-grade restaurant discovery platform powered by Reddit community insights and global geospatial data.

## Status

**Currently**: Clean slate production rebuild (Phase 1)
**Goal**: Search ANY city globally and get Reddit-ranked restaurant recommendations

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for implementation roadmap and [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) for architecture decisions.

## Overview

Forklore.ai enables users to discover restaurants in any city worldwide by aggregating and analyzing Reddit mentions. The platform combines:

- **Global Coverage**: On-demand city bootstrap via Overpass API (OpenStreetMap)
- **Rich Rankings**: Pre-loaded cities get full Reddit sentiment analysis
- **Instant Results**: Unranked results immediately, rankings appear after background processing
- **Production Quality**: Sub-100ms queries, proper caching, Reddit ToS compliance

## Architecture

### Hybrid Data Strategy

**Preloaded Cities** (high-quality):
- Overture Maps POI data (monthly dumps)
- Historical Reddit mentions ingested
- Full iconic + trending rankings available
- Example: NYC, SF, LA, Chicago, Austin

**On-Demand Bootstrap** (any city):
- Overpass API fetch (OpenStreetMap data)
- Basic place listings immediately
- Reddit ingestion job queued in background
- Rankings appear after job completes

### Tech Stack

- **Database**: PostgreSQL 16 (Neon) with PostGIS + pg_trgm
- **Framework**: Next.js 14 (App Router, serverless)
- **Cache**: Upstash Redis (rate limiting)
- **Data Sources**: Overture Maps, Overpass API, Reddit API
- **Deployment**: Vercel (planned)

### Project Structure

```
forklore.ai/
├── prisma/
│   └── migrations_v2/           # Production migrations (clean slate)
│       ├── 000_clean_slate.sql
│       ├── 001_core_schema.sql
│       ├── 002_materialized_views.sql
│       └── 003_scoring_functions.sql
├── config/
│   ├── tuning.json              # All tunable constants
│   └── cities.json              # City manifest (planned)
├── lib/                          # Production libraries (to be built)
│   ├── match.ts                 # Multi-stage matching algorithm
│   ├── bootstrap.ts             # On-demand city bootstrap
│   ├── jobs.ts                  # Job queue management
│   └── observability.ts         # Logging + metrics
├── app/api/v2/                  # Production API (to be built)
│   ├── search/route.ts
│   ├── fuzzy/route.ts
│   ├── place/[id]/route.ts
│   └── cities/route.ts
├── scripts/                     # ETL and maintenance scripts (to be built)
│   ├── bootstrap_city.ts
│   ├── reddit_ingest.ts
│   ├── compute_aggregations.sql
│   └── refresh_mvs.sql
├── docs/
│   └── ARCHITECTURE.md          # System design (Phase 5)
└── _archive/                    # Old prototype code
```

## Database Schema (Production)

### Core Tables

**City**: Global city registry
- `id`, `name`, `country`, `bbox` (geometry), `lat`, `lon`
- `ranked` BOOLEAN (true if has Reddit data)
- `last_refreshed_at` (for staleness tracking)

**Place**: Restaurants from all sources
- `id`, `city_id`, `name`, `name_norm` (for matching)
- `geog` (PostGIS geography point)
- `cuisine[]`, `status`, `source` (overture/osm/bootstrap)
- `aliases[]` (for matching variations)

**RedditMention**: ToS-compliant metadata only
- `place_id`, `subreddit`, `post_id`, `comment_id`
- `permalink` (attribution), `text_hash` (SHA256 for dedup)
- `score`, `ts` (timestamp)
- **NO raw text stored** (Reddit ToS compliant)

**PlaceAggregation**: Pre-computed scores
- `iconic_score`, `trending_score`
- `unique_threads`, `total_mentions`, `mentions_90d`
- `top_snippets` JSONB (permalink + metadata only)

**JobQueue**: Async task management
- `type` (bootstrap_city, ingest_reddit, compute_aggregations)
- `status` (queued, running, done, error)
- `payload` JSONB, `attempts`, `error`

### Materialized Views

All with covering indexes for sub-100ms queries:

- `mv_top_iconic_by_city`: Pre-ranked by Wilson Score
- `mv_top_trending_by_city`: Pre-ranked by exponential decay
- `mv_top_by_cuisine`: Indexed by cuisine type

### Key Indexes

- **Trigram**: `GIN (name_norm gin_trgm_ops)` for fuzzy matching (threshold: 0.55)
- **Geospatial**: `GIST (geog)` for location queries
- **Time-series**: `BRIN (ts)` on RedditMention (100-1000x smaller than B-tree)
- **Covering**: `(city_id, rank) INCLUDE (all displayed fields)` for index-only scans

## Scoring Algorithms

### Iconic Score (All-Time Popularity)

Wilson Score Lower Bound with Bayesian smoothing:

```
wilson_lower_bound(upvotes, mentions × prior) × scale
+ unique_threads × 8
+ total_mentions × 2
/ log(days_since_2015)
```

**Prevents**: Viral flukes, low-sample bias
**Requires**: Minimum 3 mentions, 95% confidence interval

### Trending Score (Recent Activity)

Exponential time decay with 14-day half-life:

```
Σ(score × e^(-ln(2) × days_ago / 14)) × 100
× recency_multiplier
+ unique_threads × 20
```

**Recency Multipliers**:
- Last 24h: 2.0x
- Last 7d: 1.5x
- Older: 1.0x

**Requires**: Minimum 2 mentions in 90 days

All constants tunable via `config/tuning.json`

## Multi-Stage Matching Algorithm

Handles typos, abbreviations, and geo ambiguity:

1. **Exact alias match** (normalized canonical name + known aliases)
2. **Trigram similarity** (pg_trgm threshold: 0.55)
3. **Geo assist** (within 2km → threshold drops to 0.50)
4. **Brand disambiguation** (chains vs single-location)
5. **Address hints** (if available in mention text)

## Reddit ToS Compliance

Fully compliant with Reddit Data API Terms:

- **Stored**: Permalinks (attribution), text hashes (dedup), metadata
- **NOT Stored**: Raw comment/post text, author information
- **Use Case**: Transformative aggregation (fair use)
- **Traffic**: Drives users TO Reddit via permalinks

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 16+ with PostGIS, pg_trgm, uuid-ossp extensions
- Reddit API credentials
- Upstash Redis account (free tier)
- Neon database (free tier for dev)

### Installation

```bash
# Clone repository
git clone https://github.com/Surfrrosa/forklore.ai.git
cd forklore.ai

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your credentials

# Run production migrations
source .env.local
psql "$DATABASE_URL" -f prisma/migrations_v2/000_clean_slate.sql
psql "$DATABASE_URL" -f prisma/migrations_v2/001_core_schema.sql
psql "$DATABASE_URL" -f prisma/migrations_v2/002_materialized_views.sql
psql "$DATABASE_URL" -f prisma/migrations_v2/003_scoring_functions.sql

# Verify schema
psql "$DATABASE_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
```

### Current Status

**Completed** (Phase 1 - Day 1):
- ✅ Production migrations (clean slate)
- ✅ Core schema (City, Place, RedditMention, JobQueue, etc.)
- ✅ Materialized views with covering indexes
- ✅ Scoring functions (Wilson Score, exponential decay)
- ✅ Tuning config (`config/tuning.json`)

**Next Steps** (Phase 1 - Day 2):
- [ ] Migration 004: Seed NYC data (validate schema)
- [ ] Create city manifest (`config/cities.json`)
- [ ] Build multi-stage matching algorithm
- [ ] Implement Overpass API integration
- [ ] On-demand city bootstrap

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for full 5-day roadmap.

## Development

### Code Standards

- **TypeScript**: Strict mode, no implicit any
- **Linting**: ESLint with Next.js rules
- **Error Handling**: Comprehensive try-catch with structured logging
- **Documentation**: JSDoc on exported functions
- **Testing**: Unit + integration tests (planned)

### Performance Targets (SLOs)

- Search API: p50 ≤ 40ms, p95 ≤ 100ms
- Fuzzy search: p50 ≤ 30ms, p95 ≤ 60ms
- End-to-end (cached): p95 ≤ 200ms
- Bootstrap (first search): ≤ 3s

### Cost Targets

- Single city (dev): < $25/month
- 10 cities (prod): < $100/month
- Components: Neon ($0-20), Upstash ($0), Vercel ($0-20)

## License

MIT License - see [LICENSE](LICENSE) for details

## Acknowledgments

- **Data Sources**: Reddit API, Overture Maps, OpenStreetMap
- **Infrastructure**: Neon, Upstash, Vercel
- **Scoring Reference**: Wilson Score (Evan Miller), Bayesian methods

## Contact

Maintained by [@Surfrrosa](https://github.com/Surfrrosa)

For issues and feature requests: [GitHub Issues](https://github.com/Surfrrosa/forklore.ai/issues)
