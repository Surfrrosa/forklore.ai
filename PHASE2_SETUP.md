# Forklore.ai Phase 2 Setup Guide

## Architecture Overview

Forklore.ai Phase 2 uses a **pre-computed, zero-runtime-cost** architecture:

```
Reddit Historical Data (Pushshift)
         +
Overture Maps Places (60M+ POIs)
         ↓
    DuckDB ETL
         ↓
  Neon Postgres (PostGIS + pgvector + pg_trgm)
         ↓
Materialized Views (mv_top_iconic, mv_top_trending, mv_top_cuisine)
         ↓
  Next.js 15 API v2 (<100ms latency)
```

### Key Features

- **Historical Reddit data**: 10 years of Reddit discussions (2015-2025) via Pushshift
- **Comprehensive POI database**: 60M+ places from Overture Maps (free, monthly updates)
- **Zero runtime API costs**: All data pre-computed, queries served from materialized views
- **Sub-100ms latency**: Typical queries return in <10ms
- **Spatial queries**: PostGIS for distance-based search
- **Fuzzy matching**: pg_trgm for "did you mean?" and autocomplete
- **NER extraction**: spaCy for accurate restaurant name extraction

## Tech Stack

- **Database**: Neon Postgres (serverless)
  - Extensions: PostGIS, pgvector, pg_trgm
  - PgBouncer pooling for serverless scalability
  - Cost: ~$5-25/month

- **ETL**: DuckDB with httpfs (reads Parquet directly from S3/Azure)

- **Data Sources**:
  - Pushshift Reddit dumps (Academic Torrents)
  - Overture Maps Places (Azure Blob Storage)

- **API**: Next.js 15 with Prisma

- **NER**: spaCy (en_core_web_sm model)

## Setup Instructions

### 1. Prerequisites

```bash
# Install dependencies
npm install

# Install Python dependencies for ETL
pip install spacy psycopg2-binary duckdb

# Download spaCy model
python -m spacy download en_core_web_sm

# Install DuckDB CLI
brew install duckdb  # macOS
# or: apt install duckdb  # Linux
```

### 2. Database Setup

```bash
# Set DATABASE_URL in .env.local
# Get connection string from Neon dashboard
# Use pooled connection string (ends with .pooler.neon.tech)
echo "DATABASE_URL=postgres://user:pass@ep-xxx.pooler.neon.tech/forklore?pgbouncer=true" >> .env.local

# Run Prisma migrations
npx prisma migrate deploy

# Run PostGIS setup (creates extensions, indexes, materialized views)
psql $DATABASE_URL -f prisma/migrations/00_init_postgis.sql
```

### 3. Data Pipeline

#### Step 1: Download Pushshift Data

```bash
# Download December 2024 Reddit data (~50GB compressed)
./scripts/01_download_pushshift.sh 2024-12

# For full historical analysis, download multiple months:
for month in 2024-{01..12}; do
  ./scripts/01_download_pushshift.sh $month
done
```

#### Step 2: Download Overture Places

```bash
# Download Overture Maps Places (GeoParquet)
./scripts/02_download_overture.sh

# Note: DuckDB will read directly from Azure Blob Storage via httpfs
# This script is for reference; ETL uses httpfs for zero-download approach
```

#### Step 3: Run DuckDB ETL

```bash
# Process Pushshift + Overture, export to CSV
./scripts/03_etl_pipeline.sh 2024-12

# This will:
# 1. Load Overture Places from Azure (restaurants in target cities)
# 2. Load Pushshift Reddit data (food-related subreddits)
# 3. Extract restaurant candidates with regex
# 4. Match candidates to Overture places
# 5. Export to CSV (cities.csv, places.csv, mentions.csv)
```

#### Step 4: Load into Postgres

```bash
# Load CSV exports into Neon Postgres
psql $DATABASE_URL -f scripts/04_load_postgres.sql

# This will:
# 1. Load City dimension
# 2. Load Place dimension (with geography points)
# 3. Load RedditMention fact table
# 4. Create all indexes (GIST, GIN, BRIN)
```

#### Step 5: Run NER Extraction (Optional)

```bash
# Extract restaurant names with spaCy NER
# This refines the regex-based extraction from DuckDB
python scripts/05_ner_extraction.py

# This will:
# 1. Fetch Reddit texts from Postgres
# 2. Extract restaurant names with spaCy
# 3. Match to Overture Places using pg_trgm similarity
# 4. Insert additional mentions
```

#### Step 6: Compute Scores

```bash
# Run scoring engine (monthly batch job)
python scripts/06_compute_scores.py

# This will:
# 1. Fetch all mentions from Postgres
# 2. Compute iconic_score and trending_score per restaurant
# 3. Update PlaceAggregation table
# 4. Refresh materialized views (mv_top_iconic, mv_top_trending, mv_top_cuisine)
```

### 4. API Testing

```bash
# Start Next.js dev server
npm run dev

# Test iconic rankings
curl "http://localhost:3000/api/v2/search?city=nyc&type=iconic&limit=10"

# Test trending rankings
curl "http://localhost:3000/api/v2/search?city=nyc&type=trending&limit=10"

# Test cuisine rankings
curl "http://localhost:3000/api/v2/search?city=nyc&type=cuisine&cuisine=pizza&limit=10"

# Test fuzzy search
curl "http://localhost:3000/api/v2/fuzzy?q=katz&city=nyc"

# Test place details
curl "http://localhost:3000/api/v2/place/{place-id}"
```

