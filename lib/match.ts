/**
 * Multi-stage place matching engine
 *
 * Stages (in order):
 * 1. Exact alias match (canonical name + curated aliases)
 * 2. Trigram similarity (pg_trgm, default threshold 0.55)
 * 3. Geo assist (within 2km → drop threshold to 0.50)
 * 4. Brand disambiguation (chains pick nearest; singles keep higher weight)
 * 5. Address consistency (optional tie-breaker)
 *
 * All thresholds configurable via config/tuning.json
 */

import { PrismaClient } from '@prisma/client';
import tuning from '../config/tuning.json';

const prisma = new PrismaClient();

export interface MatchCandidate {
  placeId: string;
  name: string;
  nameNorm: string;
  lat: number;
  lon: number;
  brand: string | null;
  aliases: string[];
  address: string | null;
  similarity?: number;
  distance?: number;
  stage: 'alias' | 'trigram' | 'geo_assist' | 'brand_disambig';
}

export interface MatchContext {
  cityId: string;
  mentionText: string;
  lat?: number;  // If mention has location context
  lon?: number;
  addressHint?: string;  // Extracted from mention text
}

/**
 * Normalize name for matching (lowercase, remove punctuation, collapse whitespace)
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove punctuation
    .replace(/\s+/g, ' ')       // Collapse whitespace
    .trim();
}

/**
 * Stage 1: Exact alias match
 * Check canonical name and curated aliases (case-insensitive)
 */
async function matchByAlias(
  ctx: MatchContext,
  normalized: string
): Promise<MatchCandidate | null> {
  const result = await prisma.$queryRaw<MatchCandidate[]>`
    SELECT
      id as "placeId",
      name,
      name_norm as "nameNorm",
      ST_Y(geog::geometry) as lat,
      ST_X(geog::geometry) as lon,
      brand,
      aliases,
      address,
      'alias' as stage
    FROM "Place"
    WHERE city_id = ${ctx.cityId}
      AND status = 'open'
      AND (
        name_norm = ${normalized}
        OR ${normalized} = ANY(aliases)
      )
    LIMIT 1
  `;

  return result[0] || null;
}

/**
 * Stage 2: Trigram similarity (default threshold 0.55)
 */
async function matchByTrigram(
  ctx: MatchContext,
  normalized: string,
  threshold: number
): Promise<MatchCandidate[]> {
  const results = await prisma.$queryRaw<MatchCandidate[]>`
    SELECT
      id as "placeId",
      name,
      name_norm as "nameNorm",
      ST_Y(geog::geometry) as lat,
      ST_X(geog::geometry) as lon,
      brand,
      aliases,
      address,
      similarity(name_norm, ${normalized}) as similarity,
      'trigram' as stage
    FROM "Place"
    WHERE city_id = ${ctx.cityId}
      AND status = 'open'
      AND similarity(name_norm, ${normalized}) >= ${threshold}
    ORDER BY similarity DESC
    LIMIT 10
  `;

  return results;
}

/**
 * Stage 3: Geo assist - if candidate within 2km and we have location context,
 * drop threshold to 0.50
 */
async function matchWithGeoAssist(
  ctx: MatchContext,
  normalized: string
): Promise<MatchCandidate[]> {
  if (!ctx.lat || !ctx.lon) {
    return [];
  }

  const geoThreshold = tuning.matching.trigram_threshold_with_geo_assist;
  const radiusKm = tuning.matching.geo_assist_radius_km;

  const results = await prisma.$queryRaw<MatchCandidate[]>`
    SELECT
      id as "placeId",
      name,
      name_norm as "nameNorm",
      ST_Y(geog::geometry) as lat,
      ST_X(geog::geometry) as lon,
      brand,
      aliases,
      address,
      similarity(name_norm, ${normalized}) as similarity,
      ST_Distance(geog, ST_MakePoint(${ctx.lon}, ${ctx.lat})::geography) / 1000 as distance,
      'geo_assist' as stage
    FROM "Place"
    WHERE city_id = ${ctx.cityId}
      AND status = 'open'
      AND ST_DWithin(
        geog,
        ST_MakePoint(${ctx.lon}, ${ctx.lat})::geography,
        ${radiusKm * 1000}  -- Convert to meters
      )
      AND similarity(name_norm, ${normalized}) >= ${geoThreshold}
    ORDER BY similarity DESC, distance ASC
    LIMIT 10
  `;

  return results;
}

/**
 * Stage 4: Brand disambiguation
 * For chains (brand != null): pick nearest location
 * For singles: keep higher similarity weight
 */
