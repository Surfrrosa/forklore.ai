#!/bin/bash
#
# DuckDB ETL Pipeline: Pushshift + Overture → Postgres
#
# Usage: ./03_etl_pipeline.sh [YYYY-MM]
#
# Steps:
# 1. Load Overture Places (GeoParquet from Azure)
# 2. Filter to target cities + food establishments
# 3. Load Pushshift Reddit data (zst compressed NDJSON)
# 4. Extract restaurant mentions with NER
# 5. Match mentions to Overture places
# 6. Export to CSV for Postgres COPY
# 7. Load into Neon Postgres
#

set -e

YEAR_MONTH=${1:-"2024-12"}
DATA_DIR="./data"
OUTPUT_DIR="./data/csv_export"

mkdir -p "$OUTPUT_DIR"

echo "🦆 Starting DuckDB ETL pipeline for $YEAR_MONTH..."
echo ""

# Create DuckDB ETL script
cat > "$OUTPUT_DIR/etl.sql" << 'EOF'
-- Install required extensions
INSTALL httpfs;
INSTALL spatial;
INSTALL json;

LOAD httpfs;
LOAD spatial;
LOAD json;

-- Configure Azure access (public data, no auth needed)
SET azure_storage_connection_string = '';

-- ============================================================================
-- STEP 1: Load Overture Places (restaurants only)
-- ============================================================================

CREATE TABLE overture_places AS
SELECT
    id AS overture_id,
    names.primary AS name,
    ST_AsText(geometry) AS geom_wkt,
    categories.primary AS category,
    addresses[1].freeform AS address,
    addresses[1].locality AS city,
    addresses[1].region AS state,
    addresses[1].country AS country
FROM read_parquet(
    'https://overturemaps.blob.core.windows.net/release/2025-10-16.0/theme=places/type=restaurant/*.parquet',
    hive_partitioning = true
)
WHERE
    -- Filter to US cities we care about
    addresses[1].country = 'US'
    AND addresses[1].locality IN (
        'New York', 'Brooklyn', 'Queens', 'Bronx', 'Manhattan',
        'San Francisco', 'Los Angeles', 'Chicago', 'Austin',
        'Seattle', 'Portland', 'Boston', 'Philadelphia', 'Denver',
        'Miami', 'Atlanta'
    )
    -- Filter to food establishments
    AND (
        categories.primary LIKE '%restaurant%'
        OR categories.primary LIKE '%cafe%'
        OR categories.primary LIKE '%bar%'
        OR categories.primary LIKE '%food%'
    );

CREATE INDEX idx_overture_city ON overture_places(city);
CREATE INDEX idx_overture_name ON overture_places(name);

-- ============================================================================
-- STEP 2: Load Pushshift Reddit data
-- ============================================================================

-- Load comments
CREATE TABLE reddit_comments AS
SELECT
    json_extract_string(value, '$.id') AS comment_id,
    json_extract_string(value, '$.link_id') AS post_id,
    json_extract_string(value, '$.subreddit') AS subreddit,
    json_extract_string(value, '$.body') AS body,
    CAST(json_extract_string(value, '$.score') AS INTEGER) AS score,
    CAST(json_extract_string(value, '$.created_utc') AS INTEGER) AS created_utc
FROM read_ndjson_auto('data/pushshift/RC_*.zst', compression = 'zstd')
WHERE
    -- Filter to food-related subreddits
    subreddit IN (
        'FoodNYC', 'AskNYC', 'nyc',
        'sanfrancisco', 'AskSF', 'bayarea',
        'FoodLosAngeles', 'AskLosAngeles', 'losangeles',
        'chicagofood', 'AskChicago', 'chicago',
        'austinfood', 'Austin',
        'SeattleFood', 'AskSeattle', 'Seattle',
        'FoodPortland', 'askportland', 'Portland',
        'BostonFood', 'boston',
        'FoodPhilly', 'philadelphia',
        'denverfood', 'Denver',
        'FoodMiami', 'miami',
        'ATLFoodies', 'Atlanta'
    )
    AND body IS NOT NULL
    AND LENGTH(body) > 20;

CREATE INDEX idx_comments_subreddit ON reddit_comments(subreddit);

-- Load submissions (posts)
CREATE TABLE reddit_posts AS
SELECT
    json_extract_string(value, '$.id') AS post_id,
    json_extract_string(value, '$.subreddit') AS subreddit,
    json_extract_string(value, '$.title') AS title,
    json_extract_string(value, '$.selftext') AS selftext,
    CAST(json_extract_string(value, '$.score') AS INTEGER) AS score,
    CAST(json_extract_string(value, '$.created_utc') AS INTEGER) AS created_utc
