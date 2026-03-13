import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractVideoFrames } from "@/lib/social-extractor";

export const runtime = "nodejs";

type VideoRow = {
  id: string;
  collection_id: string;
  format_id: string;
  source_url: string;
  platform: string;
  analysis_payload: Record<string, unknown> | null;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const videoId = asText(body.videoId);
    const collectionId = asText(body.collectionId);

    if (!videoId || !collectionId) {
      return NextResponse.json(
        { error: "videoId and collectionId are required." },
        { status: 400 }
      );
    }

    // Fetch the existing video row
    const { data: video, error: fetchError } = await supabase
      .from("video_format_videos")
      .select("id, collection_id, format_id, source_url, platform, analysis_payload")
      .eq("id", videoId)
      .eq("collection_id", collectionId)
      .single();

    if (fetchError || !video) {
      return NextResponse.json({ error: "Video not found." }, { status: 404 });
    }

    const row = video as unknown as VideoRow;
    const platform = row.platform as "instagram" | "tiktok";

    if (platform !== "instagram" && platform !== "tiktok") {
      return NextResponse.json(
        { error: `Unsupported platform for R2 refresh: ${row.platform}` },
        { status: 400 }
      );
    }

    // Call the extractor to re-download the video and upload to R2.
    // We only need the r2VideoUrl from the response; frames/transcript are discarded.
    const extraction = await extractVideoFrames(row.source_url, platform, {
      frameCount: 2, // minimum to avoid validation errors
      frameWidth: 480, // smallest supported - we don't need the frames
      includeTranscript: false,
      collectionId,
    });

    const r2VideoUrl = extraction.r2VideoUrl;

    if (!r2VideoUrl) {
      return NextResponse.json(
        { error: "R2 upload did not return a URL. Check extractor R2 configuration." },
        { status: 502 }
      );
    }

    // Patch r2VideoUrl into the existing analysis_payload
    const currentPayload =
      row.analysis_payload && typeof row.analysis_payload === "object"
        ? { ...row.analysis_payload }
        : {};

    const currentAnalysis =
      currentPayload.formatAnalysis && typeof currentPayload.formatAnalysis === "object"
        ? { ...(currentPayload.formatAnalysis as Record<string, unknown>) }
        : {};

    currentAnalysis.r2VideoUrl = r2VideoUrl;

    // Also update directMediaUrl if the extractor returned a fresh one
    if (extraction.videoUrl) {
      currentAnalysis.directMediaUrl = extraction.videoUrl;
    }

    currentPayload.formatAnalysis = currentAnalysis;
    currentPayload.r2RefreshedAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("video_format_videos")
      .update({ analysis_payload: currentPayload })
      .eq("id", videoId);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      videoId,
      r2VideoUrl,
      refreshedAt: currentPayload.r2RefreshedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to refresh R2 video." },
      { status: 500 }
    );
  }
}
