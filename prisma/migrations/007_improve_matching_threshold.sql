-- Migration 007: Improve fuzzy matching accuracy
-- Raise threshold from 0.42 to 0.55 to reduce false positives
-- Also set global pg_trgm similarity threshold

-- Set global similarity threshold for pg_trgm % operator
-- This affects the % operator used in WHERE clauses
SET pg_trgm.similarity_threshold = 0.55;

-- Update the match function with new default threshold
CREATE OR REPLACE FUNCTION match_place_for_text(
  p_city_id text,
  p_text text,
  p_min float DEFAULT 0.55
)
RETURNS text
LANGUAGE sql STABLE AS $$
  WITH candidates AS (
    SELECT
      p.id,
      similarity(p."nameNorm", lower(regexp_replace(p_text, '[^a-z0-9]+', ' ', 'g'))) AS sim
    FROM "Place" p
    WHERE p."cityId" = p_city_id
      AND p.status = 'active'
      AND p."nameNorm" % lower(regexp_replace(p_text, '[^a-z0-9]+', ' ', 'g'))
  )
  SELECT id::text FROM candidates
  WHERE sim >= p_min
  ORDER BY sim DESC
  LIMIT 1
$$;

-- Verify the change
SELECT
  'match_place_for_text' as function_name,
  'Updated default threshold to 0.55' as change,
  'Reduces false positives in Reddit mention matching' as impact;