FROM read_ndjson_auto('data/pushshift/RS_*.zst', compression = 'zstd')
WHERE
    subreddit IN (
        'FoodNYC', 'AskNYC', 'nyc',
        'sanfrancisco', 'AskSF', 'bayarea',
        'FoodLosAngeles', 'AskLosAngeles', 'losangeles',
        'chicagofood', 'AskChicago', 'chicago',
        'austinfood', 'Austin',
        'SeattleFood', 'AskSeattle', 'Seattle',
        'FoodPortland', 'askportland', 'Portland',
        'BostonFood', 'boston',
        'FoodPhilly', 'philadelphia',
        'denverfood', 'Denver',
        'FoodMiami', 'miami',
        'ATLFoodies', 'Atlanta'
    );

-- ============================================================================
-- STEP 3: Extract restaurant candidates with regex (simplified NER)
-- ============================================================================
-- Note: Full NER with spaCy will be done in Python pipeline
-- This is a simplified version for MVP

CREATE TABLE restaurant_candidates AS
WITH capitalized_words AS (
    SELECT DISTINCT
        regexp_extract(body, '([A-Z][a-z]+(?: [A-Z][a-z]+)*)', 1) AS candidate,
        subreddit,
        comment_id,
        score,
        created_utc,
        body
    FROM reddit_comments
    WHERE regexp_extract(body, '([A-Z][a-z]+(?: [A-Z][a-z]+)*)', 1) IS NOT NULL
    UNION ALL
    SELECT DISTINCT
        regexp_extract(title || ' ' || selftext, '([A-Z][a-z]+(?: [A-Z][a-z]+)*)', 1) AS candidate,
        subreddit,
        post_id AS comment_id,
        score,
        created_utc,
        title || ' ' || selftext AS body
    FROM reddit_posts
    WHERE regexp_extract(title || ' ' || selftext, '([A-Z][a-z]+(?: [A-Z][a-z]+)*)', 1) IS NOT NULL
)
SELECT
    candidate,
    subreddit,
    comment_id,
    score,
    created_utc,
    SUBSTRING(body, GREATEST(1, POSITION(candidate IN body) - 100), 200) AS snippet
FROM capitalized_words
WHERE
    LENGTH(candidate) >= 3
    AND candidate NOT IN ('Reddit', 'Edit', 'Update', 'Thanks', 'Yes', 'No', 'The', 'This', 'That');

-- ============================================================================
-- STEP 4: Fuzzy match candidates to Overture Places
-- ============================================================================

CREATE TABLE matched_mentions AS
SELECT
    op.overture_id,
    op.name AS official_name,
    op.city,
    op.address,
    op.geom_wkt,
    rc.candidate AS mention_text,
    rc.subreddit,
    rc.comment_id,
    rc.score,
    rc.created_utc,
    rc.snippet
FROM restaurant_candidates rc
JOIN overture_places op
    ON LOWER(rc.candidate) = LOWER(op.name)
    OR LOWER(rc.candidate) LIKE '%' || LOWER(op.name) || '%'
    OR LOWER(op.name) LIKE '%' || LOWER(rc.candidate) || '%';

-- ============================================================================
-- STEP 5: Export to CSV for Postgres COPY
-- ============================================================================

-- Export City dimension
COPY (
    SELECT DISTINCT
        city AS name,
        country,
        NULL AS bbox  -- Will be computed in Postgres
    FROM overture_places
) TO 'data/csv_export/cities.csv' (HEADER, DELIMITER ',');

-- Export Place dimension
COPY (
    SELECT
        overture_id,
        name,
        LOWER(REGEXP_REPLACE(name, '[^a-z0-9]+', ' ', 'g')) AS name_norm,
        city,
        geom_wkt,
        address,
        ARRAY[category] AS cuisine
    FROM overture_places
) TO 'data/csv_export/places.csv' (HEADER, DELIMITER ',');

-- Export Mentions fact table
COPY (
    SELECT
        overture_id AS place_id,
        subreddit,
        't3_' || SUBSTRING(comment_id, 1, 10) AS post_id,
        CASE WHEN LENGTH(comment_id) > 10 THEN 't1_' || comment_id ELSE NULL END AS comment_id,
        score,
        to_timestamp(created_utc) AS timestamp,
        snippet
    FROM matched_mentions
) TO 'data/csv_export/mentions.csv' (HEADER, DELIMITER ',');

EOF

echo "📝 Created ETL script: $OUTPUT_DIR/etl.sql"
echo ""
echo "🦆 Running DuckDB ETL..."

# Run DuckDB
duckdb -s "$(cat $OUTPUT_DIR/etl.sql)"

echo ""
echo "✅ DuckDB ETL complete!"
echo "📊 CSV files exported to: $OUTPUT_DIR/"
echo ""
echo "Next steps:"
echo "  1. Load CSVs into Postgres: psql \$DATABASE_URL -f scripts/04_load_postgres.sql"
echo "  2. Run NER extraction: python scripts/05_ner_extraction.py"
echo "  3. Compute scores: python scripts/06_compute_scores.py"
