-- Migration: Add missing columns to saved_posts table
-- Run this in Supabase SQL Editor if you already ran the initial schema

-- Add missing columns to saved_posts
ALTER TABLE saved_posts 
ADD COLUMN IF NOT EXISTS original_url TEXT,
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Set default for media_urls if not already set
ALTER TABLE saved_posts 
ALTER COLUMN media_urls SET DEFAULT '{}';

-- Add generation pipeline state tracking to recreated posts
ALTER TABLE recreated_posts
ADD COLUMN IF NOT EXISTS generation_state JSONB DEFAULT '{}'::jsonb;

-- Make original_url NOT NULL (only if table is empty or all rows have original_url)
-- Run this line only if you're sure all existing rows have original_url values
-- ALTER TABLE saved_posts ALTER COLUMN original_url SET NOT NULL;

-- Add slide_plans column to recreated_posts for storing per-slide design instructions and asset metadata
ALTER TABLE recreated_posts
ADD COLUMN IF NOT EXISTS slide_plans JSONB DEFAULT '[]'::jsonb;

-- Pinterest agent generations table
CREATE TABLE IF NOT EXISTS pinterest_agent_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  focus TEXT,
  topic TEXT NOT NULL,
  angle_rationale TEXT,
  style_theme TEXT,
  style_direction TEXT,
  script JSONB DEFAULT '{}'::jsonb,
  image_prompt TEXT,
  alt_text TEXT,
  image_url TEXT,
  reasoning_model VARCHAR(120),
  image_model VARCHAR(120),
  status VARCHAR(50) NOT NULL DEFAULT 'completed',
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pinterest_agent_generations_collection
  ON pinterest_agent_generations(collection_id);

-- Video format groups table
CREATE TABLE IF NOT EXISTS video_formats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  format_name TEXT NOT NULL,
  format_type VARCHAR(40) NOT NULL,
  format_signature TEXT NOT NULL,
  summary TEXT NOT NULL,
  why_it_works TEXT[] DEFAULT '{}',
  hook_patterns TEXT[] DEFAULT '{}',
  shot_pattern TEXT[] DEFAULT '{}',
  editing_style TEXT[] DEFAULT '{}',
  script_scaffold TEXT,
  higgsfield_prompt_template TEXT,
  recreation_checklist TEXT[] DEFAULT '{}',
  duration_guidance TEXT,
  confidence DOUBLE PRECISION,
  source_count INT NOT NULL DEFAULT 0,
  latest_source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(collection_id, format_signature)
);

CREATE INDEX IF NOT EXISTS idx_video_formats_collection
  ON video_formats(collection_id);

-- Videos grouped under each format
CREATE TABLE IF NOT EXISTS video_format_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  format_id UUID NOT NULL REFERENCES video_formats(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  platform TEXT NOT NULL,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  user_notes TEXT,
  analysis_confidence DOUBLE PRECISION,
  analysis_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_format_videos_collection
  ON video_format_videos(collection_id);

CREATE INDEX IF NOT EXISTS idx_video_format_videos_format
  ON video_format_videos(format_id);

-- Saved recreation plans
CREATE TABLE IF NOT EXISTS video_recreation_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  format_id UUID NOT NULL REFERENCES video_formats(id) ON DELETE CASCADE,
  source_video_id UUID NOT NULL REFERENCES video_format_videos(id) ON DELETE CASCADE,
  app_name TEXT NOT NULL,
  plan_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_recreation_plans_collection
  ON video_recreation_plans(collection_id);

-- Default UGC character profile per collection
CREATE TABLE IF NOT EXISTS video_ugc_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  character_name TEXT NOT NULL,
  persona_summary TEXT NOT NULL,
  visual_style TEXT NOT NULL,
  wardrobe_notes TEXT,
  voice_tone TEXT,
  prompt_template TEXT NOT NULL,
  reference_image_url TEXT,
  image_model VARCHAR(120),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_ugc_characters_collection
  ON video_ugc_characters(collection_id);

ALTER TABLE video_ugc_characters
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE video_ugc_characters
  DROP CONSTRAINT IF EXISTS video_ugc_characters_collection_id_key;

WITH first_rows AS (
  SELECT id, collection_id,
         ROW_NUMBER() OVER (PARTITION BY collection_id ORDER BY created_at ASC) AS rn
  FROM video_ugc_characters
)
UPDATE video_ugc_characters AS c
SET is_default = (f.rn = 1)
FROM first_rows AS f
WHERE c.id = f.id;

-- Saved angle variations for each UGC character
CREATE TABLE IF NOT EXISTS video_ugc_character_angles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES video_ugc_characters(id) ON DELETE CASCADE,
  angle_key TEXT NOT NULL,
  angle_label TEXT NOT NULL,
  angle_prompt TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_model VARCHAR(120),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_ugc_character_angles_collection
  ON video_ugc_character_angles(collection_id);

CREATE INDEX IF NOT EXISTS idx_video_ugc_character_angles_character
  ON video_ugc_character_angles(character_id);

-- Calendar-based cycle plans for Cycle Day Agent
CREATE TABLE IF NOT EXISTS video_cycle_day_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  plan_number INT NOT NULL,
  app_name TEXT NOT NULL,
  cycle_start_date DATE NOT NULL,
  cycle_length_days INT NOT NULL,
  plan_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(collection_id, plan_number)
);

CREATE INDEX IF NOT EXISTS idx_video_cycle_day_plans_collection
  ON video_cycle_day_plans(collection_id);

CREATE INDEX IF NOT EXISTS idx_video_cycle_day_plans_plan_number
  ON video_cycle_day_plans(collection_id, plan_number DESC);

-- Saved series episodes for Islamic menstruation 3D agent
CREATE TABLE IF NOT EXISTS video_islamic_menstruation_series_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  plan_number INT NOT NULL,
  episode_id TEXT NOT NULL,
  episode_title TEXT NOT NULL,
  phase TEXT NOT NULL,
  target_duration_seconds INT NOT NULL,
  reasoning_model TEXT,
  custom_focus TEXT,
  format_id UUID REFERENCES video_formats(id) ON DELETE SET NULL,
  source_video_id UUID REFERENCES video_format_videos(id) ON DELETE SET NULL,
  recreation_plan_id UUID REFERENCES video_recreation_plans(id) ON DELETE SET NULL,
  plan_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(collection_id, plan_number)
);

CREATE INDEX IF NOT EXISTS idx_video_islamic_series_plans_collection
  ON video_islamic_menstruation_series_plans(collection_id);

CREATE INDEX IF NOT EXISTS idx_video_islamic_series_plans_episode
  ON video_islamic_menstruation_series_plans(collection_id, episode_id);
