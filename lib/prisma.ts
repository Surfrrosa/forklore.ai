/**
 * Prisma Client singleton with Neon connection pooling
 *
 * Neon Configuration:
 * - Use PgBouncer pooling for serverless (connection pool mode)
 * - Connection string format: postgres://user:pass@ep-xxx.pooler.neon.tech/db?pgbouncer=true
 * - Max connections: ~100 (Neon serverless tier)
 * - Idle timeout: 60s
 *
 * Next.js Edge Runtime:
 * - Use Neon serverless driver (@neondatabase/serverless) for edge functions
 * - Use standard Prisma for Node.js runtime (API routes)
 */

import { PrismaClient } from "@prisma/client";

// Prevent multiple Prisma instances in development
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Get Prisma client instance
 * Use this in API routes and server components
 */
export function getPrisma() {
  return prisma;
}

/**
 * Close Prisma connection
 * Call this in serverless cleanup or testing teardown
 */
export async function closePrisma() {
  await prisma.$disconnect();
}
