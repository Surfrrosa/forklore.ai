/**
 * In-memory rate limiter for API endpoints
 *
 * Uses sliding window algorithm with IP-based tracking
 * Automatically cleans up old entries to prevent memory leaks
 *
 * For production scale, consider Redis-based rate limiting
 */

import { NextRequest, NextResponse } from 'next/server';

interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  maxRequests: number;  // Max requests per window
  message?: string;
}

interface RateLimitEntry {
  requests: number[];  // Timestamps of requests
  lastCleanup: number;  // Last cleanup timestamp
}

// In-memory store: IP -> RateLimitEntry
const store = new Map<string, RateLimitEntry>();

// Cleanup interval (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastGlobalCleanup = Date.now();

/**
 * Rate limit middleware factory
 */
export function rateLimit(config: RateLimitConfig) {
  const { windowMs, maxRequests, message = 'Too many requests, please try again later.' } = config;

  return async function rateLimitMiddleware(
    request: NextRequest,
    handler: () => Promise<NextResponse>
  ): Promise<NextResponse> {
    // Get client identifier (IP address)
    const identifier = getIdentifier(request);

    // Get or create entry
    let entry = store.get(identifier);
    if (!entry) {
      entry = { requests: [], lastCleanup: Date.now() };
      store.set(identifier, entry);
    }

    const now = Date.now();
    const windowStart = now - windowMs;

    // Remove old requests outside window
    entry.requests = entry.requests.filter(timestamp => timestamp > windowStart);

    // Check if limit exceeded
    if (entry.requests.length >= maxRequests) {
      // Calculate retry-after in seconds
      const oldestRequest = Math.min(...entry.requests);
      const retryAfter = Math.ceil((oldestRequest + windowMs - now) / 1000);

      return NextResponse.json(
        { error: message, retryAfter },
        {
          status: 429,
          headers: {
            'Retry-After': retryAfter.toString(),
            'X-RateLimit-Limit': maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(oldestRequest + windowMs).toISOString()
          }
        }
      );
    }

    // Add current request
    entry.requests.push(now);
    entry.lastCleanup = now;

    // Periodic cleanup
    if (now - lastGlobalCleanup > CLEANUP_INTERVAL) {
      cleanupStore(windowMs);
      lastGlobalCleanup = now;
    }

    // Execute handler
    const response = await handler();

    // Add rate limit headers to successful response
    const remaining = maxRequests - entry.requests.length;
    const oldestRequest = Math.min(...entry.requests);
    const resetTime = new Date(oldestRequest + windowMs).toISOString();

    response.headers.set('X-RateLimit-Limit', maxRequests.toString());
    response.headers.set('X-RateLimit-Remaining', remaining.toString());
    response.headers.set('X-RateLimit-Reset', resetTime);

    return response;
  };
}

/**
 * Get client identifier from request
 * Checks X-Forwarded-For, X-Real-IP, then falls back to remote address
 */
function getIdentifier(request: NextRequest): string {
  // Check X-Forwarded-For (reverse proxy)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const ips = forwarded.split(',').map(ip => ip.trim());
    return ips[0];  // First IP is the client
  }

  // Check X-Real-IP (nginx)
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback to a generic identifier
  return 'unknown';
}

/**
 * Clean up old entries from store
 */
function cleanupStore(windowMs: number): void {
  const now = Date.now();
  const cutoff = now - windowMs - (60 * 1000); // Keep extra 1 min buffer

  for (const [identifier, entry] of store.entries()) {
    // Remove entries with no recent requests
    if (entry.lastCleanup < cutoff) {
      store.delete(identifier);
      continue;
    }

    // Clean up old requests within entry
    entry.requests = entry.requests.filter(timestamp => timestamp > cutoff);

    // If no requests left, remove entry
    if (entry.requests.length === 0) {
      store.delete(identifier);
    }
  }

  console.log(`[rate-limit] Cleanup complete. Active identifiers: ${store.size}`);
}

/**
 * Pre-configured rate limiters for common use cases
 */

// Strict: 10 requests per minute
export const strictRateLimit = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: 'Rate limit exceeded. Maximum 10 requests per minute.'
});

// Standard: 30 requests per minute
export const standardRateLimit = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 30,
  message: 'Rate limit exceeded. Maximum 30 requests per minute.'
});

// Generous: 100 requests per minute
export const generousRateLimit = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 100,
  message: 'Rate limit exceeded. Maximum 100 requests per minute.'
});

// Burst protection: 5 requests per 10 seconds
export const burstRateLimit = rateLimit({
  windowMs: 10 * 1000,
  maxRequests: 5,
  message: 'Too many requests in a short time. Please slow down.'
});

/**
 * Get current store stats (for monitoring)
 */
export function getRateLimitStats() {
  return {
    activeIdentifiers: store.size,
    totalRequests: Array.from(store.values()).reduce((sum, entry) => sum + entry.requests.length, 0)
  };
}
