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

-- Create indexes for better query performance
CREATE INDEX idx_saved_posts_collection_id ON saved_posts(collection_id);
CREATE INDEX idx_recreated_posts_collection_id ON recreated_posts(collection_id);
CREATE INDEX idx_recreated_posts_original_post_id ON recreated_posts(original_post_id);

-- Enable Row Level Security (RLS)
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recreated_posts ENABLE ROW LEVEL SECURITY;

-- Create policies (allow all for now - customize based on your auth setup)
CREATE POLICY "Enable all operations for all users" ON collections
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for all users" ON saved_posts
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for all users" ON recreated_posts
  FOR ALL USING (true) WITH CHECK (true);
