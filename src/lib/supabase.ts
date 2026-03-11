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

export interface VideoFormat {
  id: string;
  collection_id: string;
  format_name: string;
  format_type: "ugc" | "ai_video" | "hybrid" | "editorial";
  format_signature: string;
  summary: string;
  why_it_works: string[];
  hook_patterns: string[];
  shot_pattern: string[];
  editing_style: string[];
  script_scaffold: string | null;
  higgsfield_prompt_template: string | null;
  recreation_checklist: string[];
  duration_guidance: string | null;
  confidence: number | null;
  source_count: number;
  latest_source_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface VideoFormatVideo {
  id: string;
  collection_id: string;
  format_id: string;
  source_url: string;
  platform: string;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  user_notes: string | null;
  analysis_confidence: number | null;
  analysis_payload: Record<string, unknown>;
  created_at: string;
}

export interface VideoRecreationPlan {
  id: string;
  collection_id: string;
  format_id: string;
  source_video_id: string;
  app_name: string;
  plan_payload: Record<string, unknown>;
  created_at: string;
}

export interface VideoUgcCharacter {
  id: string;
  collection_id: string;
  character_name: string;
  persona_summary: string;
  visual_style: string;
  wardrobe_notes: string | null;
  voice_tone: string | null;
  prompt_template: string;
  reference_image_url: string | null;
  image_model: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface VideoUgcCharacterAngle {
  id: string;
  collection_id: string;
  character_id: string;
  angle_key: string;
  angle_label: string;
  angle_prompt: string;
  image_url: string;
  image_model: string | null;
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

-- Video format groups table
CREATE TABLE IF NOT EXISTS video_formats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
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
  source_count INT DEFAULT 0,
  latest_source_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(collection_id, format_signature)
);

CREATE INDEX IF NOT EXISTS idx_video_formats_collection
  ON video_formats(collection_id);

-- Video examples table
CREATE TABLE IF NOT EXISTS video_format_videos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  format_id UUID REFERENCES video_formats(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  platform VARCHAR(50) NOT NULL,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  user_notes TEXT,
  analysis_confidence DOUBLE PRECISION,
  analysis_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_format_videos_collection
  ON video_format_videos(collection_id);

CREATE INDEX IF NOT EXISTS idx_video_format_videos_format
  ON video_format_videos(format_id);

-- Generated recreation plans table
CREATE TABLE IF NOT EXISTS video_recreation_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  format_id UUID REFERENCES video_formats(id) ON DELETE CASCADE,
  source_video_id UUID REFERENCES video_format_videos(id) ON DELETE CASCADE,
  app_name TEXT NOT NULL,
  plan_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_recreation_plans_collection
  ON video_recreation_plans(collection_id);

-- Default UGC character per collection
CREATE TABLE IF NOT EXISTS video_ugc_characters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  character_name TEXT NOT NULL,
  persona_summary TEXT NOT NULL,
  visual_style TEXT NOT NULL,
  wardrobe_notes TEXT,
  voice_tone TEXT,
  prompt_template TEXT NOT NULL,
  reference_image_url TEXT,
  image_model VARCHAR(120),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_ugc_characters_collection
  ON video_ugc_characters(collection_id);

-- Character angle library
CREATE TABLE IF NOT EXISTS video_ugc_character_angles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  character_id UUID REFERENCES video_ugc_characters(id) ON DELETE CASCADE,
  angle_key TEXT NOT NULL,
  angle_label TEXT NOT NULL,
  angle_prompt TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_model VARCHAR(120),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_ugc_character_angles_collection
  ON video_ugc_character_angles(collection_id);

CREATE INDEX IF NOT EXISTS idx_video_ugc_character_angles_character
  ON video_ugc_character_angles(character_id);
`;
