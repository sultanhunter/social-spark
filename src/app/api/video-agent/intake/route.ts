import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  analyzeVideoFormatFromSource,
  fetchVideoSourceMetadata,
  matchCandidateToExistingFormat,
  type ExistingFormatCandidate,
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

function toCandidateRows(rows: VideoFormatRow[]): ExistingFormatCandidate[] {
  return rows.map((row) => ({
    id: row.id,
    formatName: row.format_name,
    formatType: row.format_type,
    formatSignature: row.format_signature,
    summary: row.summary,
    hookPatterns: Array.isArray(row.hook_patterns) ? row.hook_patterns : [],
    editingStyle: Array.isArray(row.editing_style) ? row.editing_style : [],
  }));
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

    const formatAnalysis = await analyzeVideoFormatFromSource(sourceMetadata, reasoningModel);
    sourceMetadata.transcriptSummary = formatAnalysis.transcriptSummary || null;
    sourceMetadata.transcriptText = formatAnalysis.transcriptText || null;

    const { data: existingFormats, error: existingFormatsError } = await supabase
      .from("video_formats")
      .select("*")
      .eq("collection_id", collectionId)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (existingFormatsError) {
      if (isMissingTableError(existingFormatsError)) {
        return NextResponse.json(
          {
            error:
              "Video pipeline tables are missing. Run the video-agent SQL migration first (see supabase-migration.sql).",
          },
          { status: 500 }
        );
      }
      throw existingFormatsError;
    }

    const existingRows = Array.isArray(existingFormats)
      ? (existingFormats as unknown as VideoFormatRow[])
      : [];

    const matchDecision = await matchCandidateToExistingFormat(
      formatAnalysis,
      toCandidateRows(existingRows),
      reasoningModel
    );

    const matchedRow = existingRows.find((row) => row.id === matchDecision.matchedFormatId) || null;

    let formatRow: VideoFormatRow;
    let createdNewFormat = false;

    if (matchedRow) {
      const nextSourceCount = (typeof matchedRow.source_count === "number" ? matchedRow.source_count : 0) + 1;

      const { data: updatedFormat, error: updateError } = await supabase
        .from("video_formats")
        .update({
          source_count: nextSourceCount,
          latest_source_url: sourceUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", matchedRow.id)
        .select("*")
        .single();

      if (updateError || !updatedFormat) throw updateError || new Error("Failed to update format group.");

      formatRow = updatedFormat as unknown as VideoFormatRow;
    } else {
      createdNewFormat = true;
      const insertPayload = {
        collection_id: collectionId,
        format_name: formatAnalysis.formatName,
        format_type: formatAnalysis.formatType,
        format_signature: formatAnalysis.formatSignature,
        summary: formatAnalysis.summary,
        why_it_works: formatAnalysis.whyItWorks,
        hook_patterns: formatAnalysis.hookPatterns,
        shot_pattern: formatAnalysis.shotPattern,
        editing_style: formatAnalysis.editingStyle,
        script_scaffold: formatAnalysis.scriptScaffold,
        higgsfield_prompt_template: formatAnalysis.higgsfieldPromptTemplate,
        recreation_checklist: formatAnalysis.recreationChecklist,
        duration_guidance: formatAnalysis.durationGuidance,
        confidence: formatAnalysis.confidence,
        source_count: 1,
        latest_source_url: sourceUrl,
      };

      const { data: insertedFormat, error: insertFormatError } = await supabase
        .from("video_formats")
        .insert(insertPayload)
        .select("*")
        .single();

      if (insertFormatError) {
        const isDuplicate = insertFormatError.code === "23505";

        if (!isDuplicate) {
          throw insertFormatError;
        }

        const { data: duplicateMatch, error: duplicateFetchError } = await supabase
          .from("video_formats")
          .select("*")
          .eq("collection_id", collectionId)
          .eq("format_signature", formatAnalysis.formatSignature)
          .single();

        if (duplicateFetchError || !duplicateMatch) {
          throw duplicateFetchError || insertFormatError;
        }

        const duplicateRow = duplicateMatch as unknown as VideoFormatRow;
        const nextSourceCount = (typeof duplicateRow.source_count === "number" ? duplicateRow.source_count : 0) + 1;

        const { data: updatedDuplicate, error: duplicateUpdateError } = await supabase
          .from("video_formats")
          .update({
            source_count: nextSourceCount,
            latest_source_url: sourceUrl,
            updated_at: new Date().toISOString(),
          })
          .eq("id", duplicateRow.id)
          .select("*")
          .single();

        if (duplicateUpdateError || !updatedDuplicate) {
          throw duplicateUpdateError || new Error("Failed to recover duplicated format insert.");
        }

        createdNewFormat = false;
        formatRow = updatedDuplicate as unknown as VideoFormatRow;
      } else {
        if (!insertedFormat) {
          throw new Error("Failed to create format group.");
        }

        formatRow = insertedFormat as unknown as VideoFormatRow;
      }
    }

    const analysisPayload = {
      sourceMetadata,
      formatAnalysis,
      matchDecision,
      reasoningModel,
      analyzedAt: new Date().toISOString(),
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
        analysis_confidence: formatAnalysis.confidence,
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
      matchDecision,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to analyze and store video format." },
      { status: 500 }
    );
  }
}
