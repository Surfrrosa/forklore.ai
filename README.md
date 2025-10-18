# Forklore.ai

Community-driven restaurant discovery platform powered by Reddit sentiment analysis and geospatial data.

## Overview

Forklore.ai aggregates and analyzes restaurant mentions across Reddit to surface authentic dining recommendations. The platform combines natural language processing, sentiment analysis, and statistical ranking to identify iconic and trending restaurants in major cities.

### Key Features

- **Fuzzy Search**: pg_trgm-powered autocomplete with 0.55 similarity threshold
- **Dual Ranking System**: Wilson Score smoothing for iconic places, exponential decay for trending
- **Production-Grade API**: Rate limiting, HTTP caching, ETag support, pagination
- **Reddit ToS Compliant**: Permalink-based attribution, no raw content storage
- **Geospatial Integration**: PostGIS-enabled location queries and nearby search
- **Real-time Aggregation**: Materialized views with sub-100ms query performance

## Tech Stack

### Core

- **Runtime**: Node.js 20+, TypeScript 5.6
- **Framework**: Next.js 14 (App Router)
- **Database**: PostgreSQL 16 (Neon) with PostGIS + pg_trgm extensions
- **Caching**: Upstash Redis (rate limiting)
- **Deployment**: Vercel (planned)

### Data Processing

- **ETL**: DuckDB for CSV/Parquet processing
- **NER**: Custom named entity recognition for restaurant extraction
- **Scoring**: Bayesian Wilson Score, exponential time decay
- **Ingestion**: Reddit OAuth API with idempotent deduplication

## Architecture

### Project Structure

```
forklore.ai/
├── app/
│   ├── api/v2/           # API v2 endpoints
│   │   ├── search/       # Main search endpoint
│   │   ├── fuzzy/        # Autocomplete search
│   │   ├── cuisines/     # Cuisine facets
│   │   └── place/[id]/   # Individual place details
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   ├── cache.ts          # HTTP caching utilities (ETag, Cache-Control)
│   ├── ratelimit.ts      # Upstash rate limiting middleware
│   ├── prisma.ts         # Prisma client singleton
│   ├── reddit.ts         # Reddit API client
│   ├── gazetteer.ts      # Overture Maps integration
│   └── score.ts          # Scoring algorithms
├── prisma/
│   ├── schema.prisma     # Database schema
│   └── migrations/       # SQL migrations (001-009)
├── scripts/
│   ├── 01_download_pushshift.sh
│   ├── 02_download_overture.sh
│   ├── 03_etl_pipeline.sh
│   ├── 04_load_postgres.sql
│   ├── ingest_reddit_mentions.ts
│   └── compute_aggregations.sql
└── docs/
    ├── SCORING_MATH.md
    └── REDDIT_TOS_COMPLIANCE.md
```

### Database Schema

**Core Tables**:
- `City`: Geographic entities with timezone support
- `Place`: Restaurants with Overture Maps metadata
- `RedditMention`: ToS-compliant mention records (permalink + hash)

**Materialized Views** (for performance):
- `mv_top_iconic`: Pre-ranked by Wilson Score
- `mv_top_trending`: Pre-ranked by exponential decay
- `mv_top_by_cuisine`: Indexed by cuisine type

**Indexes**:
- BRIN on `RedditMention.timestamp` (100-1000x smaller than B-tree)
- GiST on `Place.geog` for geospatial queries
- GIN trigram on `Place.nameNorm` for fuzzy search

### API Endpoints

#### `GET /api/v2/search`

Main search endpoint with pagination and caching.

**Query Parameters**:
- `city` (required): City name or alias (nyc, sf, la)
- `type` (required): `iconic` | `trending` | `cuisine`
- `cuisine`: Cuisine filter (multiple allowed)
- `limit`: Results per page (default: 50, max: 100)
- `offset`: Pagination offset (default: 0)
- `facets`: Include cuisine counts (boolean)

**Response Headers**:
- `Cache-Control`: `public, max-age=3600, stale-while-revalidate=86400`
- `ETag`: Content hash for 304 responses
- `X-RateLimit-Limit`: 100
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Unix timestamp

**Example**:
```bash
curl "https://forklore.ai/api/v2/search?city=nyc&type=iconic&limit=20&offset=0"
```

#### `GET /api/v2/fuzzy`

Autocomplete search with trigram similarity.

**Query Parameters**:
- `q` (required): Query string (min 2 chars)
- `city`: Filter by city
- `limit`: Results (default: 10)

**Rate Limit**: 300 req/hour

#### `GET /api/v2/cuisines`

Cuisine facets for dynamic filtering.

**Query Parameters**:
- `city` (required): City name
- `limit`: Cuisine count (default: 50)

**Cache**: 6 hours

## Scoring Algorithms

### Iconic Score (Wilson Score Lower Bound)

Prevents flukes and low-sample bias using Bayesian confidence intervals.

```sql
wilson_lower_bound(upvotes, mentions × 100) × 1M
+ unique_threads × 50
+ total_mentions × 5
/ LOG(days_since_2020)
```

**Requirements**:
- Minimum 3 mentions
- Confidence interval: 95%
- Benefits: Stable rankings, no viral outliers

**Reference**: [docs/SCORING_MATH.md](docs/SCORING_MATH.md)

