--
-- PostgreSQL database dump
--

\restrict v9srcvcJ9ecy8MrpNYokdop2F6AfSzhyOAdLmwDRMEhdOcCtee10XnA4L2fCQHq

-- Dumped from database version 17.5 (6bc9ef8)
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: job_status; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.job_status AS ENUM (
    'queued',
    'running',
    'done',
    'error'
);


ALTER TYPE public.job_status OWNER TO neondb_owner;

--
-- Name: place_source; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.place_source AS ENUM (
    'overture',
    'osm',
    'bootstrap'
);


ALTER TYPE public.place_source OWNER TO neondb_owner;

--
-- Name: place_status; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.place_status AS ENUM (
    'open',
    'closed',
    'unverified'
);


ALTER TYPE public.place_status OWNER TO neondb_owner;

--
-- Name: compute_all_place_aggregations(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.compute_all_place_aggregations() RETURNS TABLE(place_id text, iconic numeric, trending numeric, updated integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  place_record RECORD;
  iconic_val NUMERIC;
  trending_val NUMERIC;
  count INT := 0;
BEGIN
  FOR place_record IN
    SELECT DISTINCT p.id
    FROM "Place" p
    WHERE p.status = 'open'
  LOOP
    -- Compute scores
    iconic_val := compute_iconic_score(place_record.id);
    trending_val := compute_trending_score(place_record.id);

    -- Upsert aggregation
    INSERT INTO "PlaceAggregation" AS pa (
      place_id,
      iconic_score,
      trending_score,
      unique_threads,
      total_mentions,
      total_upvotes,
      mentions_90d,
      last_seen,
      top_snippets,
      computed_at
    )
    SELECT
      place_record.id,
      iconic_val,
      trending_val,
      COUNT(DISTINCT post_id),
      COUNT(*),
      SUM(score),
      SUM(CASE WHEN ts >= NOW() - INTERVAL '90 days' THEN 1 ELSE 0 END),
      MAX(ts),
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'permalink', permalink,
            'score', score,
            'ts', ts,
            'excerpt_hash', encode(text_hash, 'hex'),
            'excerpt_len', text_len
          ) ORDER BY score DESC
        )
        FROM (
          SELECT permalink, score, ts, text_hash, text_len
          FROM "RedditMention"
          WHERE place_id = place_record.id
          ORDER BY score DESC
          LIMIT 3
        ) top_3
      ),
      NOW()
    FROM "RedditMention"
    WHERE place_id = place_record.id
    ON CONFLICT (place_id) DO UPDATE
      SET iconic_score = EXCLUDED.iconic_score,
          trending_score = EXCLUDED.trending_score,
          unique_threads = EXCLUDED.unique_threads,
          total_mentions = EXCLUDED.total_mentions,
          total_upvotes = EXCLUDED.total_upvotes,
          mentions_90d = EXCLUDED.mentions_90d,
          last_seen = EXCLUDED.last_seen,
          top_snippets = EXCLUDED.top_snippets,
          computed_at = EXCLUDED.computed_at;

    count := count + 1;

    RETURN QUERY SELECT place_record.id, iconic_val, trending_val, count;
  END LOOP;
END;
$$;


ALTER FUNCTION public.compute_all_place_aggregations() OWNER TO neondb_owner;

--
-- Name: FUNCTION compute_all_place_aggregations(); Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON FUNCTION public.compute_all_place_aggregations() IS 'Batch compute/update all place aggregations (idempotent)';


