/**
 * Overpass API integration for on-demand city bootstrap
 * Fetches restaurant POIs from OpenStreetMap
 */

import { getBboxBounds, type BoundingBox } from './geocode';
import { normalizeName } from './match';
import tuning from '../config/tuning.json';

export interface OverpassPlace {
  osmId: string;
  name: string;
  nameNorm: string;
  lat: number;
  lon: number;
  cuisine: string[];
  address?: string;
  brand?: string;
  website?: string;
}

/**
 * Query Overpass API for restaurants in bbox
 * Returns normalized place data ready for DB insertion
 */
export async function fetchRestaurants(bbox: BoundingBox): Promise<OverpassPlace[]> {
  const [south, north, west, east] = getBboxBounds(bbox);
  const timeout = tuning.bootstrap.overpass_timeout_seconds;
  const maxPlaces = tuning.bootstrap.max_places_per_city;

  // Overpass QL query for restaurants, cafes, bars, fast_food
  const query = `
[out:json][timeout:${timeout}];
(
  node["amenity"="restaurant"](${south},${west},${north},${east});
  way["amenity"="restaurant"](${south},${west},${north},${east});
  node["amenity"="cafe"](${south},${west},${north},${east});
  way["amenity"="cafe"](${south},${west},${north},${east});
  node["amenity"="bar"](${south},${west},${north},${east});
  way["amenity"="bar"](${south},${west},${north},${east});
  node["amenity"="fast_food"](${south},${west},${north},${east});
  way["amenity"="fast_food"](${south},${west},${north},${east});
);
out center tags ${maxPlaces};
  `.trim();

  console.log(`[overpass] Querying bbox: [${south}, ${north}, ${west}, ${east}]`);

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Forklore.ai/1.0 (https://forklore.ai; contact@forklore.ai)'
      },
      body: `data=${encodeURIComponent(query)}`
    });

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.elements || data.elements.length === 0) {
      console.log(`[overpass] No results found in bbox`);
      return [];
    }

    console.log(`[overpass] Found ${data.elements.length} places`);

    // Normalize and deduplicate
    const places = data.elements
      .map((el: any) => normalizeOverpassElement(el))
      .filter((p: OverpassPlace | null) => p !== null) as OverpassPlace[];

    // Deduplicate by name+location (some places have both node and way)
    const unique = deduplicatePlaces(places);

    console.log(`[overpass] After dedup: ${unique.length} unique places`);

    return unique.slice(0, maxPlaces);

  } catch (error) {
    console.error(`[overpass] Query failed:`, error);
    throw error;
  }
}

/**
 * Normalize Overpass element to our Place schema
 */
function normalizeOverpassElement(el: any): OverpassPlace | null {
  const tags = el.tags || {};

  // Must have a name
  if (!tags.name) {
    return null;
  }

  // Get coordinates (either from node or way center)
  const lat = el.lat || el.center?.lat;
  const lon = el.lon || el.center?.lon;

  if (!lat || !lon) {
    return null;
  }

  // Parse cuisine (can be semicolon-separated)
  const cuisineRaw = tags.cuisine || tags['cuisine:en'] || '';
  const cuisine = cuisineRaw
    .split(';')
    .map((c: string) => c.trim().toLowerCase())
    .filter((c: string) => c.length > 0);

  // Build address from components
  const addressParts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:city'],
    tags['addr:postcode']
  ].filter(Boolean);

  const address = addressParts.length > 0 ? addressParts.join(' ') : undefined;

  return {
    osmId: `${el.type}/${el.id}`,
    name: tags.name,
    nameNorm: normalizeName(tags.name),
    lat,
    lon,
    cuisine,
    address,
    brand: tags.brand || tags['brand:en'] || undefined,
    website: tags.website || tags['contact:website'] || undefined
  };
}

/**
 * Deduplicate places by name + proximity (within 50m = same location)
 */
function deduplicatePlaces(places: OverpassPlace[]): OverpassPlace[] {
  const unique: OverpassPlace[] = [];
  const seen = new Set<string>();

  for (const place of places) {
    // Check if we've seen a similar place nearby
    const key = `${place.nameNorm}_${place.lat.toFixed(4)}_${place.lon.toFixed(4)}`;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(place);
    }
  }

  return unique;
}

/**
 * Calculate distance between two points in km (Haversine formula)
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Rate limiter for Overpass API
 * Recommended: wait 1s between requests
 */
let lastOverpassCall = 0;

export async function waitForOverpassRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastOverpassCall;
  const minInterval = 1000;  // 1 second

  if (elapsed < minInterval) {
    const wait = minInterval - elapsed;
    console.log(`[overpass] Rate limiting: waiting ${wait}ms`);
    await new Promise(resolve => setTimeout(resolve, wait));
  }

  lastOverpassCall = Date.now();
}

/**
 * Test Overpass API connectivity
 */
export async function testOverpassConnection(): Promise<boolean> {
  try {
    const response = await fetch('https://overpass-api.de/api/status');
    return response.ok;
  } catch {
    return false;
  }
}