### Trending Score (Exponential Decay)

Time-weighted scoring with 14-day half-life.

```sql
Σ(score × e^(-ln(2) × days_ago / 14)) × 100
× recency_multiplier
+ unique_threads × 20
```

**Recency Multipliers**:
- Last 24h: 2.0x
- Last 7d: 1.5x
- Older: 1.0x

**Requirements**:
- Minimum 2 mentions in 90 days
- Half-life: 14 days
- Benefits: Smooth degradation, no cliffs

## Reddit ToS Compliance

In accordance with Reddit's Data API Terms and User Agreement:

- **No Raw Content Storage**: Only permalinks, hashes, and metadata stored
- **Attribution**: All mentions link back to original Reddit threads
- **Transformative Use**: Aggregated sentiment scores and rankings (fair use)
- **Traffic Generation**: Drives users TO Reddit via permalinks
- **Deduplication**: MD5 hashes prevent duplicate processing

**Reference**: [docs/REDDIT_TOS_COMPLIANCE.md](docs/REDDIT_TOS_COMPLIANCE.md)

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 16+ with PostGIS and pg_trgm extensions
- Reddit API credentials ([apply here](https://www.reddit.com/prefs/apps))
- Upstash Redis account (free tier available)

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

# Run database migrations
source .env.local
psql "$DATABASE_URL" -f prisma/migrations/00_init_postgis.sql
psql "$DATABASE_URL" -f prisma/migrations/001_trgm_idx.sql
# ... run migrations 002-009 in order

# Start development server
npm run dev
```

### Running Migrations

Migrations must be run in order:

```bash
for file in prisma/migrations/*.sql; do
  echo "Running $file..."
  psql "$DATABASE_URL" -f "$file"
done
```

### Data Ingestion

```bash
# Download Reddit data (Pushshift archives)
./scripts/01_download_pushshift.sh 2024-12

# Download restaurant data (Overture Maps)
./scripts/02_download_overture.sh

# Run ETL pipeline
./scripts/03_etl_pipeline.sh

# Load to Postgres
psql "$DATABASE_URL" -f scripts/04_load_postgres.sql

# Ingest Reddit mentions
npx dotenv -e .env.local -- npx tsx scripts/ingest_reddit_mentions.ts

# Compute aggregations
psql "$DATABASE_URL" -f scripts/compute_aggregations.sql
```

## Testing

Comprehensive test suite included:

```bash
# Run automated tests
./test-week1.sh
```

**Test Coverage**:
- Fuzzy search threshold validation
- Pagination metadata
- Cache headers (Cache-Control, ETag)
- Rate limiting (X-RateLimit-* headers)
- Multiple cuisine filtering
- Cuisine facet endpoint

**Reference**: [TESTING_GUIDE.md](TESTING_GUIDE.md)

## Performance

**API Latency Targets**:
- Iconic/Trending search: <100ms (via materialized views)
- Fuzzy search: <50ms (trigram indexes)
- Cuisine facets: <20ms (aggregated counts)

**Caching Strategy**:
- Search results: 1 hour cache, 24 hour stale-while-revalidate
- Cuisine facets: 6 hour cache
- Fuzzy search: 5 minute cache
- ETag support for 304 responses

**Rate Limiting**:
- Standard endpoints: 100 req/hour per IP
- Fuzzy search: 300 req/hour per IP
- Sliding window algorithm via Upstash Redis

## Development

### Code Quality Standards

- **TypeScript**: Strict mode enabled, no implicit any
- **Linting**: ESLint with Next.js recommended rules
- **Error Handling**: Comprehensive try-catch with structured logging
- **Documentation**: JSDoc comments on exported functions
- **Testing**: Manual test suite (automated tests planned)

### Contribution Guidelines

1. Fork the repository
2. Create feature branch (`git checkout -b feature/your-feature`)
3. Run tests (`./test-week1.sh`)
4. Commit changes (follow conventional commits)
5. Push to branch
6. Open Pull Request

## Roadmap

### Week 1 (Complete)

- [x] Fuzzy matching threshold optimization (0.42 → 0.55)
- [x] BRIN index on timestamp column
- [x] HTTP caching with ETag support
- [x] Offset-based pagination
- [x] Wilson Score + exponential decay scoring
- [x] Reddit ToS compliance refactor
- [x] Rate limiting with Upstash

### Week 2 (Planned)

- [ ] Borough/city alias normalization
- [ ] Nearby search with ST_DWithin
- [ ] Covering indexes for common queries
- [ ] Partial indexes (status='active')
- [ ] Monthly ETL automation with alerts

### Future

- [ ] User authentication
- [ ] Saved places / favorites
- [ ] Custom lists
- [ ] Email notifications for trending places
- [ ] Mobile app (React Native)
- [ ] Multi-city support expansion

## License

MIT License - see [LICENSE](LICENSE) for details

## Acknowledgments

- **Data Sources**: Reddit API, Overture Maps, OpenStreetMap
- **Infrastructure**: Neon (Postgres), Upstash (Redis), Vercel (hosting)
- **Inspiration**: Community-driven recommendation systems

## Contact

Project maintained by [@Surfrrosa](https://github.com/Surfrrosa)

For bugs and feature requests, please [open an issue](https://github.com/Surfrrosa/forklore.ai/issues).
