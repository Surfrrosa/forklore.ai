/**
 * Prisma client singleton with connection pooling
 * Prevents multiple instances in development (hot reload)
 * Handles graceful shutdown for production
 */

import { PrismaClient } from '@prisma/client';
import { isDev } from './env';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: isDev ? ['error', 'warn'] : ['error'],
  });

// Prevent connection pool exhaustion during hot reloads in development
if (isDev) {
  globalForPrisma.prisma = prisma;
}

// Graceful shutdown handlers for production
if (!isDev) {
  const shutdown = async () => {
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export default prisma;
