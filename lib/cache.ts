/**
 * Cache utilities for v2 API endpoints
 *
 * Implements:
 * - HTTP caching headers (Cache-Control, ETag)
 * - Stale-while-revalidate for graceful degradation
 * - ETag generation based on data freshness
 */

import { NextResponse } from "next/server";
import crypto from "crypto";

interface CacheConfig {
  /** Max age in seconds (default: 1 hour) */
  maxAge?: number;
  /** Stale-while-revalidate window in seconds (default: 24 hours) */
  staleWhileRevalidate?: number;
  /** Data for ETag generation (typically last updated timestamp) */
  etagData?: string | number | Date;
}

/**
 * Generate an ETag from data
 * For MVs, use the last refresh timestamp
 * For aggregations, use computedAt timestamp
 */
export function generateETag(data: string | number | Date | object): string {
  const str = typeof data === "object"
    ? JSON.stringify(data)
    : String(data);

  const hash = crypto
    .createHash("md5")
    .update(str)
    .digest("hex");

  return `"${hash.slice(0, 16)}"`;
}

/**
 * Add cache headers to a NextResponse
 * Returns the same response with cache headers added
 */
export function withCacheHeaders(
  response: NextResponse,
  config: CacheConfig = {}
): NextResponse {
  const {
    maxAge = 3600, // 1 hour default
    staleWhileRevalidate = 86400, // 24 hours default
    etagData,
  } = config;

  // Set Cache-Control header
  // public: can be cached by CDN
  // max-age: fresh for this long
  // stale-while-revalidate: serve stale while fetching fresh in background
  response.headers.set(
    "Cache-Control",
    `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`
  );

  // Set ETag if data provided
  if (etagData) {
    const etag = generateETag(etagData);
    response.headers.set("ETag", etag);
  }

  // Add Vary header for city/query params
  response.headers.set("Vary", "Accept-Encoding");

  return response;
}

/**
 * Check if request has matching ETag (304 Not Modified)
 * Returns true if client has fresh copy
 */
export function checkETag(
  req: Request,
  etagData: string | number | Date | object
): boolean {
  const clientETag = req.headers.get("If-None-Match");
  if (!clientETag) return false;

  const serverETag = generateETag(etagData);
  return clientETag === serverETag;
}

/**
 * Helper to create cached JSON response
 * Automatically handles ETag 304 responses
 */
export function cachedJson(
  data: any,
  config: CacheConfig = {}
): NextResponse {
  const response = NextResponse.json(data);
  return withCacheHeaders(response, config);
}

/**
 * Cache configuration presets for different endpoint types
 */
export const CachePresets = {
  /** Materialized view data - cache for 1 hour */
  MV: {
    maxAge: 3600,
    staleWhileRevalidate: 86400,
  },

  /** Fuzzy search - cache for 5 minutes (more dynamic) */
  FUZZY: {
    maxAge: 300,
    staleWhileRevalidate: 3600,
  },

  /** Place details - cache for 24 hours (static) */
  PLACE: {
    maxAge: 86400,
    staleWhileRevalidate: 604800, // 7 days
  },

  /** Facets/cuisines - cache for 6 hours */
  FACETS: {
    maxAge: 21600,
    staleWhileRevalidate: 86400,
  },
} as const;
