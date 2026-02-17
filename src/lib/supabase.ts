import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  _supabase = createClient(supabaseUrl, supabaseAnonKey);
  return _supabase;
}

// Convenience alias - lazy getter
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Database types
export interface Collection {
  id: string;
  name: string;
  description: string | null;
  app_name: string;
  app_description: string | null;
  app_context?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedPost {
  id: string;
  collection_id: string;
  original_url: string;
  platform: "instagram" | "tiktok" | "threads" | "youtube" | "twitter" | "unknown";
  post_type: "image_slides" | "short_video";
  title: string | null;
  description: string | null;
  media_urls: string[];
  thumbnail_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface RecreatedPost {
  id: string;
  original_post_id: string;
  collection_id: string;
  script: string;
  generated_media_urls: string[];
  status: "draft" | "generating" | "completed" | "failed";
  created_at: string;
  updated_at: string;
}

// SQL Schema for Supabase (run this in Supabase SQL editor)
export const SCHEMA_SQL = `
-- Collections table
CREATE TABLE IF NOT EXISTS collections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  app_name VARCHAR(255) NOT NULL,
  app_description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Saved posts table
CREATE TABLE IF NOT EXISTS saved_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  original_url TEXT NOT NULL,
  platform VARCHAR(50) NOT NULL,
  post_type VARCHAR(50) NOT NULL,
  title VARCHAR(500),
  description TEXT,
  media_urls TEXT[] DEFAULT '{}',
  thumbnail_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Recreated posts table
CREATE TABLE IF NOT EXISTS recreated_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  original_post_id UUID REFERENCES saved_posts(id) ON DELETE CASCADE,
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  script TEXT,
  generated_media_urls TEXT[] DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_saved_posts_collection ON saved_posts(collection_id);
CREATE INDEX IF NOT EXISTS idx_saved_posts_type ON saved_posts(post_type);
CREATE INDEX IF NOT EXISTS idx_recreated_posts_collection ON recreated_posts(collection_id);
`;
