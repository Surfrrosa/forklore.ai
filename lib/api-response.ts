/**
 * Standardized API Response Format
 *
 * All API endpoints should return responses in this consistent format:
 * {
 *   data: T,                    // The actual response payload
 *   meta: {
 *     timestamp: string,        // ISO timestamp of response
 *     response_time_ms: number  // Response time in milliseconds
 *   }
 * }
 */

import { NextResponse } from 'next/server';

export interface ApiResponse<T> {
  data: T;
  meta: {
    timestamp: string;
    response_time_ms: number;
  };
}

export interface ApiErrorResponse {
  error: {
    message: string;
    code?: string;
  };
  meta: {
    timestamp: string;
  };
}

/**
 * Create a successful API response
 */
export function createApiResponse<T>(
  data: T,
  startTime: number,
  headers?: Record<string, string>
): NextResponse {
  const response: ApiResponse<T> = {
    data,
    meta: {
      timestamp: new Date().toISOString(),
      response_time_ms: Date.now() - startTime
    }
  };

  const responseHeaders: Record<string, string> = {
    'X-Response-Time': `${Date.now() - startTime}ms`,
    ...headers
  };

  return NextResponse.json(response, { headers: responseHeaders });
}

/**
 * Create an error API response
 */
export function createApiErrorResponse(
  message: string,
  status: number,
  code?: string
): NextResponse {
  const response: ApiErrorResponse = {
    error: {
      message,
      ...(code && { code })
    },
    meta: {
      timestamp: new Date().toISOString()
    }
  };

  return NextResponse.json(response, { status });
}
