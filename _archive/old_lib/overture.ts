/**
 * Overture Maps on-demand lookups
 *
 * Fetches restaurant data for any city globally without requiring
 * pre-loaded data. Falls back to Overture's public API.
 */

export interface OverturePlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  cuisine?: string[];
  address?: string;
  category?: string;
}

/**
 * Search restaurants in any city using Overture Maps data
 *
 * Note: This is a placeholder for the actual Overture API integration.
 * In production, you would:
 * 1. Use Overture Maps Parquet files from S3
 * 2. Or integrate with their API if available
 * 3. Or use the pre-downloaded data from scripts/02_download_overture.sh
 *
 * For now, returns empty array for cities without pre-loaded data.
 */
export async function searchOvertureRestaurants(
  cityName: string,
  limit: number = 50
): Promise<OverturePlace[]> {
  // TODO: Implement actual Overture API lookup
  // For now, return empty array (will trigger "no data yet" message)

  console.log(`[Overture] On-demand search requested for: ${cityName}`);
  console.log(`[Overture] Would fetch top ${limit} restaurants`);

  // Future implementation:
  // 1. Geocode city name to lat/lng
  // 2. Query Overture Maps API or S3 Parquet files
  // 3. Filter for restaurant categories
  // 4. Return formatted results

  return [];
}

/**
 * Check if we have pre-loaded data for a city
 */
export async function hasCityData(cityId: string): Promise<boolean> {
  const { getPrisma } = await import("@/lib/prisma");
  const prisma = getPrisma();

  const placeCount = await prisma.place.count({
    where: { cityId },
  });

  return placeCount > 0;
}
