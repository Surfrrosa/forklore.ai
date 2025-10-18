-- Seed Subreddit table with NYC subreddits mapped to New York city
-- This enables the ingestion script to know which city each subreddit covers

INSERT INTO "Subreddit" (name, "cityIds", "lastSync", "totalPosts", "isActive")
SELECT
  sub.name,
  ARRAY[c.id]::text[],
  NOW() - INTERVAL '1 year', -- Will update after first sync
  0,
  true
FROM (VALUES
  ('nyc'),
  ('AskNYC'),
  ('FoodNYC'),
  ('newyork')
) AS sub(name)
CROSS JOIN (SELECT id FROM "City" WHERE name ILIKE 'New York' LIMIT 1) c
ON CONFLICT (name) DO UPDATE
SET "cityIds" = EXCLUDED."cityIds",
    "isActive" = true;

-- Verify
SELECT name, "cityIds", "isActive" FROM "Subreddit";
