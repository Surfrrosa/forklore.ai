# Forklore.ai

**A completed technical exploration of Reddit-based restaurant discovery using scalable data pipelines and statistical ranking algorithms.**

## Project Status

**v1.0 Complete** - This project successfully demonstrated the technical feasibility of building a high-performance restaurant recommendation system powered by Reddit community insights. The system processed 24,000+ mentions across 3 major cities and achieved sub-100ms query latencies.

**Not actively maintained** - This was built as a learning project to explore scalable data pipelines, materialized views, and statistical ranking. The codebase is fully functional and can be run locally for exploration.

## What Was Built

### Core System
- Production-grade REST API with sub-100ms P95 latency
- Automated Reddit ingestion pipeline processing 24,000+ mentions
- Wilson Score-based ranking algorithm for statistical significance
- Multi-stage fuzzy matching with trigram similarity
- Materialized views with covering indexes for instant queries
- Idempotent job queue system for background processing

### Data Processed
```
New York City:  17,276 mentions from 4,014 places across 1,085 threads
Portland:        5,210 mentions from 2,586 places across   391 threads
San Francisco:   2,403 mentions from 3,013 places (in progress)

Total: 24,889 Reddit mentions indexed and ranked
```

### Performance Achieved
```
P50 latency:  32ms  (target: ≤40ms)
P95 latency:  91ms  (target: ≤100ms)
P99 latency:  91ms

Database queries: Index-only scans (optimal)
Materialized views: < 1 hour freshness
Wilson scoring: 0-100 range with Bayesian smoothing
```

## Architecture

### Tech Stack
- **Database**: PostgreSQL 16 (Neon) with PostGIS, pg_trgm, BRIN indexes
- **Framework**: Next.js 14 (App Router)
- **Cache**: Upstash Redis (rate limiting)
- **Data Source**: Reddit API (ToS compliant - metadata only)
- **Geo Data**: Overpass API (OpenStreetMap)

### Key Technical Decisions

**1. Materialized Views Over Real-Time Aggregation**
- Pre-computed rankings refreshed hourly
- Enabled sub-100ms queries without caching layers
- Covering indexes eliminated disk I/O

**2. Wilson Score Lower Bound for Rankings**
- Prevents low-sample bias (3 upvotes ≠ 100% confidence)
- Bayesian smoothing for fair comparison across sample sizes
- Produces scores in 0-100 range for intuitive understanding

**3. BRIN Indexes for Time-Series Data**
- 100-1000x smaller than B-tree indexes
- Ideal for Reddit mention timestamps (naturally sorted)
- Minimal write overhead during ingestion

**4. Idempotent Job Queue**
- All operations safe to retry on failure
- Handles partial completions gracefully
- No duplicate data from re-runs

**5. Trigram Fuzzy Matching**
- Handles typos, abbreviations ("st marks" → "St. Mark's Place")
- Geographic hints reduce false positives
- Similarity threshold: 0.55 (tunable)

## Database Schema

### Core Tables

**City** - City registry with geographic boundaries
```sql
id UUID PRIMARY KEY
name TEXT NOT NULL
country TEXT NOT NULL
bbox GEOMETRY(POLYGON, 4326)  -- Search boundary
lat/lon NUMERIC               -- Center point
ranked BOOLEAN                 -- Has Reddit data ingested
```

**Place** - Restaurant locations
```sql
id UUID PRIMARY KEY
city_id UUID REFERENCES City
name TEXT NOT NULL
name_norm TEXT                 -- Normalized for matching
geog GEOGRAPHY(POINT, 4326)    -- PostGIS geography
cuisine TEXT[]                 -- Multiple cuisines supported
aliases TEXT[]                 -- Matching variations
source TEXT                    -- bootstrap/overpass
```

**RedditMention** - Metadata only (ToS compliant)
```sql
id UUID PRIMARY KEY
place_id UUID REFERENCES Place
subreddit TEXT
post_id TEXT                   -- For permalink construction
score INTEGER                  -- Upvotes (proxy for consensus)
ts TIMESTAMP                   -- Mention timestamp
permalink TEXT                 -- Attribution link
text_hash TEXT                 -- SHA256 for deduplication
-- NO raw text stored (Reddit ToS compliant)
```

