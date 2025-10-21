/**
 * Environment variable validation and type-safe access
 *
 * USAGE:
 * - Server-side: import { env } from '@/lib/env'
 * - Validates all required vars at module load time
 * - Throws descriptive errors for missing/invalid vars
 */

interface Env {
  // Database
  DATABASE_URL: string;

  // Reddit API
  REDDIT_CLIENT_ID: string;
  REDDIT_CLIENT_SECRET: string;
  REDDIT_USER_AGENT: string;

  // Optional: Node environment
  NODE_ENV: 'development' | 'production' | 'test';
}

/**
 * Validate and parse environment variables
 */
function validateEnv(): Env {
  const errors: string[] = [];

  // Required vars
  const requiredVars = [
    'DATABASE_URL',
    'REDDIT_CLIENT_ID',
    'REDDIT_CLIENT_SECRET',
    'REDDIT_USER_AGENT'
  ] as const;

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      errors.push(`Missing required environment variable: ${varName}`);
    }
  }

  // Validate NODE_ENV if set
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv && !['development', 'production', 'test'].includes(nodeEnv)) {
    errors.push(`Invalid NODE_ENV: ${nodeEnv}. Must be development, production, or test.`);
  }

  // Validate DATABASE_URL format
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && !dbUrl.startsWith('postgres://') && !dbUrl.startsWith('postgresql://')) {
    errors.push('DATABASE_URL must start with postgres:// or postgresql://');
  }

  // Throw all errors at once
  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}\n\n` +
      'Please check your .env.local file.'
    );
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID!,
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET!,
    REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT!,
    NODE_ENV: (nodeEnv as 'development' | 'production' | 'test') || 'development'
  };
}

/**
 * Validated environment variables
 * Throws on module load if validation fails
 */
export const env = validateEnv();

/**
 * Check if running in production
 */
export const isProd = env.NODE_ENV === 'production';

/**
 * Check if running in development
 */
export const isDev = env.NODE_ENV === 'development';

/**
 * Check if running in test
 */
export const isTest = env.NODE_ENV === 'test';
