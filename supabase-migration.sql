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
