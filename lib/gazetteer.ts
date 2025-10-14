/**
 * Seed gazetteer for NYC restaurants with coordinates
 * Later: Replace with OSM/Overpass data loader
 */

import { makeGazetteer } from "./resolver";

export type VenueSeed = { id: string; name: string; lat: number; lon: number; aliases?: string[] };

export const NYC_CENTER = { lat: 40.7128, lon: -74.0060 };
export const NYC_RADIUS_KM = 35; // tweak later

export const NYC_SEED_DATA: VenueSeed[] = [
  { id: "lucali", name: "Lucali", lat: 40.6803, lon: -73.9995 },
  { id: "di-fara", name: "Di Fara Pizza", aliases: ["DiFara","Di Fara"], lat: 40.6257, lon: -73.9606 },
  { id: "prince-street", name: "Prince Street Pizza", aliases: ["Prince St Pizza"], lat: 40.7233, lon: -73.9948 },
  { id: "joes-shanghai", name: "Joe's Shanghai", lat: 40.7149, lon: -73.9971 },
  { id: "katzs", name: "Katz's Delicatessen", aliases: ["Katz's Deli", "Katzs", "Katz's"], lat: 40.7223, lon: -73.9873 },
  { id: "lombardis", name: "Lombardi's Pizza", aliases: ["Lombardis", "Lombardi's"], lat: 40.7216, lon: -73.9956 },
  { id: "joes-pizza", name: "Joe's Pizza", lat: 40.7303, lon: -74.0011 },
  { id: "shake-shack", name: "Shake Shack", lat: 40.7410, lon: -73.9882 },
  { id: "ippudo", name: "Ippudo", aliases: ["Ippudo NY", "Ippudo NYC"], lat: 40.7294, lon: -73.9903 },
  { id: "levain", name: "Levain Bakery", aliases: ["Levain"], lat: 40.7797, lon: -73.9791 },
];

export const NYC_SEED = makeGazetteer(NYC_SEED_DATA);