function disambiguateByBrand(
  candidates: MatchCandidate[],
  ctx: MatchContext
): MatchCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Group by brand
  const chains = candidates.filter(c => c.brand !== null);
  const singles = candidates.filter(c => c.brand === null);

  // If we have location context and chains, pick nearest chain location
  if (chains.length > 0 && ctx.lat && ctx.lon) {
    // Sort chains by distance
    const sortedChains = chains.sort((a, b) => {
      const distA = a.distance || Infinity;
      const distB = b.distance || Infinity;
      return distA - distB;
    });
    return sortedChains[0];
  }

  // Otherwise pick highest similarity (singles preferred over chains if tied)
  const allSorted = [...singles, ...chains].sort((a, b) => {
    const simA = a.similarity || 0;
    const simB = b.similarity || 0;

    // If similarity is equal, prefer singles
    if (Math.abs(simA - simB) < 0.01) {
      if (a.brand === null && b.brand !== null) return -1;
      if (a.brand !== null && b.brand === null) return 1;
    }

    return simB - simA;
  });

  return allSorted[0];
}

/**
 * Stage 5: Address consistency check (tie-breaker)
 * If we have an address hint from mention text, check consistency
 */
function checkAddressConsistency(
  candidate: MatchCandidate,
  ctx: MatchContext
): boolean {
  if (!ctx.addressHint || !candidate.address) {
    return true;  // No evidence to contradict
  }

  const normalizedHint = normalizeName(ctx.addressHint);
  const normalizedAddress = normalizeName(candidate.address);

  // Simple substring check (can be enhanced with street number extraction)
  return normalizedAddress.includes(normalizedHint) ||
         normalizedHint.includes(normalizedAddress);
}

/**
 * Main matching function - runs all stages in order
 */
export async function matchPlace(ctx: MatchContext): Promise<MatchCandidate | null> {
  const normalized = normalizeName(ctx.mentionText);

  // Stage 1: Exact alias match
  const aliasMatch = await matchByAlias(ctx, normalized);
  if (aliasMatch) {
    console.log(`[match] Stage 1 (alias): ${aliasMatch.name}`);
    return aliasMatch;
  }

  // Stage 2: Trigram similarity (default threshold)
  const defaultThreshold = tuning.matching.trigram_threshold_default;
  let candidates = await matchByTrigram(ctx, normalized, defaultThreshold);

  if (candidates.length > 0) {
    console.log(`[match] Stage 2 (trigram): ${candidates.length} candidates`);
    const match = disambiguateByBrand(candidates, ctx);
    if (match && checkAddressConsistency(match, ctx)) {
      return match;
    }
  }

  // Stage 3: Geo assist (if location context available)
  if (tuning.matching.geo_assist_enabled && ctx.lat && ctx.lon) {
    candidates = await matchWithGeoAssist(ctx, normalized);

    if (candidates.length > 0) {
      console.log(`[match] Stage 3 (geo_assist): ${candidates.length} candidates`);
      const match = disambiguateByBrand(candidates, ctx);
      if (match && checkAddressConsistency(match, ctx)) {
        return match;
      }
    }
  }

  console.log(`[match] No match found for: ${ctx.mentionText}`);
  return null;
}

/**
 * Batch matching for efficiency (processes multiple mentions at once)
 */
export async function matchPlaces(
  contexts: MatchContext[]
): Promise<Map<string, MatchCandidate | null>> {
  const results = new Map<string, MatchCandidate | null>();

  // Process in parallel with concurrency limit
  const concurrency = 10;
  for (let i = 0; i < contexts.length; i += concurrency) {
    const batch = contexts.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(ctx => matchPlace(ctx))
    );

    batch.forEach((ctx, idx) => {
      results.set(ctx.mentionText, batchResults[idx]);
    });
  }

  return results;
}

/**
 * Extract potential restaurant names from Reddit text
 * (Simple heuristic - can be enhanced with NER)
 */
export function extractPlaceNames(text: string): string[] {
  // Look for quoted strings, capitalized phrases, apostrophe names
  const patterns = [
    /"([^"]+)"/g,           // "Joe's Pizza"
    /'([^']+)'/g,           // 'Katz's Deli'
    /\b([A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+)*)\b/g  // Proper nouns
  ];

  const names = new Set<string>();

  patterns.forEach(pattern => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const name = match[1].trim();
      // Filter out common false positives
      if (name.length >= 3 && !['The', 'And', 'For', 'But'].includes(name)) {
        names.add(name);
      }
    }
  });

  return Array.from(names);
}
