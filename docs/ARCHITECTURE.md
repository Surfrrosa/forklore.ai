# Architecture

Production architecture documentation.

**Status**: To be written (Phase 5)

## Overview

Forklore.ai is a global restaurant discovery platform powered by Reddit community insights.

## System Components

- **Database**: PostgreSQL (Neon) with PostGIS
- **API**: Next.js App Router (serverless)
- **Cache**: Upstash Redis
- **Data Sources**: Overture Maps, Overpass API (OSM), Reddit API

## Key Design Decisions

See `IMPLEMENTATION_NOTES.md` for detailed architecture decisions.
