-- Enable pg_trgm extension and create trigram index for fuzzy search
-- This enables fast similarity() queries on restaurant names

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index on nameNorm for trigram similarity search
CREATE INDEX IF NOT EXISTS idx_place_name_trgm
  ON "Place" USING gin ("nameNorm" gin_trgm_ops);

-- Verify extensions
SELECT extname, extversion FROM pg_extension WHERE extname IN ('postgis', 'pg_trgm');
