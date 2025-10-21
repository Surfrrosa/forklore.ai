# Shutdown Guide - Zero Cost Archival

This guide explains how to shut down all paid services and archive this project at **$0/month** while keeping it fully functional for local demonstration.

## Current Monthly Costs

**Active Services:**
- Neon Postgres: $0-20/month (depends on usage)
- Upstash Redis: $0/month (free tier)
- Google Places API: $0 (pay-per-use, no ongoing cost)
- Reddit API: $0 (free)

**Target:** $0/month (all services stopped or on free tier)

## Shutdown Checklist

### Step 1: Export All Data (5 minutes)

Before shutting down, export your data for local use:

```bash
# Export top restaurants (already done)
npx dotenv -e .env.local -- npx tsx scripts/export_results.ts

# Export database schema
npx dotenv -e .env.local -- npx tsx -e "
import { execSync } from 'child_process';
const dbUrl = process.env.DATABASE_URL;
execSync(\`pg_dump '\${dbUrl}' --schema-only > data/exports/schema.sql\`);
console.log('Schema exported to data/exports/schema.sql');
"

# Export sample data (top 100 places per city)
npx dotenv -e .env.local -- npx tsx -e "
import prisma from './lib/prisma.js';
import fs from 'fs';

const cities = await prisma.city.findMany({ where: { ranked: true } });
const data = {};

for (const city of cities) {
  const places = await prisma.place.findMany({
    where: { city_id: city.id },
    include: { aggregations: true },
    take: 100,
    orderBy: { aggregations: { iconic_score: 'desc' } }
  });
  data[city.name] = places;
}

fs.writeFileSync('data/exports/sample_data.json', JSON.stringify(data, null, 2));
console.log('Sample data exported');
await prisma.\$disconnect();
"
```

### Step 2: Kill Running Processes (1 minute)

```bash
# Find and kill any running workers
ps aux | grep "scripts/worker.ts" | grep -v grep | awk '{print $2}' | xargs kill

# Verify no processes running
ps aux | grep forklore
```

### Step 3: Pause/Delete Neon Database (2 minutes)

**Option A: Pause (keeps data, $0/month when inactive)**
1. Go to [Neon Console](https://console.neon.tech)
2. Select your project
3. Click "Settings" → "Compute" → "Suspend compute after 5 minutes of inactivity"
4. Database will auto-pause when not in use (free tier = $0/month)

**Option B: Export and Delete (permanent shutdown)**
```bash
# Full database dump
npx dotenv -e .env.local -- bash -c "pg_dump '$DATABASE_URL' > data/exports/full_database_dump.sql"

# Delete project in Neon Console
# Cost: $0/month
```

### Step 4: Clear API Credentials (1 minute)

Remove credentials from `.env.local` to prevent accidental charges:

```bash
# Create a template without credentials
cp .env.local .env.local.backup

# Clear sensitive values
cat > .env.local.template << 'EOF'
# Database (Neon Postgres)
DATABASE_URL=postgresql://username:password@host/database

# Reddit API
REDDIT_CLIENT_ID=your_client_id_here
REDDIT_CLIENT_SECRET=your_client_secret_here
REDDIT_USER_AGENT=forklore.ai/1.0.0

# Upstash Redis (rate limiting)
UPSTASH_REDIS_REST_URL=your_redis_url_here
UPSTASH_REDIS_REST_TOKEN=your_redis_token_here

# Google Places API (optional)
GOOGLE_PLACES_API_KEY=your_google_api_key_here
EOF

# Keep .env.local out of git
echo ".env.local" >> .gitignore
echo ".env.local.backup" >> .gitignore
```

### Step 5: Document Final State (2 minutes)

Create a snapshot file showing what was achieved:

```bash
cat > FINAL_STATE.md << 'EOF'
# Forklore.ai - Final State (v1.0)

## Date Completed
$(date +"%Y-%m-%d")

## Final Metrics
- Cities indexed: 3 (NYC, Portland, San Francisco)
- Total mentions: 24,889
- Total places: 9,613
- Performance: P95 latency 91ms

## Data Exports
- \`data/exports/top_restaurants.json\` - Top 20 per city
- \`data/exports/schema.sql\` - Full database schema
- \`data/exports/sample_data.json\` - Top 100 places per city

## Services Shut Down
- [x] Neon database (paused/deleted)
- [x] Background workers (killed)
- [x] API credentials (removed from .env.local)

## To Restart
1. Create new Neon database
2. Run \`psql $DATABASE_URL < data/exports/schema.sql\`
3. Add credentials to .env.local
4. Run \`npm install && npm run dev\`
EOF
```

### Step 6: Verify Zero Cost (1 minute)

Check all services are stopped:

```bash
# Check Neon
echo "Neon: Visit https://console.neon.tech and verify project is paused or deleted"

# Check Upstash (free tier = $0)
echo "Upstash: Free tier has no charges, safe to leave active"

# Check Google Cloud
echo "Google Places API: Visit https://console.cloud.google.com/apis/dashboard"
echo "Verify no recent usage (should be $0 if project not deployed)"

# Check Reddit API
echo "Reddit API: Free tier, no charges"
```

## Restart Instructions

To run the project locally later:

### Quick Start (using exported data)
```bash
# No database needed - just view exports
cat data/exports/top_restaurants.json | jq '.["New York City"].iconic[0:10]'
```

### Full Restart (with database)
```bash
# 1. Create new Neon database (free tier)
#    https://console.neon.tech

# 2. Restore schema
psql "$NEW_DATABASE_URL" < data/exports/schema.sql

# 3. Update .env.local with new DATABASE_URL

# 4. Optional: Re-run city bootstrap
npx tsx scripts/bootstrap_city.ts "Portland"
npx tsx scripts/worker.ts  # Start background worker

# 5. Start dev server
npm run dev
```

## Archive Checklist

Before pushing to GitHub:

- [ ] Data exported (`data/exports/`)
- [ ] Credentials removed from `.env.local`
- [ ] `.env.local` added to `.gitignore`
- [ ] Background workers killed
- [ ] Neon database paused or deleted
- [ ] README.md updated with v1.0 status
- [ ] FINAL_STATE.md created
- [ ] Git commit with message "v1.0 Complete - Archive"

## What to Keep Active (Free Tier)

Safe to leave these running at $0/month:

- **GitHub repo** - Free for public repos
- **Upstash Redis** - Free tier (10k req/day)
- **Reddit API credentials** - Free tier

## Cost Summary

**Before shutdown:** $0-20/month (Neon usage)
**After shutdown:** $0/month (all services paused/deleted)
**Storage:** ~50MB of exported JSON data

---

**Status:** This project can be archived at zero cost while maintaining full functionality for local demonstration and portfolio use.
