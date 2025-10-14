/**
 * Seed gazetteer for NYC restaurants
 * Later: Replace with OSM/Overpass data loader
 */

import { makeGazetteer } from "./resolver";

export const NYC_SEED = makeGazetteer([
  { id: "lucali", name: "Lucali", aliases: ["Lucali Pizza"] },
  { id: "di-fara", name: "Di Fara Pizza", aliases: ["DiFara", "DiFara Pizza", "Di Fara"] },
  { id: "prince-street", name: "Prince Street Pizza", aliases: ["Prince St Pizza"] },
  { id: "joes-shanghai", name: "Joe's Shanghai", aliases: ["Joe's Shanghai Restaurant"] },
  { id: "katzs", name: "Katz's Delicatessen", aliases: ["Katz's Deli", "Katzs", "Katz's"] },
  { id: "lombardis", name: "Lombardi's Pizza", aliases: ["Lombardis", "Lombardi's"] },
  { id: "joes-pizza", name: "Joe's Pizza" },
  { id: "shake-shack", name: "Shake Shack" },
  { id: "ippudo", name: "Ippudo", aliases: ["Ippudo NY", "Ippudo NYC"] },
  { id: "levain", name: "Levain Bakery", aliases: ["Levain"] },
]);