## API Endpoints

### `GET /api/v2/search`

Query pre-computed rankings from materialized views.

**Parameters**:
- `city` (required): City name or alias (e.g., "nyc", "sf", "Chicago")
- `type` (required): Ranking type - "iconic", "trending", or "cuisine"
- `cuisine` (optional): Cuisine type (required if type=cuisine)
- `limit` (optional): Max results (default: 50)

**Example**:
```bash
/api/v2/search?city=nyc&type=iconic&limit=50
```

**Response**:
```json
{
  "city": "New York",
  "type": "iconic",
  "count": 50,
  "results": [
    {
      "placeId": "...",
      "name": "Katz's Delicatessen",
      "cuisine": ["deli", "sandwich"],
      "address": "205 E Houston St, New York, NY 10002",
      "lat": 40.7223,
      "lon": -73.9874,
      "score": 847.23,
      "uniqueThreads": 127,
      "totalMentions": 342,
      "totalUpvotes": 1847,
      "lastSeen": "2024-12-15T18:23:00Z",
      "topSnippets": [...],
      "rank": 1
    }
  ],
  "cached": true,
  "timestamp": "2025-01-15T10:30:00Z"
}
```

### `GET /api/v2/place/{id}`

Get full details for a single restaurant.

**Response**:
```json
{
  "id": "...",
  "name": "Katz's Delicatessen",
  "address": "205 E Houston St, New York, NY 10002",
  "city": "New York",
  "cuisine": ["deli", "sandwich"],
  "location": { "lat": 40.7223, "lon": -73.9874 },
  "status": "active",
  "scores": {
    "iconic": 847.23,
    "trending": 124.56,
    "mentions90d": 23,
    "uniqueThreads": 127,
    "totalMentions": 342,
    "totalUpvotes": 1847,
    "lastSeen": "2024-12-15T18:23:00Z",
    "topSnippets": [...]
  },
  "recentMentions": [...]
}
```

### `GET /api/v2/fuzzy`

Fuzzy name search using pg_trgm similarity.

**Parameters**:
- `q` (required): Search query (min 2 chars)
- `city` (optional): Filter by city
- `limit` (optional): Max results (default: 10)

**Example**:
```bash
/api/v2/fuzzy?q=katz&city=nyc
```

**Response**:
```json
{
  "query": "katz",
  "city": "nyc",
  "count": 3,
  "results": [
    {
      "id": "...",
      "name": "Katz's Delicatessen",
      "address": "205 E Houston St, New York, NY 10002",
      "city": "New York",
      "cuisine": ["deli", "sandwich"],
      "matchScore": 0.92
    }
  ]
}
```

## Monthly Update Job

Run this monthly to refresh data:

```bash
# 1. Download latest Pushshift data
./scripts/01_download_pushshift.sh $(date +%Y-%m)

# 2. Run ETL
./scripts/03_etl_pipeline.sh $(date +%Y-%m)

# 3. Load into Postgres
psql $DATABASE_URL -f scripts/04_load_postgres.sql

# 4. Recompute scores
python scripts/06_compute_scores.py

# Done! Materialized views are automatically refreshed.
```

## Performance Metrics

- **Query latency**: <10ms (typical), <100ms (p99)
- **Database size**: ~5-10GB for 100k restaurants + 10M mentions
- **ETL runtime**: ~2-4 hours for full historical data (2015-2025)
- **Monthly update**: ~30 minutes

## Cost Breakdown

- **Neon Postgres**: $5-25/month (based on storage + compute)
- **Cloudflare R2**: $1-5/month (Pushshift dumps storage)
- **Vercel/Netlify**: $0 (hobby tier sufficient for MVP)
- **Total**: ~$10-35/month

## Migration from Phase 1

To switch from Phase 1 (real-time Reddit API) to Phase 2:

1. Run Phase 2 setup (above)
2. Update frontend to use `/api/v2/search` instead of `/api/search`
3. Test both APIs in parallel
4. Deprecate Phase 1 API once Phase 2 is validated

## Troubleshooting

### "Extension postgis does not exist"
- Ensure you're using Neon (native PostGIS support)
- Run: `psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS postgis;"`

### DuckDB can't read from Azure
- Install httpfs: `INSTALL httpfs;` in DuckDB CLI
- Check network connectivity to Azure Blob Storage

### Scoring produces NaN/Infinity
- Check for missing timestamps in RedditMention table
- Ensure upvotes are non-negative integers

### Materialized views not refreshing
- Run manually: `psql $DATABASE_URL -c "SELECT refresh_all_materialized_views();"`
- Check for UNIQUE index conflicts

## Next Steps

1. **Add more cities**: Expand CITY_SUBREDDITS mapping in ETL scripts
2. **Implement spatial search**: "Restaurants within 5km of Times Square"
3. **Add embeddings**: Use pgvector for semantic aliasing (e.g., "Katz" → "Katz's Deli")
4. **Real-time updates**: Stream new Reddit posts via Websocket → incremental ETL
5. **User favorites**: Add User table + bookmarks

## Resources

- [Neon Postgres Docs](https://neon.tech/docs)
- [PostGIS Documentation](https://postgis.net/documentation/)
- [Overture Maps](https://overturemaps.org/)
- [Pushshift Academic Torrents](https://academictorrents.com/details/30dee5f0406da7a353aff6a8caa2d54fd01f2ca1)
- [DuckDB httpfs Extension](https://duckdb.org/docs/extensions/httpfs)
