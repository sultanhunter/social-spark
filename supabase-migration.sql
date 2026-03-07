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
