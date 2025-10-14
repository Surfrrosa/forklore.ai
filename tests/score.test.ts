import { describe, it, expect } from "vitest";
import { rankRestaurants, DEFAULT_PARAMS, Mention } from "../lib/score";

describe("scoring", () => {
  it("ranks by score and enforces evidence rules", () => {
    const nowMentions: Mention[] = [
      { commentUpvotes: 120, postUpvotes: 300, ageDays: 5, contextChars: 300, threadId: "t1" },
      { commentUpvotes: 40, postUpvotes: 50, ageDays: 2, contextChars: 150, threadId: "t2" },
    ];
    const weakMentions: Mention[] = [
      { commentUpvotes: 2, postUpvotes: 5, ageDays: 80, contextChars: 60, threadId: "t3" },
    ];

    const ranked = rankRestaurants(
      [
        { name: "Lucali", mentions: nowMentions },
        { name: "Random Spot", mentions: weakMentions }, // should fail evidence rule
      ],
      DEFAULT_PARAMS
    );

    expect(ranked.length).toBe(1);
    expect(ranked[0].name).toBe("Lucali");
    expect(ranked[0].uniqueThreads).toBe(2);
    expect(ranked[0].last30dMentions).toBeGreaterThan(0);
  });
});
