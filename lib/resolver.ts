/**
 * Resolver maps extracted candidates to canonical names.
 * Start deterministic: exact/alias match against a gazetteer map.
 * Add fuzzy later.
 */

export type Canonical = {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
  aliases?: string[];
};

export type Gazetteer = {
  // normalized name -> Canonical
  byNorm: Map<string, Canonical>;
};

import { normalizeName } from "./extractor";

export function makeGazetteer(
  seed: { id: string; name: string; lat?: number; lon?: number; aliases?: string[] }[]
): Gazetteer {
  const byNorm = new Map<string, Canonical>();
  for (const r of seed) {
    const base: Canonical = { id: r.id, name: r.name, lat: r.lat, lon: r.lon, aliases: r.aliases ?? [] };
    byNorm.set(normalizeName(r.name), base);
    for (const a of base.aliases) byNorm.set(normalizeName(a), base);
  }
  return { byNorm };
}

/** Calculate simple similarity score between two strings */
function similarity(a: string, b: string): number {
  if (a === b) return 1.0;

  // Check if one is substring of the other (handles "Katz" → "Katz's Delicatessen")
  if (a.includes(b) || b.includes(a)) {
    const shorter = a.length < b.length ? a : b;
    const longer = a.length >= b.length ? a : b;
    return shorter.length / longer.length;
  }

  // Simple token overlap (handles "Di Fara" → "Di Fara Pizza")
  const tokensA = a.split(' ').filter(t => t.length > 0);
  const tokensB = b.split(' ').filter(t => t.length > 0);
  const overlap = tokensA.filter(t => tokensB.includes(t)).length;
  const minTokens = Math.min(tokensA.length, tokensB.length);

  if (minTokens === 0) return 0;
  return overlap / minTokens;
}

export function resolveDeterministic(normCandidate: string, g: Gazetteer): Canonical | null {
  // Try exact match first
  const exact = g.byNorm.get(normCandidate);
  if (exact) return exact;

  // Try fuzzy match with threshold
  let bestMatch: Canonical | null = null;
  let bestScore = 0;
  const threshold = 0.7; // 70% similarity required

  for (const [gazName, canonical] of g.byNorm.entries()) {
    const score = similarity(normCandidate, gazName);
    if (score >= threshold && score > bestScore) {
      bestScore = score;
      bestMatch = canonical;
    }
  }

  return bestMatch;
}
