/**
 * City and alias lookup utilities
 */

import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

/**
 * Resolve a city query (name or alias) to a City record
 *
 * Supports:
 * - Direct city names: "New York"
 * - Aliases: "nyc", "manhattan", "brooklyn"
 * - Case-insensitive matching
 *
 * @param query - City name or alias to search for
 * @returns City record or null if not found
 *
 * @example
 * ```typescript
 * const city = await resolveCityQuery("nyc");
 * // Returns: { id: "...", name: "New York", ... }
 *
 * const city2 = await resolveCityQuery("manhattan");
 * // Returns: { id: "...", name: "New York", ... }
 * ```
 */
export async function resolveCityQuery(query: string) {
  if (!query) return null;

  const normalizedQuery = query.trim();

  // Try direct city name match first (faster)
  const directMatch = await prisma.city.findFirst({
    where: {
      name: {
        equals: normalizedQuery,
        mode: "insensitive",
      },
    },
  });

  if (directMatch) return directMatch;

  // Try alias lookup
  const aliasMatch = await prisma.cityAlias.findFirst({
    where: {
      alias: {
        equals: normalizedQuery,
        mode: "insensitive",
      },
    },
    include: {
      city: true,
    },
  });

  return aliasMatch?.city ?? null;
}

/**
 * Check if a query string is a borough/neighborhood alias
 *
 * Useful for determining if we should search borough-specific
 * subreddits or apply borough-level filtering
 *
 * @param query - Query string to check
 * @returns True if query is a borough alias
 */
export async function isBoroughQuery(query: string): Promise<boolean> {
  if (!query) return false;

  const alias = await prisma.cityAlias.findFirst({
    where: {
      alias: {
        equals: query.trim(),
        mode: "insensitive",
      },
    },
    select: {
      isBorough: true,
    },
  });

  return alias?.isBorough ?? false;
}

/**
 * Get all aliases for a city
 *
 * @param cityId - City ID
 * @returns Array of alias objects
 */
export async function getCityAliases(cityId: string) {
  return prisma.cityAlias.findMany({
    where: { cityId },
    orderBy: [{ isBorough: "asc" }, { alias: "asc" }],
  });
}
