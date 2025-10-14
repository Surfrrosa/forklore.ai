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

export function resolveDeterministic(normCandidate: string, g: Gazetteer): Canonical | null {
  return g.byNorm.get(normCandidate) ?? null;
}
