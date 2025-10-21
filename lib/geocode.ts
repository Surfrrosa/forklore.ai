/**
 * Geocoding utilities for city name → coordinates + bbox resolution
 * Uses Nominatim (OpenStreetMap) - free, no API key required
 */

import citiesConfig from '../config/cities.json';

export interface BoundingBox {
  readonly type: 'Polygon';
  coordinates: number[][][];
}

export interface CityGeoData {
  name: string;
  displayName: string;
  country: string;
  lat: number;
  lon: number;
  bbox: BoundingBox;
  importance: number;  // Nominatim confidence score
}

/**
 * Resolve city from config first, then fall back to Nominatim
 */
export async function resolveCity(cityQuery: string): Promise<CityGeoData | null> {
  // Stage 1: Check config/cities.json for known cities
  const configCity = resolveCityFromConfig(cityQuery);
  if (configCity) {
    console.log(`[geocode] Resolved from config: ${configCity.name}`);
    return configCity;
  }

  // Stage 2: Query Nominatim for unknown cities
  console.log(`[geocode] Querying Nominatim for: ${cityQuery}`);
  return await geocodeWithNominatim(cityQuery);
}

/**
 * Resolve city from local config (instant, no API call)
 */
function resolveCityFromConfig(query: string): CityGeoData | null {
  const normalized = query.toLowerCase().trim();

  for (const city of citiesConfig.cities) {
    // Check city ID
    if (city.id === normalized) {
      return {
        name: city.name,
        displayName: city.name,
        country: city.country,
        lat: city.lat,
        lon: city.lon,
        bbox: city.bbox as BoundingBox,
        importance: 1.0  // Max confidence for config cities
      };
    }

    // Check aliases
    if (city.aliases.some(alias => alias.toLowerCase() === normalized)) {
      return {
        name: city.name,
        displayName: city.name,
        country: city.country,
        lat: city.lat,
        lon: city.lon,
        bbox: city.bbox as BoundingBox,
        importance: 1.0
      };
    }

    // Check borough aliases (for NYC)
    if (city.boroughs) {
      for (const borough of city.boroughs) {
        if (borough.aliases.some(alias => alias.toLowerCase() === normalized)) {
          // Return main city, not borough
          return {
            name: city.name,
            displayName: `${borough.name}, ${city.name}`,
            country: city.country,
            lat: city.lat,
            lon: city.lon,
            bbox: city.bbox as BoundingBox,
            importance: 0.95  // Slightly lower than exact city match
          };
        }
      }
    }
  }

  return null;
}

/**
 * Geocode city using Nominatim (OpenStreetMap)
 * Rate limit: 1 req/sec, user-agent required
 */
async function geocodeWithNominatim(cityQuery: string): Promise<CityGeoData | null> {
  const baseUrl = 'https://nominatim.openstreetmap.org/search';
  const params = new URLSearchParams({
    q: cityQuery,
    format: 'json',
    limit: '5',
    addressdetails: '1',
    featuretype: 'city',
    'accept-language': 'en'
  });

  const url = `${baseUrl}?${params}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Forklore.ai/1.0 (https://forklore.ai; contact@forklore.ai)'
      }
    });

    if (!response.ok) {
      console.error(`[geocode] Nominatim error: ${response.status}`);
      return null;
    }

    const results = await response.json();

    if (!results || results.length === 0) {
      console.log(`[geocode] No results for: ${cityQuery}`);
      return null;
    }

    // Filter for city-level results only
    const cityResults = results.filter((r: any) =>
      r.type === 'city' ||
      r.type === 'administrative' ||
      r.class === 'place'
    );

    if (cityResults.length === 0) {
      console.log(`[geocode] No city-level results for: ${cityQuery}`);
      return null;
    }

    // Pick result with highest importance
    const best = cityResults.reduce((prev: any, curr: any) =>
      (curr.importance > prev.importance) ? curr : prev
    );

    // Convert boundingbox [south, north, west, east] to GeoJSON Polygon
    const bbox = nominatimBboxToGeoJSON(best.boundingbox);

    return {
      name: best.name,
      displayName: best.display_name,
      country: best.address?.country || 'Unknown',
      lat: parseFloat(best.lat),
      lon: parseFloat(best.lon),
      bbox,
      importance: best.importance
    };

  } catch (error) {
    console.error(`[geocode] Nominatim request failed:`, error);
    return null;
  }
}

/**
 * Convert Nominatim bbox format to GeoJSON Polygon
 * Nominatim: [south, north, west, east]
 * GeoJSON: [[[west, south], [east, south], [east, north], [west, north], [west, south]]]
 */
function nominatimBboxToGeoJSON(bbox: string[]): BoundingBox {
  const [south, north, west, east] = bbox.map(parseFloat);

  return {
    type: 'Polygon' as const,
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south]
    ]]
  };
}

/**
 * Generate bbox from center point + radius (fallback for missing bbox)
 */
export function bboxFromPoint(lat: number, lon: number, radiusKm: number = 25): BoundingBox {
  // Rough approximation: 1 degree ≈ 111km at equator
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));

  const south = lat - latDelta;
  const north = lat + latDelta;
  const west = lon - lonDelta;
  const east = lon + lonDelta;

  return {
    type: 'Polygon' as const,
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south]
    ]]
  };
}

/**
 * Get bbox bounds as [south, north, west, east]
 */
export function getBboxBounds(bbox: BoundingBox): [number, number, number, number] {
  const coords = bbox.coordinates[0];
  const lons = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);

  return [
    Math.min(...lats),  // south
    Math.max(...lats),  // north
    Math.min(...lons),  // west
    Math.max(...lons)   // east
  ];
}

/**
 * Rate limiter for Nominatim (1 req/sec)
 */
let lastNominatimCall = 0;

export async function waitForNominatimRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastNominatimCall;
  const minInterval = 1000;  // 1 second

  if (elapsed < minInterval) {
    const wait = minInterval - elapsed;
    console.log(`[geocode] Rate limiting: waiting ${wait}ms`);
    await new Promise(resolve => setTimeout(resolve, wait));
  }

  lastNominatimCall = Date.now();
}
