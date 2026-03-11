import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  buildVideoRecreationPlan,
  type VideoFormatAnalysis,
} from "@/lib/video-agent";
import { DEFAULT_REASONING_MODEL, isReasoningModel } from "@/lib/reasoning-model";

export const runtime = "nodejs";

type CollectionRow = {
  id: string;
  app_name: string | null;
  app_description: string | null;
  app_context?: string | null;
};

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
  analysis_payload?: Record<string, unknown> | null;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  return row.code === "42P01";
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const message = typeof row.message === "string" ? row.message.toLowerCase() : "";
  const details = typeof row.details === "string" ? row.details.toLowerCase() : "";
  const combined = `${message} ${details}`;
  return combined.includes(columnName.toLowerCase()) && combined.includes("column");
}

async function fetchCollectionRow(collectionId: string): Promise<CollectionRow | null> {
  const primary = await supabase
    .from("collections")
    .select("id, app_name, app_description, app_context")
    .eq("id", collectionId)
    .single();

  if (!primary.error && primary.data) {
    return primary.data as CollectionRow;
  }

  if (primary.error && isMissingColumnError(primary.error, "app_context")) {
    const fallback = await supabase
      .from("collections")
      .select("id, app_name, app_description")
      .eq("id", collectionId)
      .single();

    if (!fallback.error && fallback.data) {
      return fallback.data as CollectionRow;
    }

    return null;
  }

  return null;
}

function toFormatAnalysis(row: VideoFormatRow): VideoFormatAnalysis {
  return {
    formatName: row.format_name,
    formatType:
      row.format_type === "ugc" || row.format_type === "ai_video" || row.format_type === "editorial"
        ? row.format_type
        : "hybrid",
    formatSignature: row.format_signature,
    analysisMethod: "frame_aware",
    sourceDurationSeconds: null,
    sampledFrameCount: 0,
    sampledFrameSources: [],
    directMediaUrl: null,
    transcriptAvailable: false,
    transcriptSummary: "",
    transcriptText: "",
    transcriptHighlights: [],
    visualSignals: [],
    onScreenTextPatterns: [],
    summary: row.summary,
    whyItWorks: Array.isArray(row.why_it_works) ? row.why_it_works : [],
    hookPatterns: Array.isArray(row.hook_patterns) ? row.hook_patterns : [],
    shotPattern: Array.isArray(row.shot_pattern) ? row.shot_pattern : [],
    editingStyle: Array.isArray(row.editing_style) ? row.editing_style : [],
    scriptScaffold: row.script_scaffold || "",
    higgsfieldPromptTemplate: row.higgsfield_prompt_template || "",
    recreationChecklist: Array.isArray(row.recreation_checklist) ? row.recreation_checklist : [],
    durationGuidance: row.duration_guidance || "",
    confidence: typeof row.confidence === "number" ? row.confidence : 0.64,
  };
}

