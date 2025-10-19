-- Migration: 010_city_aliases
-- Description: Add city alias table for location normalization
-- Date: 2025-10-18
-- Impact: Improves search UX by normalizing "nyc", "manhattan", "brooklyn" → "New York"

-- Create CityAlias table
CREATE TABLE IF NOT EXISTS "CityAlias" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "cityId" TEXT NOT NULL REFERENCES "City"(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  "isBorough" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create unique index on alias (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_city_alias_unique
  ON "CityAlias" (LOWER(alias));

-- Create lookup index for fast alias resolution
CREATE INDEX IF NOT EXISTS idx_city_alias_city_id
  ON "CityAlias"("cityId");

-- Seed NYC aliases
INSERT INTO "CityAlias" ("cityId", alias, "isBorough")
SELECT
  id,
  alias_name,
  is_borough
FROM "City" c
CROSS JOIN (
  VALUES
    ('nyc', false),
    ('new york city', false),
    ('ny', false),
    ('the big apple', false),
    ('manhattan', true),
    ('brooklyn', true),
    ('queens', true),
    ('bronx', true),
    ('the bronx', true),
    ('staten island', true)
) AS aliases(alias_name, is_borough)
WHERE c.name = 'New York'
ON CONFLICT DO NOTHING;

-- Add comment
COMMENT ON TABLE "CityAlias" IS 'City and borough aliases for location normalization';
COMMENT ON COLUMN "CityAlias"."isBorough" IS 'True if alias refers to a borough/neighborhood rather than the whole city';

-- Rollback (for reference, commented out):
-- DROP TABLE IF EXISTS "CityAlias" CASCADE;
