#!/usr/bin/env python3
"""
Named Entity Recognition pipeline for restaurant mentions
Uses spaCy to extract restaurant names from Reddit text

Usage: python scripts/05_ner_extraction.py
"""

import os
import re
from typing import List, Dict, Set
import spacy
from spacy.tokens import Span
import psycopg2
from psycopg2.extras import execute_batch

# Load spaCy model
print("🔧 Loading spaCy model...")
nlp = spacy.load("en_core_web_sm")

# Food-related keywords that signal restaurant context
FOOD_KEYWORDS = {
    "restaurant", "cafe", "deli", "pizza", "burger", "sushi", "ramen",
    "taco", "bbq", "steakhouse", "bagel", "sandwich", "diner", "bakery",
    "bar", "pub", "bistro", "grill", "kitchen", "eatery", "joint",
    "brunch", "breakfast", "lunch", "dinner", "food", "eat", "meal"
}

def is_likely_restaurant(text: str, entity: Span) -> bool:
    """
    Heuristics to determine if an entity is likely a restaurant name

    Rules:
    1. Entity must be ORG, PERSON, or GPE (some restaurants named after places)
    2. Must be capitalized
    3. Should be near food-related keywords
    4. Should not be common non-restaurant entities
    """

    # Rule 1: Check entity type
    if entity.label_ not in ("ORG", "PERSON", "GPE", "PRODUCT"):
        return False

    # Rule 2: Must be capitalized
    if not entity.text[0].isupper():
        return False

    # Rule 3: Check for food context in surrounding text
    # Look at ±50 characters around the entity
    start_idx = max(0, entity.start_char - 50)
    end_idx = min(len(text), entity.end_char + 50)
    context = text[start_idx:end_idx].lower()

    has_food_context = any(keyword in context for keyword in FOOD_KEYWORDS)

    # Rule 4: Filter out common false positives
    FALSE_POSITIVES = {
        "reddit", "edit", "update", "thanks", "yes", "no", "the", "this",
        "that", "google", "yelp", "uber", "doordash", "grubhub",
        "new york", "san francisco", "los angeles", "brooklyn", "manhattan"
    }

    if entity.text.lower() in FALSE_POSITIVES:
        return False

    return has_food_context


def extract_restaurant_names(text: str) -> List[str]:
    """
    Extract restaurant names from text using spaCy NER
    """
    doc = nlp(text)
    candidates = []

    for ent in doc.ents:
        if is_likely_restaurant(text, ent):
            # Normalize: remove punctuation, extra spaces
            name = re.sub(r'[^\w\s]', '', ent.text).strip()
            if len(name) >= 3:  # Minimum 3 characters
                candidates.append(name)

    return list(set(candidates))  # Deduplicate


def process_reddit_data():
    """
    Process Reddit comments/posts from Postgres and extract restaurant mentions
    """

    # Connect to Neon Postgres
    DATABASE_URL = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL environment variable not set")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    print("📊 Fetching Reddit data from Postgres...")

    # For MVP: process all mentions that don't have NER extraction yet
    # In production: this would be incremental/streaming

    cur.execute("""
        SELECT DISTINCT
            rm."postId",
            rm."commentId",
            rm.subreddit,
            rm.snippet,
            rm.score,
            rm.timestamp
        FROM "RedditMention" rm
        LIMIT 10000  -- Process in batches
    """)

    rows = cur.fetchall()
    print(f"📝 Processing {len(rows)} Reddit texts...")

    # Extract candidates
    extracted_names: Dict[str, List[Dict]] = {}  # name -> list of mentions

    for row in rows:
        post_id, comment_id, subreddit, snippet, score, timestamp = row

        # Extract restaurant names
        names = extract_restaurant_names(snippet)

        for name in names:
            name_norm = name.lower()

            if name_norm not in extracted_names:
                extracted_names[name_norm] = []

            extracted_names[name_norm].append({
                "text": snippet,
                "post_id": post_id,
                "comment_id": comment_id,
                "subreddit": subreddit,
                "score": score,
                "timestamp": timestamp
            })

    print(f"✅ Extracted {len(extracted_names)} unique restaurant candidates")

    # Match to Overture Places using fuzzy matching
    print("🔍 Matching to Overture Places...")

    # Use pg_trgm similarity for fuzzy matching
    matched_mentions = []

    for candidate_name, mentions in extracted_names.items():
        # Find best match in Place table using trigram similarity
        cur.execute("""
            SELECT id, name, "nameNorm", similarity("nameNorm", %s) as sim
            FROM "Place"
            WHERE similarity("nameNorm", %s) > 0.6  -- 60% similarity threshold
            ORDER BY sim DESC
            LIMIT 1
        """, (candidate_name, candidate_name))

        match = cur.fetchone()

        if match:
            place_id, official_name, name_norm, similarity = match

            # Create mention records
            for mention in mentions:
                matched_mentions.append((
                    place_id,
                    mention["subreddit"],
                    mention["post_id"],
                    mention["comment_id"],
                    mention["score"],
                    mention["timestamp"],
                    mention["text"]
                ))

    print(f"✅ Matched {len(matched_mentions)} mentions to existing places")

    # Insert matched mentions into database
    if matched_mentions:
        print("💾 Inserting matched mentions...")

        execute_batch(cur, """
            INSERT INTO "RedditMention" (
                id, "placeId", subreddit, "postId", "commentId",
                score, timestamp, snippet, "createdAt"
            )
            VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT DO NOTHING
        """, matched_mentions)

        conn.commit()

    cur.close()
    conn.close()

    print("✅ NER extraction complete!")


if __name__ == "__main__":
    process_reddit_data()
