/**
 * Lightweight restaurant name extraction from free text.
 * Strategy:
 * 1) Pull capitalized noun-ish phrases (2–4 tokens) as candidates.
 * 2) Allow known food suffixes (pizza, ramen, bbq, tacos, cafe, diner, bar, grill, bakery, bagels, deli, sushi).
 * 3) Normalize and score candidates.
 * 4) Return unique candidates with basic metadata.
 */

export type ExtractCandidate = {
  raw: string;          // exact text span
  norm: string;         // normalized (for matching)
  start: number;        // index in source text
  end: number;          // index in source text
  hasFoodWord: boolean; // ends with a food word (helpful later)
};

const FOOD_SUFFIXES = [
  "pizza","ramen","bbq","barbecue","taco","tacos","taqueria","cafe","coffee","espresso",
  "diner","bar","grill","bakery","bagel","bagels","deli","sushi","izakaya","bistro","steakhouse",
  "shawarma","falafel","burger","burgers","bbq","noodle","noodles","donuts","doughnuts","pizzeria"
];

const STOPWORDS = new Set([
  "the","a","an","and","of","for","to","in","on","at","by","with","from","my","your","our",
  "hit","also","tried","went","had","got","visit","visited","check","checked"
]);

// Block common chains/non-venues unless we want them later
const BLOCKED_CHAINS = new Set([
  "starbucks","dunkin","dunkin donuts","subway","mcdonalds","burger king","wendys",
  "taco bell","kfc","pizza hut","dominos","papa johns","chipotle","panera","whole foods","target"
]);

/**
 * Normalize a candidate for matching (lowercase, trim, collapse spaces, strip punctuation except & and ').
 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/["""()!?.,:;]|'/g, "'")
    .replace(/[^a-z0-9'&\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Heuristic: capitalized phrase extractor.
 * Matches sequences like "Di Fara Pizza", "Joe's Shanghai", "Lucali", "Prince Street Pizza"
 */
export function extractCandidates(text: string): ExtractCandidate[] {
  const candidates: ExtractCandidate[] = [];

  // Quick cleanup to reduce noise
  const safe = text.replace(/\n+/g, " ").replace(/\s{2,}/g, " ");

  // Regex:
  // - Start with uppercase or Titlecase token
  // - Allow apostrophes, ampersand, hyphen inside tokens
  // - 1 to 4 tokens long
  const re = /\b([A-Z][a-zA-Z'&\-]+(?:\s+[A-Z][a-zA-Z'&\-]+){0,3})(?:\s+(?:Pizza|Ramen|BBQ|Taqueria|Cafe|Diner|Bar|Grill|Bakery|Bagels?|Deli|Sushi|Bistro|Steakhouse|Noodles?|Pizzeria))?\b/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(safe)) !== null) {
    const raw = m[0].trim();

    // Filter obvious non-names (start with common stopwords)
    const first = raw.split(/\s+/)[0].toLowerCase();
    if (STOPWORDS.has(first)) continue;

    // Very short or very long filters
    if (raw.length < 3 || raw.length > 60) continue;

    const norm = normalizeName(raw);
    if (norm.split(" ").length > 6) continue; // overly long phrases

    // Block common chains
    if (BLOCKED_CHAINS.has(norm)) continue;

    const lastWord = norm.split(" ").slice(-1)[0];
    const hasFoodWord = FOOD_SUFFIXES.includes(lastWord);

    candidates.push({
      raw,
      norm,
      start: m.index,
      end: m.index + raw.length,
      hasFoodWord
    });
  }

  // Deduplicate by normalized form
  const seen = new Set<string>();
  const unique: ExtractCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.norm)) continue;
    seen.add(c.norm);
    unique.push(c);
  }
  return unique;
}
