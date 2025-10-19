/**
 * Test endpoint for restaurant name extraction
 * POST with { "text": "..." }
 */

import { NextResponse } from "next/server";
import { extractCandidates } from "@/lib/extractor";
import { NYC_SEED } from "@/lib/gazetteer";
import { resolveDeterministic } from "@/lib/resolver";

export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }

    const candidates = extractCandidates(text);
    const resolved = candidates.map(c => {
      const match = resolveDeterministic(c.norm, NYC_SEED);
      return {
        raw: c.raw,
        norm: c.norm,
        hasFoodWord: c.hasFoodWord,
        resolvedId: match?.id ?? null,
        resolvedName: match?.name ?? null,
      };
    });

    return NextResponse.json({ candidates: resolved });
  } catch (error) {
    console.error("Extract error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
