/**
 * Bucketer: Converts Reddit data + extracted candidates → Mention[] for scoring
 *
 * Takes Reddit posts/comments with extracted restaurant names and converts them
 * into the Mention format that the scoring algorithm expects.
 */

import type { ExtractCandidate } from "./extractor";
import type { Canonical } from "./resolver";
import type { Mention } from "./score";

/** A single Reddit text source we consider a "mention site" */
export type Source = {
  threadId: string;
  postUpvotes: number;
  commentUpvotes: number;
  createdUtc: number; // seconds
  text: string;
};

/** Build ageDays from UTC seconds */
function ageDaysFromUtc(createdUtc: number): number {
  const nowSec = Math.floor(Date.now() / 1000);
  const diffSec = Math.max(0, nowSec - createdUtc);
  return diffSec / 86400;
}

/** Create a context snippet length in chars */
function contextChars(text: string, span: { start: number; end: number }) {
  const left = Math.max(0, span.start - 120);
  const right = Math.min(text.length, span.end + 120);
  const snippet = text.slice(left, right);
  return snippet.length;
}

/** Bucket mentions by canonical id, return map of id -> Mention[] */
export function bucketMentions(
  sources: Source[],
  resolve: (norm: string) => Canonical | null,
  extract: (text: string) => ExtractCandidate[]
): Map<string, Mention[]> {
  const buckets = new Map<string, Mention[]>();

  for (const s of sources) {
    const candidates = extract(s.text);

    for (const c of candidates) {
      const canon = resolve(c.norm);
      if (!canon || !canon.id) continue;

      const m: Mention = {
        commentUpvotes: s.commentUpvotes,
        postUpvotes: s.postUpvotes,
        ageDays: ageDaysFromUtc(s.createdUtc),
        contextChars: contextChars(s.text, { start: c.start, end: c.end }),
        threadId: s.threadId,
      };

      const arr = buckets.get(canon.id) ?? [];
      arr.push(m);
      buckets.set(canon.id, arr);
    }
  }

  return buckets;
}
