import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

type VideoRow = {
  id: string;
  collection_id: string;
  format_id: string;
  source_url: string;
  created_at: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  return row.code === "42P01";
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const videoId = asText(body.videoId);

    if (!collectionId || !videoId) {
      return NextResponse.json(
        { error: "collectionId and videoId are required." },
        { status: 400 }
      );
    }

    const sourceResult = await supabase
      .from("video_format_videos")
      .select("id, collection_id, format_id, source_url, created_at")
      .eq("id", videoId)
      .eq("collection_id", collectionId)
      .single();

    if (sourceResult.error || !sourceResult.data) {
      return NextResponse.json({ error: "Video source not found." }, { status: 404 });
    }

    const sourceRow = sourceResult.data as unknown as VideoRow;

    const deletePlans = await supabase
      .from("video_recreation_plans")
      .delete()
      .eq("collection_id", collectionId)
      .eq("source_video_id", sourceRow.id);

    if (deletePlans.error && !isMissingTableError(deletePlans.error)) {
      throw deletePlans.error;
    }

    const deleteVideo = await supabase
      .from("video_format_videos")
      .delete()
      .eq("id", sourceRow.id)
      .eq("collection_id", collectionId);

    if (deleteVideo.error) {
      throw deleteVideo.error;
    }

    const remainingVideosResult = await supabase
      .from("video_format_videos")
      .select("id, source_url, created_at")
      .eq("collection_id", collectionId)
      .eq("format_id", sourceRow.format_id)
      .order("created_at", { ascending: false });

    if (remainingVideosResult.error) {
      throw remainingVideosResult.error;
    }

    const remainingVideos = Array.isArray(remainingVideosResult.data)
      ? (remainingVideosResult.data as Array<{ id: string; source_url: string; created_at: string }>)
      : [];

    if (remainingVideos.length === 0) {
      const deleteFormat = await supabase
        .from("video_formats")
        .delete()
        .eq("id", sourceRow.format_id)
        .eq("collection_id", collectionId);

      if (deleteFormat.error) {
        throw deleteFormat.error;
      }
    } else {
      const updateFormat = await supabase
        .from("video_formats")
        .update({
          source_count: remainingVideos.length,
          latest_source_url: remainingVideos[0]?.source_url || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sourceRow.format_id)
        .eq("collection_id", collectionId);

      if (updateFormat.error) {
        throw updateFormat.error;
      }
    }

    return NextResponse.json({
      deletedVideoId: sourceRow.id,
      deletedFormatId: remainingVideos.length === 0 ? sourceRow.format_id : null,
      remainingSourceCount: remainingVideos.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete video source." },
      { status: 500 }
    );
  }
}
