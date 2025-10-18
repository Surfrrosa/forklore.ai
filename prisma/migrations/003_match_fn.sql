-- Create helper function to match restaurant names from Reddit text
-- Uses trigram similarity to find best matching Place for a given text snippet

CREATE OR REPLACE FUNCTION match_place_for_text(
  p_city_id text,
  p_text text,
  p_min float DEFAULT 0.42
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

-- Test the function (should return a place ID if match found)
SELECT match_place_for_text(
  (SELECT id FROM "City" WHERE name = 'New York' LIMIT 1),
  'I love Katz Delicatessen',
  0.3
);
