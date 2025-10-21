# Operations Runbook

Version: 1.0
Last Updated: 2025-10-19

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Common Issues](#common-issues)
3. [Emergency Procedures](#emergency-procedures)
4. [Routine Maintenance](#routine-maintenance)
5. [Monitoring & Alerts](#monitoring--alerts)
6. [Escalation](#escalation)

---

## Quick Reference

### Monitoring Commands

```bash
# System health check
curl https://forklore.ai/api/health | jq

# SLO validation
npx tsx scripts/check_slos.ts --city=Portland

# Job queue status
npx tsx scripts/monitor_progress.ts

# End-to-end validation
npx tsx scripts/validate_city.ts Portland
```

### Emergency Contacts

- Primary: ops@forklore.ai
- Database: Supabase/AWS support
- Hosting: Vercel support

---

## Common Issues

### Issue 1: Stale Materialized Views

**Symptoms:**
- `/api/health` shows MV age >24h
- Users report outdated rankings
- `last_refreshed_at` timestamp is old

**Severity:** Medium
**Impact:** Rankings become inaccurate over time

**Diagnosis:**

```bash
# Check MV freshness
npx tsx scripts/check_slos.ts --city=Portland

# Check job queue
npx dotenv -e .env.local -- npx tsx -e "
import prisma from './lib/prisma.js';
(async () => {
  const jobs = await prisma.\$queryRaw\`
    SELECT type, status, error
    FROM \"JobQueue\"
    WHERE type = 'refresh_mvs'
      AND status != 'completed'
    ORDER BY created_at DESC LIMIT 5
  \`;
  console.log(jobs);
  await prisma.\$disconnect();
})();"
```

**Resolution:**

1. Check if worker is running:
```bash
ps aux | grep "scripts/worker.ts"
```

2. If not running, start worker:
```bash
npx dotenv -e .env.local -- npx tsx scripts/worker.ts 2>&1 &
```

3. If worker is stuck, manually refresh MVs:
```bash
# For specific city
npx dotenv -e .env.local -- npx tsx scripts/refresh_mvs.ts <city_id>

# For all cities
npx dotenv -e .env.local -- npx tsx -e "
import prisma from './lib/prisma.js';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

(async () => {
  const cities = await prisma.\$queryRaw\`SELECT id FROM \"City\" WHERE ranked = true\`;
  for (const city of cities) {
    console.log(\`Refreshing MVs for \${city.id}...\`);
    await execAsync(\`npx dotenv -e .env.local -- npx tsx scripts/refresh_mvs.ts \${city.id}\`);
  }
  await prisma.\$disconnect();
})();"
```

4. Verify refresh completed:
```bash
npx tsx scripts/check_slos.ts --city=Portland
```

**Prevention:**
- Ensure worker runs as systemd service or supervisor process
- Set up alerting for MV age >12h
- Monitor job queue for backlog

---

### Issue 2: High API Latency (P95 >200ms)

**Symptoms:**
- API responses slow (>200ms)
- Users report sluggish search
- SLO checker fails latency tests

**Severity:** High
**Impact:** Poor user experience

**Diagnosis:**

```bash
# Check query performance
npx tsx scripts/check_slos.ts --city=Portland

# Check database query plan
npx dotenv -e .env.local -- npx tsx -e "
import prisma from './lib/prisma.js';
(async () => {
  const plan = await prisma.\$queryRaw\`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT * FROM mv_top_iconic_by_city
    WHERE city_id = 'af20eccd-4b77-4072-ac23-21d179f4b37e'
    ORDER BY rank LIMIT 50
  \`;
  plan.forEach(row => console.log(row['QUERY PLAN']));
  await prisma.\$disconnect();
})();"
```

**Common Causes:**

**A. Cold queries (first request after restart)**
- Resolution: Warm up cache with test queries
- Prevention: Health check endpoint keeps connections warm

**B. Missing or unused indexes**
- Resolution: Verify covering indexes exist:
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename LIKE 'mv_top_%'
ORDER BY indexname;
```

- If missing, recreate:
```bash
npx dotenv -e .env.local -- npx tsx scripts/apply_covering_indexes.ts
```

**C. Sequential scan instead of index scan**
- Resolution: Run ANALYZE:
```sql
ANALYZE mv_top_iconic_by_city;
ANALYZE mv_top_trending_by_city;
```

**D. Database connection pool exhausted**
- Check active connections:
```sql
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
```
- Resolution: Restart application or increase pool size

**E. Large dataset (>10K places per MV)**
- Resolution: Add pagination, reduce limit
- Long-term: Implement partitioning

**Prevention:**
- Monitor P95 latency continuously
- Alert on >150ms for 5 minutes
- Regular ANALYZE on materialized views

---

### Issue 3: Job Queue Backlog

**Symptoms:**
- Jobs stuck in `queued` status
- `monitor_progress.ts` shows growing queue
- Worker not processing jobs

**Severity:** High
**Impact:** New data not ingested, MVs not refreshed

**Diagnosis:**

```bash
# Check job queue status
npx tsx scripts/monitor_progress.ts

# Check for failed jobs
npx dotenv -e .env.local -- npx tsx -e "
import prisma from './lib/prisma.js';
(async () => {
  const failed = await prisma.\$queryRaw\`
    SELECT id, type, error, attempts, created_at
    FROM \"JobQueue\"
    WHERE status IN ('failed', 'error')
    ORDER BY created_at DESC LIMIT 10
  \`;
  console.log(failed);
  await prisma.\$disconnect();
})();"
```

**Resolution:**

1. Check if worker is running:
```bash
ps aux | grep worker
```

2. If not running, start worker:
```bash
npx dotenv -e .env.local -- npx tsx scripts/worker.ts 2>&1 > worker.log &
```

3. If worker crashes repeatedly, check logs:
```bash
tail -f worker.log
```

4. Clear failed jobs (after investigating):
```bash
npx dotenv -e .env.local -- npx tsx -e "
import prisma from './lib/prisma.js';
(async () => {
  await prisma.\$queryRaw\`
    DELETE FROM \"JobQueue\"
    WHERE status = 'failed'
      AND created_at < NOW() - INTERVAL '7 days'
  \`;
  await prisma.\$disconnect();
})();"
```

**Prevention:**
- Run worker as managed process (systemd, supervisor, pm2)
- Set up alerting for failed jobs >10
- Implement retry limits to prevent infinite loops

---

### Issue 4: Reddit Ingestion Failure

**Symptoms:**
- `ingest_reddit` job fails repeatedly
- Low mention count for new city
- Error logs show API failures

**Severity:** Medium
**Impact:** Incomplete data for city

**Diagnosis:**

```bash
# Check recent ingest jobs
npx dotenv -e .env.local -- npx tsx -e "
import prisma from './lib/prisma.js';
(async () => {
  const jobs = await prisma.\$queryRaw\`
    SELECT id, type, payload, error, attempts
    FROM \"JobQueue\"
    WHERE type = 'ingest_reddit'
      AND status IN ('failed', 'error')
    ORDER BY created_at DESC LIMIT 5
  \`;
  console.log(JSON.stringify(jobs, null, 2));
  await prisma.\$disconnect();
})();"
```

**Common Causes:**

**A. Reddit API rate limiting**
- Error: "429 Too Many Requests"
- Resolution: Wait for rate limit reset (60 seconds)
- Prevention: Implement exponential backoff (already in code)

**B. Invalid subreddit name**
- Error: "Subreddit not found"
- Resolution: Verify subreddit exists and is public
- Fix subreddit mapping in city config

**C. Network connectivity**
- Error: "ECONNREFUSED" or timeout
- Resolution: Check network, retry job manually

**D. Pushshift API unavailable**
- Error: "503 Service Unavailable"
- Resolution: Wait for service recovery
- Alternative: Use Reddit API directly (slower)

**Manual Retry:**

```bash
# Retry specific city ingestion
npx dotenv -e .env.local -- npx tsx scripts/bootstrap_city.ts "New York City"
```

**Prevention:**
- Monitor Reddit API health
- Implement fallback to Reddit API if Pushshift fails
- Alert on failed ingest jobs

---

### Issue 5: Database Connection Errors

**Symptoms:**
- API returns 500 errors
- Logs show "too many connections"
- "Connection timeout" errors

**Severity:** Critical
**Impact:** Complete API outage

**Diagnosis:**

```sql
-- Check active connections
SELECT count(*), state
FROM pg_stat_activity
GROUP BY state;

-- Check long-running queries
SELECT pid, now() - query_start as duration, query
FROM pg_stat_activity
WHERE state = 'active'
  AND now() - query_start > interval '1 minute'
ORDER BY duration DESC;
```

**Resolution:**

1. Kill long-running queries:
```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE pid = <problem_pid>;
```

2. Restart application:
```bash
# Vercel deployment
vercel redeploy

# Local development
# Ctrl+C and restart
npm run dev
```

3. Increase connection pool (if needed):
```typescript
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  connectionLimit = 20  // Increase from default 10
}
```

**Prevention:**
- Use connection pooling (PgBouncer)
- Set connection timeouts
- Monitor connection usage

---

### Issue 6: City Alias Not Working

**Symptoms:**
- `/search?city=nyc` returns "City not found"
- Alias exists in database but not resolving

**Severity:** Low
**Impact:** Poor user experience, users must use full city names

**Diagnosis:**

```bash
# Check if alias exists
npx dotenv -e .env.local -- npx tsx -e "
import prisma from './lib/prisma.js';
(async () => {
  const alias = await prisma.\$queryRaw\`
    SELECT ca.alias, c.name
    FROM \"CityAlias\" ca
    JOIN \"City\" c ON c.id = ca.city_id
    WHERE LOWER(ca.alias) = LOWER('nyc')
  \`;
  console.log(alias);
  await prisma.\$disconnect();
})();"
```

**Resolution:**

1. Add missing alias:
```bash
# Run alias script
npx dotenv -e .env.local -- npx tsx scripts/add_city_aliases.ts
```

2. Manually add specific alias:
```bash
npx dotenv -e .env.local -- npx tsx -e "
import prisma from './lib/prisma.js';
(async () => {
  const city = await prisma.\$queryRaw\`SELECT id FROM \"City\" WHERE name = 'New York City' LIMIT 1\`;
  if (city.length > 0) {
    await prisma.\$queryRaw\`
      INSERT INTO \"CityAlias\" (city_id, alias)
      VALUES (\${city[0].id}, 'nyc')
      ON CONFLICT (city_id, alias) DO NOTHING
    \`;
  }
  await prisma.\$disconnect();
})();"
```

**Prevention:**
- Run `add_city_aliases.ts` after bootstrapping new cities
- Document all expected aliases in `scripts/add_city_aliases.ts`

---

## Emergency Procedures

### Total API Outage

**Immediate Actions:**

1. Check health endpoint:
```bash
curl https://forklore.ai/api/health
```

2. Check database connectivity:
```bash
npx dotenv -e .env.local -- npx tsx -e "
import prisma from './lib/prisma.js';
(async () => {
  await prisma.\$queryRaw\`SELECT 1\`;
  console.log('Database connected');
  await prisma.\$disconnect();
})();"
```

3. Check Vercel deployment status:
```bash
vercel list
vercel logs <deployment-url>
```

4. If database is down, contact provider immediately

5. If application is down, redeploy:
```bash
vercel redeploy --prod
```

### Data Corruption

**Symptoms:**
- MVs showing incorrect data
- Scores are negative or > 100
- Duplicate places in results

**Immediate Actions:**

1. Stop worker to prevent further damage:
```bash
pkill -f "scripts/worker.ts"
```

2. Identify affected MVs:
```sql
SELECT * FROM mv_top_iconic_by_city
WHERE iconic_score < 0 OR iconic_score > 100
LIMIT 10;
```

3. Take database snapshot:
```bash
# Supabase: Use dashboard to create snapshot
# AWS RDS: Use console to create snapshot
```

4. Recompute aggregations for affected city:
```bash
npx dotenv -e .env.local -- npx tsx scripts/compute_aggregations.ts <city_id>
```

5. Refresh MVs:
```bash
npx dotenv -e .env.local -- npx tsx scripts/refresh_mvs.ts <city_id>
```

6. Validate results:
```bash
npx tsx scripts/validate_city.ts <city_name>
```

### Database Disk Full

**Symptoms:**
- "No space left on device" errors
- Write operations fail
- Application crashes

**Immediate Actions:**

1. Check disk usage:
```sql
SELECT pg_size_pretty(pg_database_size('postgres'));
```

2. Find largest tables:
```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
```

3. Delete old failed jobs:
```sql
DELETE FROM "JobQueue"
WHERE status = 'failed'
  AND created_at < NOW() - INTERVAL '30 days';
```

4. Vacuum database:
```sql
VACUUM FULL;
```

5. Contact provider to increase storage

---

## Routine Maintenance

### Daily Tasks

**Morning Check (automated via cron):**

```bash
#!/bin/bash
# /etc/cron.daily/forklore-health-check

npx tsx scripts/check_slos.ts --city=Portland > /var/log/forklore/slo-check.log 2>&1

if [ $? -ne 0 ]; then
  echo "SLO check failed" | mail -s "Forklore SLO Alert" ops@forklore.ai
fi
```

**Manual Review:**
- Check `/api/health` endpoint
- Review error rate in logs
- Verify all ranked cities have fresh MVs (<24h)

### Weekly Tasks

**Sunday Maintenance Window:**

1. Review job queue health:
```bash
npx tsx scripts/monitor_progress.ts
```

2. Clean up old jobs:
```sql
DELETE FROM "JobQueue"
WHERE status = 'completed'
  AND completed_at < NOW() - INTERVAL '7 days';
```

3. Analyze database performance:
```sql
ANALYZE;
```

4. Review slow query log:
```sql
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

5. Check for missing indexes:
```sql
SELECT schemaname, tablename, attname
FROM pg_stats
WHERE n_distinct > 100
  AND correlation < 0.1
  AND schemaname = 'public'
ORDER BY schemaname, tablename, attname;
```

### Monthly Tasks

**First Sunday of Month:**

1. Review and update city aliases
2. Review scoring parameters in `config/tuning.json`
3. Audit database size and growth
4. Update dependencies (`npm update`)
5. Review and archive logs
6. Test disaster recovery procedures
7. Review this runbook and update as needed

---

## Monitoring & Alerts

### Critical Alerts (Page Immediately)

**Trigger:** `/api/health` returns non-200 for 2+ minutes
**Action:** Check database connectivity, redeploy application

**Trigger:** P95 latency >500ms for 5+ minutes
**Action:** Check database, restart application

**Trigger:** Error rate >5% for 5+ minutes
**Action:** Check logs, identify error pattern, escalate

**Trigger:** Database CPU >90% for 5+ minutes
**Action:** Check for slow queries, kill if needed

### Warning Alerts (Review within 1 hour)

**Trigger:** MV age >12 hours
**Action:** Check worker status, manually refresh if needed

**Trigger:** Failed jobs >10 in past hour
**Action:** Review job errors, clear if duplicate

**Trigger:** P95 latency >200ms for 15+ minutes
**Action:** Run performance analysis, check query plans

**Trigger:** Rate limit hit rate >10% of requests
**Action:** Review traffic patterns, consider increasing limits

### Informational Alerts (Daily Review)

**Trigger:** New city ingestion completed
**Action:** Validate end-to-end, mark city as ranked

**Trigger:** MV refresh completed
**Action:** No action needed, logged for audit

### Monitoring Dashboards

**Recommended Metrics:**

1. **API Performance**
   - Request rate (per endpoint)
   - P50/P95/P99 latency
   - Error rate (4xx, 5xx)
   - Rate limit hit rate

2. **Database Health**
   - Active connections
   - Query latency
   - Index hit rate
   - Disk usage

3. **Data Pipeline**
   - Job queue length
   - Failed job count
   - MV age
   - Ingestion lag

4. **Business Metrics**
   - Cities ranked
   - Total places indexed
   - Total mentions
   - API usage by endpoint

---

## Escalation

### Escalation Matrix

**Level 1: On-Call Engineer**
- API latency issues
- Stale MVs
- Job queue backlog
- Minor bugs

**Level 2: Lead Engineer**
- Database connectivity issues
- Data corruption
- Persistent performance degradation
- Security incidents

**Level 3: CTO + Database Provider**
- Total outage
- Database failure
- Data loss
- Critical security breach

### Contact Information

**On-Call Rotation:**
- Primary: Check PagerDuty
- Secondary: Check PagerDuty
- Backup: ops@forklore.ai

**Vendors:**
- Database: support@supabase.com (or AWS support)
- Hosting: support@vercel.com
- CDN: support@cloudflare.com

### Incident Response Process

1. **Detection** - Alert fires or user reports issue
2. **Triage** - Assess severity (Critical/High/Medium/Low)
3. **Escalate** - Page appropriate level per matrix
4. **Mitigate** - Implement immediate fix or workaround
5. **Resolve** - Apply permanent fix
6. **Document** - Write postmortem (for Critical/High only)
7. **Review** - Update runbook with learnings

---

## Appendix: Useful SQL Queries

### Find cities with stale MVs
```sql
SELECT c.name, v.view_name, v.refreshed_at,
       EXTRACT(EPOCH FROM (NOW() - v.refreshed_at)) / 3600 as age_hours
FROM "MaterializedViewVersion" v
CROSS JOIN "City" c
WHERE v.view_name = 'mv_top_iconic_by_city'
  AND EXTRACT(EPOCH FROM (NOW() - v.refreshed_at)) / 3600 > 24;
```

### Count places per city
```sql
SELECT c.name, c.ranked, COUNT(p.id) as place_count
FROM "City" c
LEFT JOIN "Place" p ON p.city_id = c.id AND p.status = 'open'
GROUP BY c.id, c.name, c.ranked
ORDER BY place_count DESC;
```

### Find duplicate places
```sql
SELECT city_id, name_norm, COUNT(*) as count
FROM "Place"
GROUP BY city_id, name_norm
HAVING COUNT(*) > 1
ORDER BY count DESC;
```

### Check index usage
```sql
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

### Find missing indexes (seq scans)
```sql
SELECT
  schemaname,
  tablename,
  seq_scan,
  seq_tup_read,
  idx_scan,
  seq_tup_read / NULLIF(seq_scan, 0) as avg_seq_tup_per_scan
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND seq_scan > 0
ORDER BY seq_tup_read DESC;
```