--
-- Name: compute_iconic_score(text, numeric, numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.compute_iconic_score(place_id_input text, alpha numeric DEFAULT 8, beta numeric DEFAULT 2, prior_mu numeric DEFAULT 3, prior_n numeric DEFAULT 10) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
  total_upvotes NUMERIC;
  total_mentions NUMERIC;
  unique_threads NUMERIC;
  first_seen TIMESTAMPTZ;
  days_since_epoch NUMERIC;
  time_norm NUMERIC;
  wilson_component NUMERIC;
  iconic NUMERIC;
BEGIN
  -- Aggregate mention stats
  SELECT
    COALESCE(SUM(score), 0),
    COUNT(*),
    COUNT(DISTINCT post_id),
    MIN(ts)
  INTO total_upvotes, total_mentions, unique_threads, first_seen
  FROM "RedditMention"
  WHERE place_id = place_id_input;

  -- Minimum threshold
  IF total_mentions < 3 THEN
    RETURN 0;
  END IF;

  -- Calculate Wilson Score component (Bayesian smoothing)
  wilson_component := wilson_score_lower_bound(
    total_upvotes + prior_mu * prior_n,
    total_mentions * 100 + prior_n,
    1.96
  );

  -- Time normalization (log decay from 2015 epoch)
  days_since_epoch := EXTRACT(EPOCH FROM (first_seen - '2015-01-01'::TIMESTAMPTZ)) / 86400;
  time_norm := GREATEST(LOG(days_since_epoch + 2), 1);

  -- Combine components
  iconic := (
    wilson_component * 1000000  -- Scale to readable range
    + alpha * unique_threads
    + beta * total_mentions
  ) / time_norm;

  RETURN ROUND(iconic, 2);
END;
$$;


ALTER FUNCTION public.compute_iconic_score(place_id_input text, alpha numeric, beta numeric, prior_mu numeric, prior_n numeric) OWNER TO neondb_owner;

--
-- Name: FUNCTION compute_iconic_score(place_id_input text, alpha numeric, beta numeric, prior_mu numeric, prior_n numeric); Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON FUNCTION public.compute_iconic_score(place_id_input text, alpha numeric, beta numeric, prior_mu numeric, prior_n numeric) IS 'Compute Wilson-smoothed iconic score with thread/mention bonuses';


--
-- Name: compute_trending_score(text, numeric, numeric, integer); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.compute_trending_score(place_id_input text, half_life_days numeric DEFAULT 14, thread_weight numeric DEFAULT 20, lookback_days integer DEFAULT 90) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
  now_ts TIMESTAMPTZ := NOW();
  cutoff_ts TIMESTAMPTZ := NOW() - (lookback_days || ' days')::INTERVAL;
  decay_sum NUMERIC := 0;
  unique_threads INT := 0;
  last_seen TIMESTAMPTZ;
  recency_mult NUMERIC := 1.0;
  mention RECORD;
BEGIN
  -- Count unique threads
  SELECT COUNT(DISTINCT post_id), MAX(ts)
  INTO unique_threads, last_seen
  FROM "RedditMention"
  WHERE place_id = place_id_input
    AND ts >= cutoff_ts;

  -- Minimum threshold
  IF unique_threads < 2 THEN
    RETURN 0;
  END IF;

  -- Sum decay-weighted mentions
  FOR mention IN
    SELECT score, ts
    FROM "RedditMention"
    WHERE place_id = place_id_input
      AND ts >= cutoff_ts
  LOOP
    DECLARE
      days_ago NUMERIC := EXTRACT(EPOCH FROM (now_ts - mention.ts)) / 86400;
      mention_weight NUMERIC := 1 + 0.02 * mention.score;  -- Upvote boost
      decay_factor NUMERIC := POWER(0.5, days_ago / half_life_days);
    BEGIN
      decay_sum := decay_sum + (mention_weight * decay_factor);
    END;
  END LOOP;

  -- Recency multiplier
  IF last_seen >= now_ts - INTERVAL '1 day' THEN
    recency_mult := 2.0;
  ELSIF last_seen >= now_ts - INTERVAL '7 days' THEN
    recency_mult := 1.5;
  END IF;

  RETURN ROUND(
    (decay_sum * 100 * recency_mult) + (thread_weight * unique_threads),
    2
  );
END;
$$;


ALTER FUNCTION public.compute_trending_score(place_id_input text, half_life_days numeric, thread_weight numeric, lookback_days integer) OWNER TO neondb_owner;

--
-- Name: FUNCTION compute_trending_score(place_id_input text, half_life_days numeric, thread_weight numeric, lookback_days integer); Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON FUNCTION public.compute_trending_score(place_id_input text, half_life_days numeric, thread_weight numeric, lookback_days integer) IS 'Compute exponential-decay trending score (14d half-life, 90d window)';


--
-- Name: refresh_all_materialized_views(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.refresh_all_materialized_views() RETURNS TABLE(view_name text, row_count bigint, duration_ms bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration BIGINT;
  rows BIGINT;
  version TEXT;
BEGIN
  -- Refresh mv_top_iconic_by_city
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_iconic_by_city;
  end_time := clock_timestamp();
  duration := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;
  GET DIAGNOSTICS rows = ROW_COUNT;
  version := md5(random()::text || clock_timestamp()::text);

  INSERT INTO "MaterializedViewVersion" (view_name, version_hash, refreshed_at, row_count)
  VALUES ('mv_top_iconic_by_city', version, NOW(), rows)
  ON CONFLICT (view_name) DO UPDATE
    SET version_hash = EXCLUDED.version_hash,
        refreshed_at = EXCLUDED.refreshed_at,
        row_count = EXCLUDED.row_count;

  RETURN QUERY SELECT 'mv_top_iconic_by_city'::TEXT, rows, duration;

  -- Refresh mv_top_trending_by_city
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_trending_by_city;
  end_time := clock_timestamp();
  duration := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;
  GET DIAGNOSTICS rows = ROW_COUNT;
  version := md5(random()::text || clock_timestamp()::text);

  INSERT INTO "MaterializedViewVersion" (view_name, version_hash, refreshed_at, row_count)
  VALUES ('mv_top_trending_by_city', version, NOW(), rows)
  ON CONFLICT (view_name) DO UPDATE
    SET version_hash = EXCLUDED.version_hash,
        refreshed_at = EXCLUDED.refreshed_at,
        row_count = EXCLUDED.row_count;

  RETURN QUERY SELECT 'mv_top_trending_by_city'::TEXT, rows, duration;

  -- Refresh mv_top_by_cuisine
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_by_cuisine;
  end_time := clock_timestamp();
  duration := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;
  GET DIAGNOSTICS rows = ROW_COUNT;
  version := md5(random()::text || clock_timestamp()::text);

  INSERT INTO "MaterializedViewVersion" (view_name, version_hash, refreshed_at, row_count)
  VALUES ('mv_top_by_cuisine', version, NOW(), rows)
  ON CONFLICT (view_name) DO UPDATE
    SET version_hash = EXCLUDED.version_hash,
        refreshed_at = EXCLUDED.refreshed_at,
        row_count = EXCLUDED.row_count;

  RETURN QUERY SELECT 'mv_top_by_cuisine'::TEXT, rows, duration;
END;
$$;


ALTER FUNCTION public.refresh_all_materialized_views() OWNER TO neondb_owner;

--
-- Name: FUNCTION refresh_all_materialized_views(); Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON FUNCTION public.refresh_all_materialized_views() IS 'Refresh all MVs concurrently and track versions for ETags';


--
-- Name: wilson_score_lower_bound(numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.wilson_score_lower_bound(upvotes numeric, total_trials numeric, confidence numeric DEFAULT 1.96) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  p NUMERIC;  -- proportion
  z NUMERIC;  -- z-score
  denominator NUMERIC;
BEGIN
  IF total_trials = 0 THEN
    RETURN 0;
  END IF;

  p := upvotes / total_trials;
  z := confidence;
  denominator := 1 + (z * z) / total_trials;

  RETURN (
    (p + (z * z) / (2 * total_trials) - z * SQRT((p * (1 - p) + (z * z) / (4 * total_trials)) / total_trials))
    / denominator
  );
END;
$$;


ALTER FUNCTION public.wilson_score_lower_bound(upvotes numeric, total_trials numeric, confidence numeric) OWNER TO neondb_owner;

--
-- Name: FUNCTION wilson_score_lower_bound(upvotes numeric, total_trials numeric, confidence numeric); Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON FUNCTION public.wilson_score_lower_bound(upvotes numeric, total_trials numeric, confidence numeric) IS 'Wilson Score lower bound for Bayesian ranking (prevents flukes)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: City; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."City" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    country text NOT NULL,
    bbox public.geometry(Polygon,4326),
    lat double precision,
    lon double precision,
    ranked boolean DEFAULT false NOT NULL,
    last_refreshed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public."City" OWNER TO neondb_owner;

--
-- Name: TABLE "City"; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public."City" IS 'Cities with coverage - supports both preloaded and bootstrapped cities';


--
-- Name: COLUMN "City".bbox; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public."City".bbox IS 'Bounding box for geo queries and Overpass fetches';


--
-- Name: COLUMN "City".ranked; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public."City".ranked IS 'True if city has Reddit data and rankings; false for bootstrap-only';


--
-- Name: CityAlias; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."CityAlias" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    city_id text NOT NULL,
    alias text NOT NULL,
    is_borough boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public."CityAlias" OWNER TO neondb_owner;

--
-- Name: TABLE "CityAlias"; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public."CityAlias" IS 'City and borough aliases for query normalization';


--
-- Name: JobQueue; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."JobQueue" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    type text NOT NULL,
    payload jsonb NOT NULL,
    status public.job_status DEFAULT 'queued'::public.job_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT job_max_attempts CHECK ((attempts <= 5))
);


ALTER TABLE public."JobQueue" OWNER TO neondb_owner;

--
-- Name: TABLE "JobQueue"; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public."JobQueue" IS 'Async job queue for bootstrap, ingestion, and aggregation tasks';


--
-- Name: COLUMN "JobQueue".type; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public."JobQueue".type IS 'Job type: bootstrap_city, ingest_reddit, compute_aggregations, refresh_mvs';


--
-- Name: MaterializedViewVersion; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."MaterializedViewVersion" (
    view_name text NOT NULL,
    version_hash text NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    row_count bigint
);


ALTER TABLE public."MaterializedViewVersion" OWNER TO neondb_owner;

--
-- Name: TABLE "MaterializedViewVersion"; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public."MaterializedViewVersion" IS 'Version tracking for materialized views (for ETag generation)';


--
-- Name: Place; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."Place" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    city_id text NOT NULL,
    overture_id text,
    osm_id text,
    name text NOT NULL,
    name_norm text NOT NULL,
    geog public.geography(Point,4326) NOT NULL,
    address text,
    cuisine text[] DEFAULT '{}'::text[] NOT NULL,
    status public.place_status DEFAULT 'open'::public.place_status NOT NULL,
    brand text,
    source public.place_source DEFAULT 'overture'::public.place_source NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public."Place" OWNER TO neondb_owner;

--
-- Name: TABLE "Place"; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public."Place" IS 'Global restaurant/cafe/bar database from Overture, OSM, and bootstrap';


--
-- Name: COLUMN "Place".name_norm; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public."Place".name_norm IS 'Normalized name for trigram matching (lowercase, no punct)';


--
-- Name: COLUMN "Place".brand; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public."Place".brand IS 'Chain brand identifier for disambiguation';


--
-- Name: COLUMN "Place".source; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public."Place".source IS 'Data source: overture (monthly), osm (curated), bootstrap (on-demand)';


--
-- Name: PlaceAggregation; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."PlaceAggregation" (
    place_id text NOT NULL,
    iconic_score numeric(10,2) DEFAULT 0 NOT NULL,
    trending_score numeric(10,2) DEFAULT 0 NOT NULL,
    unique_threads integer DEFAULT 0 NOT NULL,
    total_mentions integer DEFAULT 0 NOT NULL,
    total_upvotes integer DEFAULT 0 NOT NULL,
    mentions_90d integer DEFAULT 0 NOT NULL,
    last_seen timestamp with time zone,
    top_snippets jsonb DEFAULT '[]'::jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT place_agg_scores_positive CHECK (((iconic_score >= (0)::numeric) AND (trending_score >= (0)::numeric)))
);


ALTER TABLE public."PlaceAggregation" OWNER TO neondb_owner;

--
-- Name: TABLE "PlaceAggregation"; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public."PlaceAggregation" IS 'Pre-computed rankings and statistics per place';


--
-- Name: COLUMN "PlaceAggregation".top_snippets; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public."PlaceAggregation".top_snippets IS 'Array of {permalink, score, ts, excerpt_hash, excerpt_len}';


--
-- Name: RedditMention; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."RedditMention" (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    place_id text,
    subreddit text NOT NULL,
    post_id text NOT NULL,
    comment_id text,
    score integer NOT NULL,
    ts timestamp with time zone NOT NULL,
    permalink text NOT NULL,
    text_hash bytea NOT NULL,
    text_len integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public."RedditMention" OWNER TO neondb_owner;

--
-- Name: TABLE "RedditMention"; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public."RedditMention" IS 'Reddit mentions with metadata only (ToS compliant)';


--
-- Name: COLUMN "RedditMention".text_hash; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public."RedditMention".text_hash IS 'SHA256 hash of original text for deduplication';


--
-- Name: COLUMN "RedditMention".text_len; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON COLUMN public."RedditMention".text_len IS 'Character count of original mention';


--
-- Name: Subreddit; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public."Subreddit" (
    id text NOT NULL,
    name text NOT NULL,
    city_id text,
    last_sync timestamp with time zone,
    total_posts integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public."Subreddit" OWNER TO neondb_owner;

--
-- Name: TABLE "Subreddit"; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON TABLE public."Subreddit" IS 'Subreddit to city mapping for Reddit ingestion';


--
-- Name: mv_top_by_cuisine; Type: MATERIALIZED VIEW; Schema: public; Owner: neondb_owner
--

CREATE MATERIALIZED VIEW public.mv_top_by_cuisine AS
 SELECT p.id AS place_id,
    p.city_id,
    p.name,
    unnest(p.cuisine) AS cuisine_type,
    p.address,
    public.st_y((p.geog)::public.geometry) AS lat,
    public.st_x((p.geog)::public.geometry) AS lon,
    COALESCE(pa.iconic_score, (0)::numeric) AS iconic_score,
    COALESCE(pa.total_mentions, 0) AS total_mentions,
    row_number() OVER (PARTITION BY p.city_id, (unnest(p.cuisine)) ORDER BY COALESCE(pa.iconic_score, (0)::numeric) DESC, p.name) AS rank
   FROM (public."Place" p
     LEFT JOIN public."PlaceAggregation" pa ON ((p.id = pa.place_id)))
  WHERE ((p.status = 'open'::public.place_status) AND (cardinality(p.cuisine) > 0))
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.mv_top_by_cuisine OWNER TO neondb_owner;

--
-- Name: MATERIALIZED VIEW mv_top_by_cuisine; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON MATERIALIZED VIEW public.mv_top_by_cuisine IS 'Pre-ranked places by city and cuisine type';


--
-- Name: mv_top_iconic_by_city; Type: MATERIALIZED VIEW; Schema: public; Owner: neondb_owner
--

CREATE MATERIALIZED VIEW public.mv_top_iconic_by_city AS
 SELECT p.id AS place_id,
    p.city_id,
    p.name,
    p.cuisine,
    p.address,
    public.st_y((p.geog)::public.geometry) AS lat,
    public.st_x((p.geog)::public.geometry) AS lon,
    COALESCE(pa.iconic_score, (0)::numeric) AS iconic_score,
    COALESCE(pa.unique_threads, 0) AS unique_threads,
    COALESCE(pa.total_mentions, 0) AS total_mentions,
    COALESCE(pa.total_upvotes, 0) AS total_upvotes,
    pa.last_seen,
    COALESCE(pa.top_snippets, '[]'::jsonb) AS top_snippets,
    row_number() OVER (PARTITION BY p.city_id ORDER BY COALESCE(pa.iconic_score, (0)::numeric) DESC, p.name) AS rank
   FROM (public."Place" p
     LEFT JOIN public."PlaceAggregation" pa ON ((p.id = pa.place_id)))
  WHERE ((p.status = 'open'::public.place_status) AND ((pa.total_mentions IS NULL) OR (pa.total_mentions >= 3)))
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.mv_top_iconic_by_city OWNER TO neondb_owner;

--
-- Name: MATERIALIZED VIEW mv_top_iconic_by_city; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON MATERIALIZED VIEW public.mv_top_iconic_by_city IS 'Pre-ranked iconic places by city (Wilson-smoothed all-time rankings)';


--
-- Name: mv_top_trending_by_city; Type: MATERIALIZED VIEW; Schema: public; Owner: neondb_owner
--

CREATE MATERIALIZED VIEW public.mv_top_trending_by_city AS
 SELECT p.id AS place_id,
    p.city_id,
    p.name,
    p.cuisine,
    p.address,
    public.st_y((p.geog)::public.geometry) AS lat,
    public.st_x((p.geog)::public.geometry) AS lon,
    COALESCE(pa.trending_score, (0)::numeric) AS trending_score,
    COALESCE(pa.mentions_90d, 0) AS mentions_90d,
    pa.last_seen,
    COALESCE(pa.top_snippets, '[]'::jsonb) AS top_snippets,
    row_number() OVER (PARTITION BY p.city_id ORDER BY COALESCE(pa.trending_score, (0)::numeric) DESC, p.name) AS rank
   FROM (public."Place" p
     LEFT JOIN public."PlaceAggregation" pa ON ((p.id = pa.place_id)))
  WHERE ((p.status = 'open'::public.place_status) AND ((pa.mentions_90d IS NULL) OR (pa.mentions_90d >= 2)))
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.mv_top_trending_by_city OWNER TO neondb_owner;

--
-- Name: MATERIALIZED VIEW mv_top_trending_by_city; Type: COMMENT; Schema: public; Owner: neondb_owner
--

COMMENT ON MATERIALIZED VIEW public.mv_top_trending_by_city IS 'Pre-ranked trending places by city (exponential decay, 90d window)';


--
-- Name: CityAlias CityAlias_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."CityAlias"
    ADD CONSTRAINT "CityAlias_pkey" PRIMARY KEY (id);


--
-- Name: City City_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."City"
    ADD CONSTRAINT "City_pkey" PRIMARY KEY (id);


--
-- Name: JobQueue JobQueue_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."JobQueue"
    ADD CONSTRAINT "JobQueue_pkey" PRIMARY KEY (id);


--
-- Name: MaterializedViewVersion MaterializedViewVersion_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."MaterializedViewVersion"
    ADD CONSTRAINT "MaterializedViewVersion_pkey" PRIMARY KEY (view_name);


--
-- Name: PlaceAggregation PlaceAggregation_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."PlaceAggregation"
    ADD CONSTRAINT "PlaceAggregation_pkey" PRIMARY KEY (place_id);


--
-- Name: Place Place_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."Place"
    ADD CONSTRAINT "Place_pkey" PRIMARY KEY (id);


--
-- Name: RedditMention RedditMention_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."RedditMention"
    ADD CONSTRAINT "RedditMention_pkey" PRIMARY KEY (id);


--
-- Name: Subreddit Subreddit_name_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."Subreddit"
    ADD CONSTRAINT "Subreddit_name_key" UNIQUE (name);


--
-- Name: Subreddit Subreddit_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."Subreddit"
    ADD CONSTRAINT "Subreddit_pkey" PRIMARY KEY (id);


--
-- Name: City city_name_country_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."City"
    ADD CONSTRAINT city_name_country_unique UNIQUE (name, country);


--
-- Name: Place place_city_name_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."Place"
    ADD CONSTRAINT place_city_name_unique UNIQUE (city_id, name_norm);


--
-- Name: RedditMention reddit_mention_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."RedditMention"
    ADD CONSTRAINT reddit_mention_unique UNIQUE (post_id, comment_id, place_id);


--
-- Name: city_alias_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX city_alias_unique ON public."CityAlias" USING btree (city_id, alias);


--
-- Name: idx_city_alias_city_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_city_alias_city_id ON public."CityAlias" USING btree (city_id);


--
-- Name: idx_city_alias_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX idx_city_alias_unique ON public."CityAlias" USING btree (lower(alias));


--
-- Name: idx_city_bbox; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_city_bbox ON public."City" USING gist (bbox);


--
-- Name: idx_city_name; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_city_name ON public."City" USING btree (name);


--
-- Name: idx_city_ranked; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_city_ranked ON public."City" USING btree (ranked) WHERE (ranked = true);


--
-- Name: idx_job_created; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_job_created ON public."JobQueue" USING btree (created_at);


--
-- Name: idx_job_status_type; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_job_status_type ON public."JobQueue" USING btree (status, type);


--
-- Name: idx_mv_cuisine_covering; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_mv_cuisine_covering ON public.mv_top_by_cuisine USING btree (city_id, cuisine_type, rank) INCLUDE (place_id, name, address, lat, lon, iconic_score);


--
-- Name: idx_mv_iconic_city_rank_covering; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_mv_iconic_city_rank_covering ON public.mv_top_iconic_by_city USING btree (city_id, rank) INCLUDE (place_id, name, cuisine, lat, lon, address, iconic_score, unique_threads, total_mentions, last_seen);


--
-- Name: idx_mv_iconic_covering; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX idx_mv_iconic_covering ON public.mv_top_iconic_by_city USING btree (city_id, rank) INCLUDE (place_id, name, cuisine, address, lat, lon, iconic_score, unique_threads, total_mentions);


--
-- Name: idx_mv_iconic_score; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_mv_iconic_score ON public.mv_top_iconic_by_city USING btree (city_id, iconic_score DESC);


--
-- Name: idx_mv_trending_covering; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX idx_mv_trending_covering ON public.mv_top_trending_by_city USING btree (city_id, rank) INCLUDE (place_id, name, cuisine, address, lat, lon, trending_score, mentions_90d);


--
-- Name: idx_mv_trending_score; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_mv_trending_score ON public.mv_top_trending_by_city USING btree (city_id, trending_score DESC);


--
-- Name: idx_place_agg_iconic; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_place_agg_iconic ON public."PlaceAggregation" USING btree (place_id, iconic_score DESC);


--
-- Name: idx_place_agg_trending; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_place_agg_trending ON public."PlaceAggregation" USING btree (place_id, trending_score DESC);


--
-- Name: idx_place_city_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_place_city_id ON public."Place" USING btree (city_id);


--
-- Name: idx_place_cuisine; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_place_cuisine ON public."Place" USING gin (cuisine);


--
-- Name: idx_place_geog; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_place_geog ON public."Place" USING gist (geog);


--
-- Name: idx_place_name_trgm; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_place_name_trgm ON public."Place" USING gin (name_norm public.gin_trgm_ops);


--
-- Name: idx_place_osm_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_place_osm_id ON public."Place" USING btree (osm_id) WHERE (osm_id IS NOT NULL);


--
-- Name: idx_place_overture_id; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_place_overture_id ON public."Place" USING btree (overture_id) WHERE (overture_id IS NOT NULL);


--
-- Name: idx_place_status_open; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_place_status_open ON public."Place" USING btree (city_id, status) WHERE (status = 'open'::public.place_status);


--
-- Name: idx_reddit_mention_place_ts; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_reddit_mention_place_ts ON public."RedditMention" USING btree (place_id, ts DESC);


--
-- Name: idx_reddit_mention_subreddit; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_reddit_mention_subreddit ON public."RedditMention" USING btree (subreddit);


--
-- Name: idx_reddit_mention_ts_brin; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_reddit_mention_ts_brin ON public."RedditMention" USING brin (ts);


--
-- Name: idx_subreddit_active; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_subreddit_active ON public."Subreddit" USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_subreddit_city; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX idx_subreddit_city ON public."Subreddit" USING btree (city_id);


--
-- Name: CityAlias CityAlias_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."CityAlias"
    ADD CONSTRAINT "CityAlias_city_id_fkey" FOREIGN KEY (city_id) REFERENCES public."City"(id) ON DELETE CASCADE;


--
-- Name: PlaceAggregation PlaceAggregation_place_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."PlaceAggregation"
    ADD CONSTRAINT "PlaceAggregation_place_id_fkey" FOREIGN KEY (place_id) REFERENCES public."Place"(id) ON DELETE CASCADE;


--
-- Name: Place Place_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."Place"
    ADD CONSTRAINT "Place_city_id_fkey" FOREIGN KEY (city_id) REFERENCES public."City"(id) ON DELETE CASCADE;


--
-- Name: RedditMention RedditMention_place_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."RedditMention"
    ADD CONSTRAINT "RedditMention_place_id_fkey" FOREIGN KEY (place_id) REFERENCES public."Place"(id) ON DELETE CASCADE;


--
-- Name: Subreddit Subreddit_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public."Subreddit"
    ADD CONSTRAINT "Subreddit_city_id_fkey" FOREIGN KEY (city_id) REFERENCES public."City"(id) ON DELETE CASCADE;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO neon_superuser WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser WITH GRANT OPTION;


--
-- PostgreSQL database dump complete
--

\unrestrict v9srcvcJ9ecy8MrpNYokdop2F6AfSzhyOAdLmwDRMEhdOcCtee10XnA4L2fCQHq

