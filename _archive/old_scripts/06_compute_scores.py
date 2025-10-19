#!/usr/bin/env python3
"""
Scoring engine for Forklore.ai
Computes iconic_score and trending_score for all restaurants

Runs monthly as a batch job to recompute PlaceAggregation table

Usage: python scripts/06_compute_scores.py
"""

import os
import math
from datetime import datetime, timedelta
from typing import List, Dict, Tuple
import psycopg2
from psycopg2.extras import execute_batch
from decimal import Decimal

# Scoring parameters (matching lib/score.ts logic)
HALF_LIFE_DAYS = 45
TRENDING_WINDOW_DAYS = 90
MIN_THREADS = 2
MIN_TOTAL_UPVOTES = 10


def recency_decay(age_days: float, half_life: float = HALF_LIFE_DAYS) -> float:
    """Exponential decay: exp(-ln(2) * age / halfLife)"""
    k = math.log(2) / half_life
    return math.exp(-k * age_days)


def mention_score(
    comment_upvotes: int,
    post_upvotes: int,
    age_days: float,
    context_chars: int
) -> float:
    """
    Score a single mention

    Uses sqrt instead of log to preserve upvote impact
    Reduces context boost to prevent verbose comment inflation
    """
    # Upvote weight with mild dampening
    upvote_weight = math.sqrt(comment_upvotes + 1) + 0.3 * math.sqrt(post_upvotes + 1)

    # Recency decay
    decay = recency_decay(age_days)

    # Context quality (max 30% boost for very long comments)
    context_boost = 1.0 + min(0.3, context_chars / 10000)

    return upvote_weight * decay * context_boost


def compute_restaurant_scores(place_id: str, mentions: List[Dict]) -> Dict:
    """
    Compute aggregated scores for a restaurant

    Returns:
    - iconic_score: All-time score (entire history)
    - trending_score: Recent score (last 90 days)
    - mentions_90d: Count of mentions in last 90 days
    - unique_threads: Count of unique discussion threads
    - total_mentions: Total mention count
    - total_upvotes: Sum of all upvotes
    - last_seen: Most recent mention timestamp
    - top_snippets: Top 3 snippets with permalinks
    """

    if not mentions:
        return None

    # Extract unique thread IDs
    unique_threads = len(set(m["post_id"] for m in mentions))

    # Total upvotes
    total_upvotes = sum(m["score"] for m in mentions)

    # Evidence rule: must have ≥2 threads OR ≥10 total upvotes
    if unique_threads < MIN_THREADS and total_upvotes < MIN_TOTAL_UPVOTES:
        return None

    now = datetime.now()

    # Compute scores
    iconic_score = 0.0
    trending_score = 0.0
    mentions_90d = 0

    for mention in mentions:
        age_days = (now - mention["timestamp"]).days
        context_chars = len(mention["snippet"])

        score = mention_score(
            mention["score"],
            mention.get("post_upvotes", 0),
            age_days,
            context_chars
        )

        # Iconic score: all mentions
        iconic_score += score

        # Trending score: only last 90 days
        if age_days <= TRENDING_WINDOW_DAYS:
            trending_score += score
            mentions_90d += 1

    # Get top 3 snippets (highest upvoted)
    top_mentions = sorted(mentions, key=lambda m: m["score"], reverse=True)[:3]
    top_snippets = [
        {
            "text": m["snippet"][:200],  # Truncate to 200 chars
            "score": m["score"],
            "permalink": f"https://reddit.com/r/{m['subreddit']}/comments/{m['post_id'].replace('t3_', '')}"
                        + (f"/_/{m['comment_id'].replace('t1_', '')}" if m.get("comment_id") else "")
        }
        for m in top_mentions
    ]

    # Most recent mention
    last_seen = max(m["timestamp"] for m in mentions)

    return {
        "place_id": place_id,
        "iconic_score": round(iconic_score, 2),
        "trending_score": round(trending_score, 2),
        "mentions_90d": mentions_90d,
        "unique_threads": unique_threads,
        "total_mentions": len(mentions),
        "total_upvotes": total_upvotes,
        "last_seen": last_seen,
        "top_snippets": top_snippets
    }


def recompute_all_scores():
    """
    Batch job: recompute scores for all restaurants
    """

    DATABASE_URL = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL environment variable not set")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    print("📊 Fetching all mentions from Postgres...")

    # Fetch all mentions grouped by place
    cur.execute("""
        SELECT
            rm."placeId",
            rm.subreddit,
            rm."postId",
            rm."commentId",
            rm.score,
            rm.timestamp,
            rm.snippet
        FROM "RedditMention" rm
        ORDER BY rm."placeId"
    """)

    rows = cur.fetchall()
    print(f"📝 Processing {len(rows)} mentions...")

    # Group by place_id
    mentions_by_place: Dict[str, List[Dict]] = {}

    for row in rows:
        place_id, subreddit, post_id, comment_id, score, timestamp, snippet = row

        if place_id not in mentions_by_place:
            mentions_by_place[place_id] = []

        mentions_by_place[place_id].append({
            "subreddit": subreddit,
            "post_id": post_id,
            "comment_id": comment_id,
            "score": score,
            "timestamp": timestamp,
            "snippet": snippet
        })

    print(f"📍 Computing scores for {len(mentions_by_place)} restaurants...")

    # Compute scores for each restaurant
    aggregations = []

    for place_id, mentions in mentions_by_place.items():
        agg = compute_restaurant_scores(place_id, mentions)

        if agg:  # Only include restaurants that pass evidence rule
            aggregations.append(agg)

    print(f"✅ Computed scores for {len(aggregations)} restaurants")
    print(f"   (Filtered out {len(mentions_by_place) - len(aggregations)} low-evidence restaurants)")

    # Insert into PlaceAggregation table
    print("💾 Updating PlaceAggregation table...")

    # Clear existing aggregations
    cur.execute('DELETE FROM "PlaceAggregation"')

    # Insert new aggregations
    if aggregations:
        import json

        execute_batch(cur, """
            INSERT INTO "PlaceAggregation" (
                "placeId", "iconicScore", "trendingScore", "mentions90d",
                "uniqueThreads", "totalMentions", "totalUpvotes",
                "lastSeen", "topSnippets", "computedAt"
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        """, [
            (
                agg["place_id"],
                Decimal(str(agg["iconic_score"])),
                Decimal(str(agg["trending_score"])),
                agg["mentions_90d"],
                agg["unique_threads"],
                agg["total_mentions"],
                agg["total_upvotes"],
                agg["last_seen"],
                json.dumps(agg["top_snippets"])
            )
            for agg in aggregations
        ])

    conn.commit()

    # Refresh materialized views
    print("🔄 Refreshing materialized views...")

    cur.execute("SELECT refresh_all_materialized_views();")
    conn.commit()

    cur.close()
    conn.close()

    print("✅ Score computation complete!")
    print("")
    print("📊 Summary:")
    print(f"   Total restaurants: {len(aggregations)}")
    print(f"   Total mentions: {len(rows)}")
    print("")
    print("Next steps:")
    print("  1. Deploy new API endpoints (Next.js)")
    print("  2. Test queries: SELECT * FROM mv_top_iconic_by_city WHERE city_id = '...'")


if __name__ == "__main__":
    recompute_all_scores()
