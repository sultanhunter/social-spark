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