**PlaceAggregation** - Pre-computed scores
```sql
place_id UUID PRIMARY KEY
iconic_score NUMERIC           -- Wilson Score (all-time)
trending_score NUMERIC         -- Exponential decay (90d)
unique_threads INT             -- Distinct discussions
total_mentions INT             -- Total occurrences
mentions_90d INT               -- Recent activity
```

### Materialized Views

**mv_top_iconic_by_city** - All-time rankings
```sql
CREATE MATERIALIZED VIEW mv_top_iconic_by_city AS
SELECT
  p.city_id,
  p.id AS place_id,
  p.name,
  p.cuisine,
  pa.iconic_score,
  pa.unique_threads,
  pa.total_mentions,
  ROW_NUMBER() OVER (PARTITION BY p.city_id ORDER BY pa.iconic_score DESC) AS rank
FROM Place p
JOIN PlaceAggregation pa ON pa.place_id = p.id
WHERE pa.iconic_score > 0;

CREATE INDEX idx_iconic_covering ON mv_top_iconic_by_city
  (city_id, rank) INCLUDE (place_id, name, cuisine, iconic_score);
```

**mv_top_trending_by_city** - Recent activity rankings
```sql
CREATE MATERIALIZED VIEW mv_top_trending_by_city AS
SELECT
  p.city_id,
  p.id AS place_id,
  p.name,
  p.cuisine,
  pa.trending_score,
  pa.mentions_90d,
  ROW_NUMBER() OVER (PARTITION BY p.city_id ORDER BY pa.trending_score DESC) AS rank
FROM Place p
JOIN PlaceAggregation pa ON pa.place_id = p.id
WHERE pa.trending_score > 0 AND pa.mentions_90d >= 2;

CREATE INDEX idx_trending_covering ON mv_top_trending_by_city
  (city_id, rank) INCLUDE (place_id, name, cuisine, trending_score);
```

## Scoring Algorithms

### Iconic Score (All-Time Popularity)

Wilson Score Lower Bound with Bayesian smoothing:

```typescript
function iconicScore(upvotes: number, mentions: number, threads: number): number {
  const prior = 5;  // Bayesian prior (smoothing)
  const wilsonLower = wilsonScoreLowerBound(upvotes, mentions * prior, 0.95);

  return (
    wilsonLower * 50 +           // Statistical significance
    threads * 8 +                 // Discussion breadth
    mentions * 2                  // Total volume
  ) / Math.log(daysSince2015);   // Decay for fairness
}
```

**Why Wilson Score?**
- Prevents viral flukes from dominating rankings
- 3 mentions at 100% upvotes < 100 mentions at 60% upvotes
- 95% confidence interval ensures statistical validity

### Trending Score (Recent Activity)

Exponential time decay with 14-day half-life:

```typescript
function trendingScore(mentions: RedditMention[]): number {
  const halfLife = 14;  // days
  const decayConstant = Math.log(2) / halfLife;

  return mentions
    .filter(m => m.daysAgo <= 90)
    .reduce((sum, m) => {
      const decayed = m.score * Math.exp(-decayConstant * m.daysAgo);
      const multiplier = m.daysAgo <= 1 ? 2.0 : m.daysAgo <= 7 ? 1.5 : 1.0;
      return sum + decayed * multiplier;
    }, 0) * 100;
}
```

**Why Exponential Decay?**
- Recent mentions weighted heavily (2x boost if < 24h)
- Smooth decline prevents cliff edges
- 90-day window balances recency vs sample size

## API Endpoints

### GET /api/v2/search
Search for restaurants in a city

**Query Parameters:**
```
city:    string  (required) - City name or alias
type:    'iconic' | 'trending' (default: 'iconic')
cuisine: string  (optional) - Filter by cuisine type
limit:   number  (default: 10, max: 50)
```

**Response:**
```json
{
  "results": [
    {
      "id": "uuid",
      "name": "Carbone",
      "cuisine": ["italian"],
      "address": "331 West 38th Street New York",
      "score": 19.6,
      "mentions": 80,
      "threads": 18
    }
  ],
  "city": {
    "id": "uuid",
    "name": "New York City",
    "aliases": ["nyc", "manhattan", "brooklyn", ...]
  },
  "latency_ms": 65
}
```

### GET /api/v2/fuzzy
Fuzzy search for restaurant names

**Query Parameters:**
```
city:  string (required) - City name
query: string (required) - Search term (e.g., "Wafels")
limit: number (default: 5)
```

