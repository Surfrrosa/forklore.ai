/**
 * Geospatial utilities for city geofencing
 */

/** Haversine distance in km */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Simple geofence: inside radius (km) of city center */
export function inCityRadius(
  point: { lat: number; lon: number },
  cityCenter: { lat: number; lon: number },
  radiusKm: number
) {
  return haversineKm(point, cityCenter) <= radiusKm;
}
