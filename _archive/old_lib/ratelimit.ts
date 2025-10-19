/**
 * Rate limiting using Upstash Redis
 *
 * Protects API endpoints from abuse with minimal latency (<5ms)
 * Uses token bucket algorithm with sliding window
 *
 * Free tier: 10,000 commands/day (plenty for MVP)
 * Latency: Sub-5ms globally distributed
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

// Initialize Redis client from environment variables
// Required: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
const redis = process.env.UPSTASH_REDIS_REST_URL
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
    })
  : null;

/**
 * Rate limit configurations for different endpoint types
 */
export const RateLimitPresets = {
  /** Strict: 20 requests per 10 minutes (search, ranking queries) */
  STRICT: {
    requests: 20,
    window: "10 m" as const,
  },

  /** Standard: 100 requests per hour (general API usage) */
  STANDARD: {
    requests: 100,
    window: "1 h" as const,
  },

  /** Generous: 300 requests per hour (fuzzy search, autocomplete) */
  GENEROUS: {
    requests: 300,
    window: "1 h" as const,
  },

  /** Burst: 10 requests per minute (prevent rapid automated scraping) */
  BURST: {
    requests: 10,
    window: "1 m" as const,
  },
} as const;

/**
 * Create a rate limiter with specified config
 */
function createRateLimiter(config: { requests: number; window: string }) {
  if (!redis) {
    console.warn("⚠️  Upstash Redis not configured - rate limiting disabled");
    return null;
  }

  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.requests, config.window),
    analytics: true, // Track usage metrics in Upstash dashboard
    prefix: "forklore", // Namespace for this app
  });
}

/**
 * Get client identifier from request
 * Priority: API key > IP address > User-Agent hash
 */
function getClientId(req: Request): string {
  // 1. Check for API key (if implementing auth later)
  const apiKey = req.headers.get("x-api-key");
  if (apiKey) return `apikey:${apiKey}`;

  // 2. Get IP address from various headers (Vercel, Cloudflare, etc.)
  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const ip = forwarded?.split(",")[0] || realIp || "unknown";

  // 3. Fallback: hash of user-agent (less reliable but better than nothing)
  if (ip === "unknown") {
    const ua = req.headers.get("user-agent") || "anonymous";
    return `ua:${ua.slice(0, 50)}`;
  }

  return `ip:${ip}`;
}

/**
 * Rate limit middleware for API routes
 *
 * Usage:
 * ```typescript
 * const { success, response } = await ratelimit(req, RateLimitPresets.STANDARD);
 * if (!success) return response;
 * ```
 */
export async function ratelimit(
  req: Request,
  config: { requests: number; window: string } = RateLimitPresets.STANDARD
): Promise<{
  success: boolean;
  response?: NextResponse;
  limit?: number;
  remaining?: number;
  reset?: number;
}> {
  const limiter = createRateLimiter(config);

  // If Upstash not configured, allow all requests (dev mode)
  if (!limiter) {
    return { success: true };
  }

  const identifier = getClientId(req);

  try {
    const { success, limit, remaining, reset } = await limiter.limit(identifier);

    if (!success) {
      // Rate limit exceeded
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);

      return {
        success: false,
        response: NextResponse.json(
          {
            error: "Rate limit exceeded",
            message: `Too many requests. Please try again in ${retryAfter} seconds.`,
            retryAfter,
            limit,
            remaining: 0,
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(retryAfter),
              "X-RateLimit-Limit": String(limit),
              "X-RateLimit-Remaining": String(remaining),
              "X-RateLimit-Reset": String(reset),
            },
          }
        ),
      };
    }

    // Success - return rate limit headers for client
    return {
      success: true,
      limit,
      remaining,
      reset,
    };
  } catch (error) {
    // If rate limiting fails (e.g., Redis down), fail open (allow request)
    console.error("Rate limiting error:", error);
    return { success: true };
  }
}

/**
 * Add rate limit headers to a successful response
 */
export function withRateLimitHeaders(
  response: NextResponse,
  ratelimitResult: { limit?: number; remaining?: number; reset?: number }
): NextResponse {
  const { limit, remaining, reset } = ratelimitResult;

  if (limit !== undefined) {
    response.headers.set("X-RateLimit-Limit", String(limit));
  }
  if (remaining !== undefined) {
    response.headers.set("X-RateLimit-Remaining", String(remaining));
  }
  if (reset !== undefined) {
    response.headers.set("X-RateLimit-Reset", String(reset));
  }

  return response;
}

/**
 * Combined middleware: rate limit + response wrapper
 *
 * Usage:
 * ```typescript
 * export async function GET(req: Request) {
 *   const check = await checkRateLimit(req, RateLimitPresets.STANDARD);
 *   if (!check.success) return check.response!;
 *
 *   const data = { ... };
 *   return check.wrap(NextResponse.json(data));
 * }
 * ```
 */
export async function checkRateLimit(
  req: Request,
  config: { requests: number; window: string } = RateLimitPresets.STANDARD
) {
  const result = await ratelimit(req, config);

  return {
    ...result,
    wrap: (response: NextResponse) =>
      result.success ? withRateLimitHeaders(response, result) : response,
  };
}