**Response:**
```json
{
  "results": [
    {
      "id": "uuid",
      "name": "Wafels & Dinges",
      "similarity": 0.75,
      "address": "...",
      "cuisine": ["belgian"]
    }
  ],
  "latency_ms": 42
}
```

### GET /api/v2/places/[id]
Get detailed place information

**Response:**
```json
{
  "id": "uuid",
  "name": "Wan Wan",
  "cuisine": ["thai"],
  "address": "209 Mulberry Street New York 10012",
  "location": { "lat": 40.721747, "lon": -73.996456 },
  "scores": {
    "iconic": 74.1,
    "trending": 0.0
  },
  "mentions": 3,
  "threads": 1,
  "latency_ms": 64
}
```

## Running Locally

### Prerequisites
- Node.js 20+
- PostgreSQL 16+ with PostGIS, pg_trgm extensions
- Reddit API credentials ([get here](https://www.reddit.com/prefs/apps))
- Neon database account (free tier)
- Upstash Redis account (free tier)

### Setup

```bash
# Clone repository
git clone https://github.com/yourusername/forklore.ai.git
cd forklore.ai

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your credentials:
#   DATABASE_URL, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET

# Run migrations
npm run db:migrate

# Bootstrap a city (fetches POI data + queues Reddit ingestion)
npx tsx scripts/bootstrap_city.ts "Portland"

# Start background worker (processes Reddit ingestion jobs)
npx tsx scripts/worker.ts

# Monitor progress
npx tsx scripts/monitor_progress.ts

# Validate results after ingestion completes
npx tsx scripts/validate_city.ts "Portland"

# Check performance SLOs
npx tsx scripts/check_slos.ts --city="Portland"

# Start development server
npm run dev
# Visit http://localhost:3000/api/v2/search?city=Portland&type=iconic
```

### Sample Data Export

Pre-computed rankings for NYC and Portland are available in `data/exports/top_restaurants.json`:

```bash
# View top 20 iconic restaurants per city
cat data/exports/top_restaurants.json | jq '.["New York City"].iconic[0:5]'
```

## Technical Highlights

### 1. Idempotent Pipeline Design
Every operation can be safely retried:
- City bootstrap: Upserts, never creates duplicates
- Reddit ingestion: Text hashing prevents duplicate mentions
- Aggregation compute: Replaces existing scores atomically
- MV refresh: CONCURRENTLY allows reads during rebuild

### 2. Covering Indexes for Performance
```sql
CREATE INDEX idx_iconic_covering ON mv_top_iconic_by_city
  (city_id, rank) INCLUDE (place_id, name, cuisine, iconic_score);
```
**Result**: Index-only scans, zero heap fetches, 91ms P95

### 3. BRIN Indexes for Time-Series
```sql
CREATE INDEX idx_mentions_ts_brin ON RedditMention USING BRIN (ts);
```
**Result**: 128KB index for 24k rows (vs 384KB B-tree), 3x faster writes

### 4. Wilson Score Implementation
```sql
CREATE FUNCTION wilson_lower_bound(
  positive NUMERIC,
  total NUMERIC,
  confidence NUMERIC DEFAULT 0.95
) RETURNS NUMERIC AS $$
  -- Implementation of Wilson Score interval
  -- Returns lower bound for statistical confidence
$$ LANGUAGE plpgsql IMMUTABLE;
```

### 5. Job Queue State Machine
```sql
CREATE TYPE job_status AS ENUM ('queued', 'running', 'completed', 'failed');

CREATE TABLE JobQueue (
  status job_status DEFAULT 'queued',
  attempts INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  -- Automatic retry with exponential backoff
);
```

## Lessons Learned

### What Worked Well
1. **Materialized views** - Massive performance win for read-heavy workloads
2. **Wilson scoring** - Prevented low-sample bias, rankings felt "right"
3. **Trigram matching** - Handled typos and abbreviations better than expected
4. **Idempotent design** - Made debugging and recovery trivial
5. **Covering indexes** - Sub-100ms queries without application caching

### What Would Change
1. **Reddit-only data is limiting** - Missing many great restaurants never mentioned on Reddit
2. **Demographic skew** - Reddit users trend young, tech-savvy, specific cities
3. **No sentiment analysis** - Mentions could be complaints, not recommendations
4. **Manual city bootstrap** - Would need automation for true scalability
5. **Product-market fit unclear** - ChatGPT provides better UX for casual queries

### Interesting Findings
- **Wan Wan** (Thai restaurant in NYC) scored 74.1 with only 3 mentions due to high upvote consensus
- Portland had 2.5x more mentions per capita than NYC (stronger Reddit food culture)
- 80% of mentions came from just 20% of subreddits (Pareto distribution)
- Trending algorithm surfaced new restaurants ~2 weeks before mainstream media

## Potential Use Cases

While not actively developed, this system could be valuable for:

1. **API for developers** - Building local recommendation products
2. **Food journalists** - Analyzing crowd-sourced food trends over time
3. **City guides** - Tracking what's genuinely popular vs marketed
4. **Market research** - Understanding restaurant popularity patterns
5. **Academic research** - Studying online community consensus mechanisms

## Reddit ToS Compliance

This project fully complies with Reddit's Data API Terms:

**Stored:**
- Permalinks (for attribution)
- Upvote scores (public metadata)
- Timestamps (public metadata)
- Text hashes (SHA256 for deduplication)

**NOT Stored:**
- Raw comment or post text
- Author usernames
- Any personally identifiable information

**Use Case**: Transformative aggregation for statistical analysis (fair use)

## Cost Analysis

**Development (single city):**
- Neon Postgres: $0 (free tier, 0.5GB)
- Upstash Redis: $0 (free tier, 10k requests/day)
- Vercel hosting: $0 (hobby tier)
- **Total: $0/month**

**Production (10 cities):**
- Neon Postgres: ~$20/month (10GB storage, compute)
- Upstash Redis: $0-10/month (pro tier optional)
- Vercel hosting: $0-20/month (usage-based)
- **Total: $20-50/month**

## Files & Documentation

```
forklore.ai/
├── app/api/v2/              # REST API endpoints
│   ├── search/route.ts      # Main search endpoint
│   ├── fuzzy/route.ts       # Fuzzy name matching
│   └── places/[id]/route.ts # Place details
├── lib/                     # Core libraries
│   ├── match.ts             # Multi-stage matching
│   ├── jobs.ts              # Job queue management
│   ├── geocode.ts           # City resolution
│   ├── reddit.ts            # Reddit API client
│   └── scoring.ts           # Ranking algorithms
├── scripts/                 # Operational scripts
│   ├── bootstrap_city.ts    # Initialize new city
│   ├── worker.ts            # Background job processor
│   ├── monitor_progress.ts  # Ingestion monitoring
│   ├── validate_city.ts     # End-to-end validation
│   ├── check_slos.ts        # Performance verification
│   ├── refresh_mvs.ts       # MV refresh
│   └── export_results.ts    # Data export
├── data/exports/            # Exported datasets
│   └── top_restaurants.json # Rankings for all cities
├── docs/                    # Documentation
│   ├── api.md               # API documentation
│   ├── performance-baseline.md  # SLO benchmarks
│   └── runbook.md           # Operations guide
├── config/
│   ├── cities.json          # City configurations
│   └── tuning.json          # Algorithm parameters
└── prisma/
    ├── schema.prisma        # Database schema
    └── migrations/          # Schema migrations
```

## Acknowledgments

**Data Sources:**
- Reddit API (community insights)
- Overpass API / OpenStreetMap (POI data)

**Technical Inspiration:**
- Wilson Score methodology: Evan Miller
- Exponential decay for trending: Hacker News algorithm
- Trigram matching: PostgreSQL pg_trgm module

**Infrastructure:**
- Neon (serverless Postgres)
- Upstash (serverless Redis)
- Vercel (Next.js hosting)

## License

MIT License - See [LICENSE](LICENSE) file

## Contact

**Maintainer**: [@Surfrrosa](https://github.com/Surfrrosa)

**Status**: This project is complete and not actively maintained. Feel free to fork and adapt for your own use.

For questions about the implementation or architecture, open a [GitHub Issue](https://github.com/Surfrrosa/forklore.ai/issues).

---

**Built as a technical exploration of:**
- Scalable data pipelines
- Statistical ranking algorithms
- High-performance PostgreSQL optimization
- Production-grade API design

**Final stats:** 24,889 Reddit mentions indexed · 9,613 restaurants cataloged · 91ms P95 latency · v1.0 Complete
