/**
 * Pure scoring utilities for ForkLore.
 * No IO. No globals. Fully testable.
 */

export type Mention = {
  commentUpvotes: number;     // upvotes on the specific comment
  postUpvotes: number;        // upvotes on the parent post
  ageDays: number;            // age of the mention in days
  contextChars: number;       // length of the snippet we will show
  threadId: string;           // reddit thread id for uniqueness
};

export type RestaurantAccum = {
  name: string;
  mentions: number;
  uniqueThreads: number;
  totalUpvotes: number; // sum of comment + post upvotes across mentions
  last30dMentions: number;
  score: number;
};

export type ScoreParams = {
  halfLifeDays: number;       // recency half-life (e.g., 45)
  maxContextBoost: number;    // e.g., 1.5
  baseContextBoost: number;   // e.g., 0.8
  contextPerChar: number;     // e.g., 0.001
  minThreads: number;         // min unique threads to qualify
  orMinTotalUpvotes: number;  // or a single high-evidence threshold
  last30dWindow: number;      // 30
};

/** Reasonable defaults for MVP (tuned for better recall) */
export const DEFAULT_PARAMS: ScoreParams = {
  halfLifeDays: 45,
  maxContextBoost: 1.5,
  baseContextBoost: 0.8,
  contextPerChar: 0.001,
  minThreads: 2,
  orMinTotalUpvotes: 10,  // Lowered to account for only counting direct mention upvotes
  last30dWindow: 30,
};

export function recencyDecay(ageDays: number, halfLifeDays: number): number {
  // exp(-ln(2) * age / halfLife)
  const k = Math.log(2) / halfLifeDays;
  return Math.exp(-k * ageDays);
}

export function contextQuality(chars: number, base: number, perChar: number, cap: number): number {
  return Math.min(cap, base + perChar * Math.max(0, chars));
}

export function mentionScore(m: Mention, p: ScoreParams): number {
  // More intuitive scoring: upvotes matter linearly (with mild dampening)
  // Use sqrt instead of log to preserve more upvote impact
  const upvoteWeight = Math.sqrt(m.commentUpvotes + 1) + 0.3 * Math.sqrt(m.postUpvotes + 1);
  const decay = recencyDecay(m.ageDays, p.halfLifeDays);

  // Reduce context boost influence - it was artificially inflating verbose comments
  const cq = 1.0 + Math.min(0.3, m.contextChars / 10000); // Max 30% boost for very long comments

  return upvoteWeight * decay * cq;
}

/**
 * Aggregate mentions for a restaurant and compute its final score.
 * Returns null if restaurant does not meet evidence thresholds.
 */
export function scoreRestaurant(
  name: string,
  mentions: Mention[],
  p: ScoreParams = DEFAULT_PARAMS
): RestaurantAccum | null {
  if (mentions.length === 0) return null;

  const uniqueThreads = new Set(mentions.map(m => m.threadId)).size;
  const totalUpvotes = mentions.reduce((acc, m) => acc + m.commentUpvotes + m.postUpvotes, 0);
  const last30dMentions = mentions.filter(m => m.ageDays <= p.last30dWindow).length;

  // Evidence rule
  const passesEvidence = uniqueThreads >= p.minThreads || totalUpvotes >= p.orMinTotalUpvotes;
  if (!passesEvidence) return null;

  const score = mentions.reduce((acc, m) => acc + mentionScore(m, p), 0);

  // Filter out broken aggregates with invalid scores
  if (!Number.isFinite(score)) return null;

  return {
    name,
    mentions: mentions.length,
    uniqueThreads,
    totalUpvotes,
    last30dMentions,
    score,
  };
}

/**
 * Rank multiple restaurants. Filters out those that fail evidence rule.
 */
export function rankRestaurants(
  input: { name: string; mentions: Mention[] }[],
  p: ScoreParams = DEFAULT_PARAMS
): RestaurantAccum[] {
  const scored = input
    .map(r => scoreRestaurant(r.name, r.mentions, p))
    .filter((x): x is RestaurantAccum => x !== null);

  // Sort by score desc, then by totalUpvotes desc, then by mentions desc
  return scored.sort((a, b) =>
    b.score !== a.score ? b.score - a.score :
    b.totalUpvotes !== a.totalUpvotes ? b.totalUpvotes - a.totalUpvotes :
    b.mentions - a.mentions
  );
}
