# Forklore.ai Production Build - Project Plan

**Estimated Time**: 3-5 days focused work
**Status**: Starting fresh (clean slate)

## Overview

Building a production-grade system where users can search **any city globally** for Reddit-ranked restaurants.

## Implementation Phases

### Phase 1: Core Database & Infrastructure (Day 1)
**Goal**: Production database schema with scoring functions

- [x] Create clean migrations directory (`prisma/migrations_v2/`)
- [x] Migration 001: Core schema (City, Place, RedditMention, etc.)
- [x] Migration 002: Materialized views with covering indexes
- [x] Migration 003: Scoring functions (Wilson + exponential decay)
- [ ] Migration 004: Seed NYC data (validate schema works)
- [ ] Create tuning config (`config/tuning.json`)
- [ ] Create city manifest (`config/cities.json`)

**Deliverables**:
- Production schema deployed to Neon
- Scoring functions validated with test data
- NYC working as proof-of-concept

---

### Phase 2: Matching & Bootstrap (Day 2)
**Goal**: Multi-stage matching + on-demand city bootstrap

- [ ] `lib/match.ts` - Multi-stage matching algorithm
- [ ] `lib/geocode.ts` - City name → lat/lon resolution
- [ ] `lib/overpass.ts` - Overpass API integration
- [ ] `scripts/bootstrap_city.ts` - On-demand city bootstrap job
- [ ] Unit tests for matching (precision/recall)

**Deliverables**:
- Can bootstrap any city from Overpass
- Matching handles typos, aliases, geo ambiguity
- Test suite validates precision

---

### Phase 3: Job Queue & ETL (Day 3)
**Goal**: Async job system for Reddit ingestion

- [ ] `lib/jobs.ts` - Job queue management
- [ ] `scripts/reddit_ingest.ts` - Reddit API integration (ToS compliant)
- [ ] `scripts/compute_aggregations.sql` - Batch scoring
- [ ] `scripts/refresh_mvs.sql` - MV refresh job
- [ ] Job retry logic with backoff

**Deliverables**:
- Job queue working end-to-end
- Reddit ingestion respects rate limits
- Aggregations computed correctly

---

### Phase 4: API Implementation (Day 4)
**Goal**: Production API with proper contracts

- [ ] `app/api/v2/search/route.ts` - Main search endpoint
- [ ] `app/api/v2/fuzzy/route.ts` - Autocomplete
- [ ] `app/api/v2/place/[id]/route.ts` - Place details
- [ ] `app/api/v2/cities/route.ts` - Available cities
- [ ] Proper response contracts (ranked, rank_source, cache, etc.)
- [ ] ETag generation from MV versions
- [ ] Rate limiting with Upstash
- [ ] Integration tests

**Deliverables**:
- All endpoints meet spec
- p95 latency < 100ms
- Proper caching headers

---

### Phase 5: Observability & Docs (Day 5)
**Goal**: Monitoring, runbooks, launch-ready

- [ ] `lib/observability.ts` - Logging + metrics
- [ ] `docs/ARCHITECTURE.md` - System design docs
- [ ] `docs/RUNBOOKS.md` - Operational procedures
- [ ] `docs/SLOs.md` - SLO definitions + measurement
- [ ] `docs/SECURITY_COMPLIANCE.md` - Reddit ToS + security
- [ ] Dashboard setup (Grafana/Logtail)
- [ ] Alert configuration

**Deliverables**:
- Complete documentation
- Observable system
- Ready for production deployment

---

## Current Progress

**Completed**:
- [x] Implementation plan documented
- [x] Migration 001: Core schema
- [x] Migration 002: Materialized views
- [x] Migration 003: Scoring functions
- [x] Tuning config created

**Next Steps** (immediate):
1. Clean up old code (archive to `_old/` directory)
2. Run new migrations on fresh database
3. Seed NYC test data
4. Validate scoring functions work correctly

## Decision Log

### Why Clean Slate?

**Problem**: Original prototype was NYC-only, lacked global support, had architectural debt.

**Decision**: Start fresh following production spec rather than retrofit.

**Rationale**:
- Faster to build correctly than fix wrong architecture
- Cleaner code, better maintainability
- Avoids technical debt from day 1

### Why Overpass for Bootstrap?

**Alternatives Considered**:
- Google Places API (costs money, rate limits)
- Foursquare API (deprecated)
- Manual city addition (doesn't scale)

**Decision**: Overpass API (OpenStreetMap)

**Rationale**:
- Free, global coverage
- Decent POI quality
- Can upgrade to Overture Maps data later for preloaded cities

### Why Hybrid Preload + Bootstrap?

**Alternatives Considered**:
- Preload everything (infeasible - too much data)
- Pure on-demand (slow, no Reddit data initially)

**Decision**: Hybrid approach

**Rationale**:
- Best user experience (instant results for any city)
- Resource efficient (only preload popular cities)
- Graceful degradation (unranked → ranked over time)

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Overpass API rate limits | High | Cache results, implement backoff |
| Reddit API suspension | High | Strict ToS compliance, monitor usage |
| Database costs exceed budget | Medium | Optimize queries, use free tier efficiently |
| Bootstrap job failures | Medium | Retry logic, queue monitoring |
| Slow bootstrap (>3s) | Low | Optimize Overpass query, add timeout |

## Success Criteria

**Must Have** (MVP):
- [ ] Search any city globally (bootstrapped or preloaded)
- [ ] Sub-100ms p95 latency for search
- [ ] Reddit ToS compliant
- [ ] <$100/mo at 10 cities

**Nice to Have** (Post-MVP):
- [ ] Mobile-optimized UI
- [ ] User favorites/lists
- [ ] Email notifications for trending places
- [ ] Multi-language support

## Timeline

**Week 1** (Current):
- Days 1-2: Core infrastructure
- Days 3-4: Matching + Jobs
- Day 5: API implementation

**Week 2** (Next):
- Days 1-2: Observability + docs
- Days 3-4: Testing + QA
- Day 5: Production deployment

**Week 3** (Future):
- Polish + bug fixes
- Add more preloaded cities
- Frontend development

## Questions for User

1. **Priority**: Should we focus on making NYC perfect first, or get global coverage working quickly?
2. **Data Quality**: OK to show unranked results immediately, or require Reddit data before showing a city?
3. **Budget**: Willing to upgrade from free tiers if needed for performance?
4. **Timeline**: Is 2 weeks to production realistic, or need it faster/slower?

---

**Last Updated**: 2025-10-18
**Next Review**: After Phase 1 completion
