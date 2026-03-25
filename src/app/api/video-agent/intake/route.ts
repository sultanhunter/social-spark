import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  fetchVideoSourceMetadata,
} from "@/lib/video-agent";
import { DEFAULT_REASONING_MODEL, isReasoningModel } from "@/lib/reasoning-model";

export const runtime = "nodejs";

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

const PENDING_ANALYSIS_SIGNATURE = "pending_analysis_manual";

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalText(value: unknown): string | null {
  const cleaned = asText(value);
  return cleaned.length > 0 ? cleaned : null;
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  return row.code === "42P01";
}

async function ensurePendingFormat(collectionId: string, sourceUrl: string): Promise<{ row: VideoFormatRow; created: boolean }> {
  const existing = await supabase
    .from("video_formats")
    .select("*")
    .eq("collection_id", collectionId)
    .eq("format_signature", PENDING_ANALYSIS_SIGNATURE)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    if (isMissingTableError(existing.error)) {
      throw new Error(
        "Video pipeline tables are missing. Run the video-agent SQL migration first (see supabase-migration.sql)."
      );
    }
    throw existing.error;
  }

  if (existing.data) {
    const row = existing.data as unknown as VideoFormatRow;
    const nextSourceCount = (typeof row.source_count === "number" ? row.source_count : 0) + 1;

    const update = await supabase
      .from("video_formats")
      .update({
        source_count: nextSourceCount,
        latest_source_url: sourceUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .select("*")
      .single();

    if (update.error || !update.data) {
      throw update.error || new Error("Failed to update pending analysis format.");
    }

    return {
      row: update.data as unknown as VideoFormatRow,
      created: false,
    };
  }

  const inserted = await supabase
    .from("video_formats")
    .insert({
      collection_id: collectionId,
      format_name: "Pending Analysis",
      format_type: "hybrid",
      format_signature: PENDING_ANALYSIS_SIGNATURE,
      summary: "Source videos waiting for analysis. Analysis runs during plan creation/recreation.",
      why_it_works: ["Analysis deferred to recreate step."],
      hook_patterns: [],
      shot_pattern: [],
      editing_style: [],
      script_scaffold: "",
      higgsfield_prompt_template: "",
      recreation_checklist: ["Generate plan to trigger full analysis."],
      duration_guidance: "",
      confidence: 0,
      source_count: 1,
      latest_source_url: sourceUrl,
    })
    .select("*")
    .single();

  if (inserted.error || !inserted.data) {
    throw inserted.error || new Error("Failed to create pending analysis format.");
  }

  return {
    row: inserted.data as unknown as VideoFormatRow,
    created: true,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const sourceUrl = asText(body.url);
    const userNotes = asOptionalText(body.userNotes);
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;

    if (!collectionId || !sourceUrl) {
      return NextResponse.json(
        { error: "collectionId and url are required." },
        { status: 400 }
      );
    }

    try {
      new URL(sourceUrl);
    } catch {
      return NextResponse.json(
        { error: "Please provide a valid video URL." },
        { status: 400 }
      );
    }

    const { data: collection, error: collectionError } = await supabase
      .from("collections")
      .select("id")
      .eq("id", collectionId)
      .single();

    if (collectionError || !collection) {
      return NextResponse.json(
        { error: "Collection not found." },
        { status: 404 }
      );
    }

    const sourceMetadata = await fetchVideoSourceMetadata(sourceUrl);
    sourceMetadata.userNotes = userNotes;

    const pendingFormat = await ensurePendingFormat(collectionId, sourceUrl);
    const formatRow = pendingFormat.row;
    const createdNewFormat = pendingFormat.created;

    const analysisPayload = {
      sourceMetadata,
      formatAnalysis: null,
      matchDecision: null,
      reasoningModel,
      analyzedAt: null,
      analyzeOnRecreate: true,
    };

    const { data: insertedVideo, error: insertVideoError } = await supabase
      .from("video_format_videos")
      .insert({
        collection_id: collectionId,
        format_id: formatRow.id,
        source_url: sourceUrl,
        platform: sourceMetadata.platform,
        title: sourceMetadata.title,
        description: sourceMetadata.description,
        thumbnail_url: sourceMetadata.thumbnailUrl,
        user_notes: userNotes,
        analysis_confidence: null,
        analysis_payload: analysisPayload,
      })
      .select("*")
      .single();

    if (insertVideoError) throw insertVideoError;

    const { count, error: countError } = await supabase
      .from("video_format_videos")
      .select("id", { count: "exact", head: true })
      .eq("format_id", formatRow.id);

    if (countError) throw countError;

    return NextResponse.json({
      createdNewFormat,
      groupedVideoCount: typeof count === "number" ? count : null,
      format: formatRow,
      video: insertedVideo,
      matchDecision: null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to store source video for deferred analysis." },
      { status: 500 }
    );
  }
}
