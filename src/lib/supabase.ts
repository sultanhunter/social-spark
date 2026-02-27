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
  logo?: string | null;
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
  caption?: string | null;
  status: "draft" | "generating" | "completed" | "failed";
  generation_state?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CarouselAgentGeneration {
  id: string;
  collection_id: string;
  focus: string | null;
  topic: string;
  angle_rationale: string;
  caption: string;
  cta: string;
  hashtags: string[];
  strategy_checklist: string[];
  spin_off_angles: string[];
  reasoning_model: string;
  image_model: string;
  generated_images: boolean;
  status: "completed" | "failed";
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CarouselAgentGenerationSlide {
  id: string;
  generation_id: string;
  collection_id: string;
  slide_number: number;
  role: string;
  density: "dense" | "light";
  overlay_title: string;
  overlay_lines: string[];
  headline: string;
  body_bullets: string[];
  voice_script: string;
  hook_purpose: string;
  caps_words: string[];
  visual_direction: string;
  image_prompt: string;
  alt_text: string;
  image_url: string | null;
  created_at: string;
}

export interface PinterestAgentGeneration {
  id: string;
  collection_id: string;
  focus: string | null;
  topic: string;
  angle_rationale: string;
  style_theme: string;
  style_direction: string;
  script: Record<string, unknown>;
  image_prompt: string;
  alt_text: string;
  image_url: string | null;
  reasoning_model: string;
  image_model: string;
  status: "completed" | "failed";
  payload: Record<string, unknown>;
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
  logo TEXT,
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
  caption TEXT,
  status VARCHAR(50) DEFAULT 'draft',
  generation_state JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_saved_posts_collection ON saved_posts(collection_id);
CREATE INDEX IF NOT EXISTS idx_saved_posts_type ON saved_posts(post_type);
CREATE INDEX IF NOT EXISTS idx_recreated_posts_collection ON recreated_posts(collection_id);

-- Carousel agent generations table
CREATE TABLE IF NOT EXISTS carousel_agent_generations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  focus TEXT,
  topic TEXT NOT NULL,
  angle_rationale TEXT,
  caption TEXT,
  cta TEXT,
  hashtags TEXT[] DEFAULT '{}',
  strategy_checklist TEXT[] DEFAULT '{}',
  spin_off_angles TEXT[] DEFAULT '{}',
  reasoning_model VARCHAR(120),
  image_model VARCHAR(120),
  generated_images BOOLEAN DEFAULT TRUE,
  status VARCHAR(50) DEFAULT 'completed',
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Carousel agent slides table
CREATE TABLE IF NOT EXISTS carousel_agent_generation_slides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  generation_id UUID REFERENCES carousel_agent_generations(id) ON DELETE CASCADE,
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  slide_number INT NOT NULL,
  role VARCHAR(80),
  density VARCHAR(20),
  overlay_title TEXT,
  overlay_lines TEXT[] DEFAULT '{}',
  headline TEXT,
  body_bullets TEXT[] DEFAULT '{}',
  voice_script TEXT,
  hook_purpose TEXT,
  caps_words TEXT[] DEFAULT '{}',
  visual_direction TEXT,
  image_prompt TEXT,
  alt_text TEXT,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(generation_id, slide_number)
);

CREATE INDEX IF NOT EXISTS idx_carousel_agent_generations_collection
  ON carousel_agent_generations(collection_id);

CREATE INDEX IF NOT EXISTS idx_carousel_agent_generation_slides_generation
  ON carousel_agent_generation_slides(generation_id);

-- Pinterest agent generations table
CREATE TABLE IF NOT EXISTS pinterest_agent_generations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
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
  status VARCHAR(50) DEFAULT 'completed',
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pinterest_agent_generations_collection
  ON pinterest_agent_generations(collection_id);
`;