function getSourceTranscriptFromAnalysisPayload(payload: unknown): {
  summary: string | null;
  text: string | null;
  sourceDurationSeconds: number | null;
} {
  if (!payload || typeof payload !== "object") {
    return { summary: null, text: null, sourceDurationSeconds: null };
  }

  const row = payload as Record<string, unknown>;
  const sourceMetadata =
    row.sourceMetadata && typeof row.sourceMetadata === "object"
      ? (row.sourceMetadata as Record<string, unknown>)
      : null;
  const formatAnalysis =
    row.formatAnalysis && typeof row.formatAnalysis === "object"
      ? (row.formatAnalysis as Record<string, unknown>)
      : null;

  const transcriptSummary =
    (typeof sourceMetadata?.transcriptSummary === "string" && sourceMetadata.transcriptSummary.trim())
      ? sourceMetadata.transcriptSummary.trim()
      : typeof formatAnalysis?.transcriptSummary === "string" && formatAnalysis.transcriptSummary.trim()
        ? formatAnalysis.transcriptSummary.trim()
        : null;

  const transcriptText =
    (typeof sourceMetadata?.transcriptText === "string" && sourceMetadata.transcriptText.trim())
      ? sourceMetadata.transcriptText.trim()
      : (typeof formatAnalysis?.transcriptText === "string" && formatAnalysis.transcriptText.trim())
        ? formatAnalysis.transcriptText.trim()
      : null;

  const sourceDurationSecondsRaw =
    typeof sourceMetadata?.sourceDurationSeconds === "number"
      ? sourceMetadata.sourceDurationSeconds
      : typeof formatAnalysis?.sourceDurationSeconds === "number"
        ? formatAnalysis.sourceDurationSeconds
        : null;

  return {
    summary: transcriptSummary,
    text: transcriptText,
    sourceDurationSeconds:
      typeof sourceDurationSecondsRaw === "number" && Number.isFinite(sourceDurationSecondsRaw)
        ? sourceDurationSecondsRaw
        : null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const formatId = asText(body.formatId);
    const videoId = asText(body.videoId);
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;

    if (!collectionId || !formatId || !videoId) {
      return NextResponse.json(
        { error: "collectionId, formatId, and videoId are required." },
        { status: 400 }
      );
    }

    const [collection, formatResult, videoResult] = await Promise.all([
      fetchCollectionRow(collectionId),
      supabase
        .from("video_formats")
        .select("*")
        .eq("id", formatId)
        .eq("collection_id", collectionId)
        .single(),
      supabase
        .from("video_format_videos")
        .select("id, collection_id, format_id, source_url, platform, title, description, thumbnail_url, user_notes, analysis_payload")
        .eq("id", videoId)
        .eq("collection_id", collectionId)
        .single(),
    ]);

    if (!collection) {
      return NextResponse.json({ error: "Collection not found." }, { status: 404 });
    }

    if (formatResult.error) {
      if (isMissingTableError(formatResult.error)) {
        return NextResponse.json(
          {
            error:
              "Video pipeline tables are missing. Run the video-agent SQL migration first (see supabase-migration.sql).",
          },
          { status: 500 }
        );
      }
      throw formatResult.error;
    }

    if (!formatResult.data) {
      return NextResponse.json({ error: "Format not found." }, { status: 404 });
    }

    if (videoResult.error) {
      if (isMissingTableError(videoResult.error)) {
        return NextResponse.json(
          {
            error:
              "Video pipeline tables are missing. Run the video-agent SQL migration first (see supabase-migration.sql).",
          },
          { status: 500 }
        );
      }
      throw videoResult.error;
    }

    if (!videoResult.data) {
      return NextResponse.json({ error: "Video source not found." }, { status: 404 });
    }

    const format = formatResult.data as unknown as VideoFormatRow;
    const sourceVideo = videoResult.data as unknown as VideoFormatVideoRow;

    if (sourceVideo.format_id !== format.id) {
      return NextResponse.json(
        { error: "Selected video does not belong to the selected format." },
        { status: 400 }
      );
    }

    const appName = (collection.app_name || "Muslimah Pro").trim() || "Muslimah Pro";
    const appContext = (collection.app_description || collection.app_context || "").trim();
    const transcriptContext = getSourceTranscriptFromAnalysisPayload(sourceVideo.analysis_payload);

    const plan = await buildVideoRecreationPlan({
      appName,
      appContext,
      sourceVideo: {
        sourceUrl: sourceVideo.source_url,
        title: sourceVideo.title,
        description: sourceVideo.description,
        platform: sourceVideo.platform,
        userNotes: sourceVideo.user_notes,
        transcriptSummary: transcriptContext.summary,
        transcriptText: transcriptContext.text,
        sourceDurationSeconds: transcriptContext.sourceDurationSeconds,
      },
      format: toFormatAnalysis(format),
      reasoningModel,
    });

    const { data: planRecord, error: planInsertError } = await supabase
      .from("video_recreation_plans")
      .insert({
        collection_id: collectionId,
        format_id: format.id,
        source_video_id: sourceVideo.id,
        app_name: appName,
        plan_payload: {
          reasoningModel,
          generatedAt: new Date().toISOString(),
          plan,
        },
      })
      .select("id, created_at")
      .single();

    if (planInsertError) {
      if (isMissingTableError(planInsertError)) {
        return NextResponse.json(
          {
            error:
              "Video recreation plans table is missing. Run the video-agent SQL migration first (see supabase-migration.sql).",
          },
          { status: 500 }
        );
      }
      throw planInsertError;
    }

    return NextResponse.json({
      plan,
      planId: planRecord?.id || null,
      generatedAt: planRecord?.created_at || new Date().toISOString(),
      format,
      sourceVideo,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate recreation plan." },
      { status: 500 }
    );
  }
}
