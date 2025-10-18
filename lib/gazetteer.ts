/**
 * Seed gazetteer for NYC restaurants with coordinates
 * Later: Replace with OSM/Overpass data loader
 */

import { makeGazetteer } from "./resolver";

export type VenueSeed = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  aliases?: string[];
  cuisine?: string;
};

export const NYC_CENTER = { lat: 40.7128, lon: -74.0060 };
export const NYC_RADIUS_KM = 35; // tweak later

export const NYC_SEED_DATA: VenueSeed[] = [
  // Pizza
  { id: "lucali", name: "Lucali", lat: 40.6803, lon: -73.9995, cuisine: "Pizza" },
  { id: "di-fara", name: "Di Fara Pizza", aliases: ["DiFara","Di Fara"], lat: 40.6257, lon: -73.9606, cuisine: "Pizza" },
  { id: "prince-street", name: "Prince Street Pizza", aliases: ["Prince St Pizza"], lat: 40.7233, lon: -73.9948, cuisine: "Pizza" },
  { id: "lombardis", name: "Lombardi's Pizza", aliases: ["Lombardis", "Lombardi's"], lat: 40.7216, lon: -73.9956, cuisine: "Pizza" },
  { id: "joes-pizza", name: "Joe's Pizza", lat: 40.7303, lon: -74.0011, cuisine: "Pizza" },
  { id: "roberta's", name: "Roberta's", lat: 40.7050, lon: -73.9331, cuisine: "Pizza" },
  { id: "grimaldis", name: "Grimaldi's", aliases: ["Grimaldi's Pizza"], lat: 40.7028, lon: -73.9935, cuisine: "Pizza" },
  { id: "best-pizza", name: "Best Pizza", lat: 40.6803, lon: -73.9995, cuisine: "Pizza" },
  { id: "l-and-b-spumoni", name: "L&B Spumoni Gardens", lat: 40.5968, lon: -73.9806, cuisine: "Pizza" },
  { id: "juliana's", name: "Juliana's", lat: 40.7027, lon: -73.9937, cuisine: "Pizza" },

  // Chinese
  { id: "joes-shanghai", name: "Joe's Shanghai", lat: 40.7149, lon: -73.9971, cuisine: "Chinese" },
  { id: "xi-an-famous", name: "Xi'an Famous Foods", lat: 40.7149, lon: -73.9971, cuisine: "Chinese" },
  { id: "tasty-hand-pulled", name: "Tasty Hand-Pulled Noodles", lat: 40.7161, lon: -73.9967, cuisine: "Chinese" },
  { id: "wo-hop", name: "Wo Hop", lat: 40.7149, lon: -73.9978, cuisine: "Chinese" },
  { id: "vanessa's-dumpling", name: "Vanessa's Dumpling House", lat: 40.7149, lon: -73.9967, cuisine: "Chinese" },

  // Ramen
  { id: "ippudo", name: "Ippudo", aliases: ["Ippudo NY", "Ippudo NYC"], lat: 40.7294, lon: -73.9903, cuisine: "Ramen" },
  { id: "totto-ramen", name: "Totto Ramen", lat: 40.7652, lon: -73.9870, cuisine: "Ramen" },
  { id: "ichiran", name: "Ichiran", lat: 40.7306, lon: -73.9904, cuisine: "Ramen" },
  { id: "hide-chan", name: "Hide-Chan Ramen", lat: 40.7303, lon: -73.9877, cuisine: "Ramen" },
  { id: "mu-ramen", name: "Mu Ramen", lat: 40.7094, lon: -73.9536, cuisine: "Ramen" },

  // Deli
  { id: "katzs", name: "Katz's Delicatessen", aliases: ["Katz's Deli", "Katzs", "Katz's"], lat: 40.7223, lon: -73.9873, cuisine: "Deli" },
  { id: "russ-and-daughters", name: "Russ & Daughters", lat: 40.7223, lon: -73.9877, cuisine: "Deli" },
  { id: "2nd-ave-deli", name: "2nd Ave Deli", lat: 40.7477, lon: -73.9754, cuisine: "Deli" },
  { id: "mill-basin", name: "Mill Basin Deli", lat: 40.6143, lon: -73.9063, cuisine: "Deli" },

  // Burgers
  { id: "shake-shack", name: "Shake Shack", lat: 40.7410, lon: -73.9882, cuisine: "Burgers" },
  { id: "corner-bistro", name: "Corner Bistro", lat: 40.7360, lon: -74.0018, cuisine: "Burgers" },
  { id: "burger-joint", name: "Burger Joint", lat: 40.7637, lon: -73.9794, cuisine: "Burgers" },
  { id: "jg-melon", name: "J.G. Melon", lat: 40.7736, lon: -73.9593, cuisine: "Burgers" },
  { id: "black-tap", name: "Black Tap", lat: 40.7275, lon: -74.0025, cuisine: "Burgers" },

  // Bakery
  { id: "levain", name: "Levain Bakery", aliases: ["Levain"], lat: 40.7797, lon: -73.9791, cuisine: "Bakery" },
  { id: "dominique-ansel", name: "Dominique Ansel Bakery", lat: 40.7252, lon: -74.0033, cuisine: "Bakery" },
  { id: "lafayette", name: "Lafayette Grand Café & Bakery", lat: 40.7273, lon: -73.9949, cuisine: "Bakery" },
  { id: "breads-bakery", name: "Breads Bakery", lat: 40.7437, lon: -73.9881, cuisine: "Bakery" },

  // Mexican/Tacos
  { id: "los-tacos-no-1", name: "Los Tacos No. 1", lat: 40.7425, lon: -74.0066, cuisine: "Mexican" },
  { id: "cosme", name: "Cosme", lat: 40.7435, lon: -73.9899, cuisine: "Mexican" },
  { id: "casa-enrique", name: "Casa Enrique", lat: 40.7433, lon: -73.9384, cuisine: "Mexican" },
  { id: "tacombi", name: "Tacombi", lat: 40.7244, lon: -74.0045, cuisine: "Mexican" },
  { id: "empellón", name: "Empellón", lat: 40.7268, lon: -73.9834, cuisine: "Mexican" },

  // Sushi
  { id: "sushi-nakazawa", name: "Sushi Nakazawa", lat: 40.7360, lon: -74.0030, cuisine: "Sushi" },
  { id: "blue-ribbon-sushi", name: "Blue Ribbon Sushi", lat: 40.7252, lon: -74.0003, cuisine: "Sushi" },
  { id: "tanoshi", name: "Tanoshi", lat: 40.7736, lon: -73.9559, cuisine: "Sushi" },
  { id: "sushi-yasuda", name: "Sushi Yasuda", lat: 40.7530, lon: -73.9753, cuisine: "Sushi" },

  // Italian
  { id: "carbone", name: "Carbone", lat: 40.7268, lon: -74.0014, cuisine: "Italian" },
  { id: "l-artusi", name: "L'Artusi", lat: 40.7361, lon: -74.0034, cuisine: "Italian" },
  { id: "via-carota", name: "Via Carota", lat: 40.7359, lon: -74.0021, cuisine: "Italian" },
  { id: "i-sodi", name: "I Sodi", lat: 40.7351, lon: -74.0021, cuisine: "Italian" },
  { id: "lupa", name: "Lupa", lat: 40.7306, lon: -74.0008, cuisine: "Italian" },
  { id: "babbo", name: "Babbo", lat: 40.7306, lon: -74.0008, cuisine: "Italian" },

  // Steakhouse
  { id: "peter-luger", name: "Peter Luger", lat: 40.7101, lon: -73.9622, cuisine: "Steakhouse" },
  { id: "keens", name: "Keens Steakhouse", lat: 40.7481, lon: -73.9871, cuisine: "Steakhouse" },
  { id: "wolfgang's", name: "Wolfgang's Steakhouse", lat: 40.7525, lon: -73.9776, cuisine: "Steakhouse" },
  { id: "ben-and-jacks", name: "Ben & Jack's Steakhouse", lat: 40.7624, lon: -73.9680, cuisine: "Steakhouse" },

  // Brunch/American
  { id: "clinton-st-baking", name: "Clinton St. Baking Company", lat: 40.7210, lon: -73.9836, cuisine: "Brunch" },
  { id: "balthazar", name: "Balthazar", lat: 40.7231, lon: -73.9977, cuisine: "Brunch" },
  { id: "egg-shop", name: "Egg Shop", lat: 40.7217, lon: -73.9937, cuisine: "Brunch" },
  { id: "sarabeth's", name: "Sarabeth's", lat: 40.7765, lon: -73.9791, cuisine: "Brunch" },
  { id: "buvette", name: "Buvette", lat: 40.7346, lon: -74.0008, cuisine: "Brunch" },

  // Thai
  { id: "uncle-boons", name: "Uncle Boons", lat: 40.7217, lon: -73.9968, cuisine: "Thai" },
  { id: "somtum-der", name: "Somtum Der", lat: 40.7289, lon: -73.9836, cuisine: "Thai" },
  { id: "thai-diner", name: "Thai Diner", lat: 40.7223, lon: -73.9961, cuisine: "Thai" },

  // Korean
  { id: "her-name-is-han", name: "Her Name is Han", lat: 40.7465, lon: -73.9502, cuisine: "Korean" },
  { id: "mom's-touch", name: "Mom's Touch", lat: 40.7471, lon: -73.9499, cuisine: "Korean" },
  { id: "oiji", name: "Oiji", lat: 40.7289, lon: -73.9834, cuisine: "Korean" },

  // Vietnamese
  { id: "hanoi-house", name: "Hanoi House", lat: 40.7305, lon: -73.9826, cuisine: "Vietnamese" },
  { id: "pho-bang", name: "Pho Bang", lat: 40.7160, lon: -73.9965, cuisine: "Vietnamese" },

  // Indian
  { id: "indian-accent", name: "Indian Accent", lat: 40.7637, lon: -73.9776, cuisine: "Indian" },
  { id: "dhaba", name: "Dhaba", lat: 40.7474, lon: -73.9499, cuisine: "Indian" },
  { id: "panna-ii", name: "Panna II", lat: 40.7273, lon: -73.9845, cuisine: "Indian" },

  // Middle Eastern
  { id: "halal-guys", name: "The Halal Guys", lat: 40.7629, lon: -73.9787, cuisine: "Middle Eastern" },
  { id: "mamoun's", name: "Mamoun's Falafel", lat: 40.7306, lon: -74.0003, cuisine: "Middle Eastern" },
  { id: "taim", name: "Taim", lat: 40.7361, lon: -74.0018, cuisine: "Middle Eastern" },

  // BBQ/Southern
  { id: "hometown-bbq", name: "Hometown Bar-B-Que", lat: 40.6776, lon: -73.9830, cuisine: "BBQ" },
  { id: "mighty-quinn", name: "Mighty Quinn's", lat: 40.7289, lon: -73.9834, cuisine: "BBQ" },
  { id: "dinosaur-bbq", name: "Dinosaur Bar-B-Que", lat: 40.8080, lon: -73.9507, cuisine: "BBQ" },

  // Seafood
  { id: "zabar's", name: "Zabar's", lat: 40.7847, lon: -73.9792, cuisine: "Deli" },
  { id: "lobster-place", name: "The Lobster Place", lat: 40.7423, lon: -74.0063, cuisine: "Seafood" },
  { id: "grand-banks", name: "Grand Banks", lat: 40.7211, lon: -74.0157, cuisine: "Seafood" },

  // Fine Dining
  { id: "eleven-madison", name: "Eleven Madison Park", lat: 40.7417, lon: -73.9870, cuisine: "Fine Dining" },
  { id: "le-bernardin", name: "Le Bernardin", lat: 40.7630, lon: -73.9804, cuisine: "Fine Dining" },
  { id: "per-se", name: "Per Se", lat: 40.7685, lon: -73.9830, cuisine: "Fine Dining" },
  { id: "daniel", name: "Daniel", lat: 40.7683, lon: -73.9663, cuisine: "Fine Dining" },
  { id: "gramercy-tavern", name: "Gramercy Tavern", lat: 40.7393, lon: -73.9884, cuisine: "Fine Dining" },

  // Dessert/Ice Cream
  { id: "milk-bar", name: "Milk Bar", lat: 40.7289, lon: -73.9834, cuisine: "Dessert" },
  { id: "morgenstern's", name: "Morgenstern's Finest Ice Cream", lat: 40.7223, lon: -73.9877, cuisine: "Dessert" },
  { id: "ample-hills", name: "Ample Hills Creamery", lat: 40.6844, lon: -73.9722, cuisine: "Dessert" },

  // Bagels
  { id: "ess-a-bagel", name: "Ess-a-Bagel", lat: 40.7477, lon: -73.9754, cuisine: "Bagels" },
  { id: "murray's-bagels", name: "Murray's Bagels", lat: 40.7331, lon: -74.0015, cuisine: "Bagels" },
  { id: "absolute-bagels", name: "Absolute Bagels", lat: 40.7986, lon: -73.9690, cuisine: "Bagels" },

  // Hot Dogs
  { id: "gray's-papaya", name: "Gray's Papaya", lat: 40.7786, lon: -73.9801, cuisine: "Hot Dogs" },
  { id: "nathan's", name: "Nathan's Famous", lat: 40.5759, lon: -73.9801, cuisine: "Hot Dogs" },

  // Wings
  { id: "buffalo-boss", name: "Buffalo Boss", lat: 40.7289, lon: -73.9834, cuisine: "Wings" },
  { id: "atomic-wings", name: "Atomic Wings", lat: 40.7786, lon: -73.9791, cuisine: "Wings" },
];

export const NYC_SEED = makeGazetteer(NYC_SEED_DATA);
