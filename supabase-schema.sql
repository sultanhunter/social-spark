-- Social Spark Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Collections table
CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  app_name TEXT NOT NULL,
  app_description TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Saved posts table
CREATE TABLE saved_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  original_url TEXT NOT NULL,
  platform TEXT NOT NULL,
  post_type TEXT NOT NULL,
  title TEXT,
  description TEXT,
  media_urls TEXT[] DEFAULT '{}',
  thumbnail_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recreated posts table
CREATE TABLE recreated_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_post_id UUID NOT NULL REFERENCES saved_posts(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  script TEXT NOT NULL,
  generated_media_urls TEXT[],
  status TEXT NOT NULL DEFAULT 'draft',
  generation_state JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pinterest agent generations table
CREATE TABLE pinterest_agent_generations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  status TEXT NOT NULL DEFAULT 'completed',
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video format groups table
CREATE TABLE video_formats (
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

-- Videos grouped under a format
CREATE TABLE video_format_videos (
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

-- Stored recreation plans
CREATE TABLE video_recreation_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  format_id UUID NOT NULL REFERENCES video_formats(id) ON DELETE CASCADE,
  source_video_id UUID NOT NULL REFERENCES video_format_videos(id) ON DELETE CASCADE,
  app_name TEXT NOT NULL,
  plan_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_saved_posts_collection_id ON saved_posts(collection_id);
CREATE INDEX idx_recreated_posts_collection_id ON recreated_posts(collection_id);
CREATE INDEX idx_recreated_posts_original_post_id ON recreated_posts(original_post_id);
CREATE INDEX idx_pinterest_agent_generations_collection_id ON pinterest_agent_generations(collection_id);
CREATE INDEX idx_video_formats_collection_id ON video_formats(collection_id);
CREATE INDEX idx_video_format_videos_collection_id ON video_format_videos(collection_id);
CREATE INDEX idx_video_format_videos_format_id ON video_format_videos(format_id);
CREATE INDEX idx_video_recreation_plans_collection_id ON video_recreation_plans(collection_id);

-- Enable Row Level Security (RLS)
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recreated_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pinterest_agent_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_format_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_recreation_plans ENABLE ROW LEVEL SECURITY;

-- Create policies (allow all for now - customize based on your auth setup)
CREATE POLICY "Enable all operations for all users" ON collections
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for all users" ON saved_posts
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for all users" ON recreated_posts
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for all users" ON pinterest_agent_generations
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for all users" ON video_formats
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for all users" ON video_format_videos
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for all users" ON video_recreation_plans
  FOR ALL USING (true) WITH CHECK (true);
