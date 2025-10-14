# ForkLore.ai 🍽️
Discover the most loved restaurants on Reddit, ranked by the crowd and refined by data.

## Overview
ForkLore.ai aggregates Reddit mentions, upvotes, and comment context to reveal where people actually eat.  
Search any city, see the most upvoted restaurants, and explore the stories behind them.

## Features
- Dynamic search by city (worldwide)
- Reddit-powered data aggregation
- Ranking by mentions, upvotes, and recency
- Minimal dark UI built with Next.js and Tailwind
- Caching with Vercel KV

## Tech Stack
Next.js · TypeScript · Tailwind CSS · Reddit API (OAuth) · Vercel

## Architecture

### Project Structure
```
forklore.ai/
├── app/              # Next.js App Router (UI & API routes)
│   ├── api/         # API endpoints (thin controllers)
│   │   └── search/  # Restaurant search endpoint
│   ├── layout.tsx   # Root layout with dark theme
│   ├── page.tsx     # Landing page
│   └── globals.css  # Global styles
├── lib/              # Business logic (service layer)
│   ├── reddit.ts    # Reddit OAuth API client
│   ├── gazetteer.ts # OSM restaurant data loader
│   ├── resolver.ts  # Name normalization & fuzzy matching
│   ├── score.ts     # Scoring algorithm implementation
│   └── cache.ts     # KV caching layer
├── types/            # TypeScript type definitions
│   └── index.ts     # Shared data models
└── .env.example      # Environment variable template
```

### Design Principles
- **Separation of Concerns**: UI, business logic, and data access are strictly separated
- **Type Safety**: Full TypeScript with strict mode enabled
- **Pure Functions**: Business logic functions are testable and predictable
- **Error Handling**: Comprehensive error handling with detailed messages
- **Caching**: Smart caching to respect API rate limits
- **Documentation**: JSDoc comments on all exported functions

## Getting Started

### Prerequisites
- Node.js 20+
- npm or yarn
- Reddit API credentials

### Installation
```bash
git clone https://github.com/surfrrosa/forklore.ai
cd forklore.ai
npm install
