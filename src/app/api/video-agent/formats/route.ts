import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type VideoFormatRow = {
  id: string;
  collection_id: string;
  format_name: string;
  format_type: string;
  format_signature: string;
  summary: string;
  why_it_works: string[] | null;
  hook_patterns: string[] | null;
  shot_pattern: string[] | null;
  editing_style: string[] | null;
  script_scaffold: string | null;
  higgsfield_prompt_template: string | null;
  recreation_checklist: string[] | null;
  duration_guidance: string | null;
  confidence: number | null;
  source_count: number | null;
  latest_source_url: string | null;
  created_at: string;
  updated_at: string;
};

type VideoFormatVideoRow = {
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
  created_at: string;
};

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  return row.code === "42P01";
}

export async function GET(request: NextRequest) {
  try {
    const collectionId = request.nextUrl.searchParams.get("collectionId")?.trim();

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    const [formatsResult, videosResult] = await Promise.all([
      supabase
        .from("video_formats")
        .select("*")
        .eq("collection_id", collectionId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("video_format_videos")
        .select("id, collection_id, format_id, source_url, platform, title, description, thumbnail_url, user_notes, analysis_confidence, created_at")
        .eq("collection_id", collectionId)
        .order("created_at", { ascending: false }),
    ]);

    if (formatsResult.error) {
      if (isMissingTableError(formatsResult.error)) {
        return NextResponse.json(
          {
            error:
              "Video pipeline tables are missing. Run the video-agent SQL migration first (see supabase-migration.sql).",
          },
          { status: 500 }
        );
      }
      throw formatsResult.error;
    }

    if (videosResult.error) {
      if (isMissingTableError(videosResult.error)) {
        return NextResponse.json(
          {
            error:
              "Video pipeline tables are missing. Run the video-agent SQL migration first (see supabase-migration.sql).",
          },
          { status: 500 }
        );
      }
      throw videosResult.error;
    }

    const formats = (Array.isArray(formatsResult.data)
      ? (formatsResult.data as unknown as VideoFormatRow[])
      : [])
      .map((format) => ({
        ...format,
        why_it_works: Array.isArray(format.why_it_works) ? format.why_it_works : [],
        hook_patterns: Array.isArray(format.hook_patterns) ? format.hook_patterns : [],
        shot_pattern: Array.isArray(format.shot_pattern) ? format.shot_pattern : [],
        editing_style: Array.isArray(format.editing_style) ? format.editing_style : [],
        recreation_checklist: Array.isArray(format.recreation_checklist) ? format.recreation_checklist : [],
      }));

    const videos = Array.isArray(videosResult.data)
      ? (videosResult.data as unknown as VideoFormatVideoRow[])
      : [];

    const videosByFormatId = new Map<string, VideoFormatVideoRow[]>();

    for (const video of videos) {
      if (!videosByFormatId.has(video.format_id)) {
        videosByFormatId.set(video.format_id, []);
      }
      videosByFormatId.get(video.format_id)?.push(video);
    }

    const payload = formats.map((format) => ({
      ...format,
      source_count:
        typeof format.source_count === "number"
          ? format.source_count
          : videosByFormatId.get(format.id)?.length || 0,
      videos: videosByFormatId.get(format.id) || [],
    }));

    return NextResponse.json({ formats: payload });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load video format library." },
      { status: 500 }
    );
  }
}
