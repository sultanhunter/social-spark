import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; postId: string }> }
) {
  try {
    const { collectionId, postId } = await params;

    const primaryQuery = await supabase
      .from("recreated_posts")
      .select("id, script, generated_media_urls, caption, status, generation_state, created_at, updated_at")
      .eq("collection_id", collectionId)
      .eq("original_post_id", postId)
      .order("created_at", { ascending: false });

    if (!primaryQuery.error) {
      return NextResponse.json(primaryQuery.data);
    }

    if (!/generation_state/i.test(primaryQuery.error.message || "")) {
      throw primaryQuery.error;
    }

    const fallbackQuery = await supabase
      .from("recreated_posts")
      .select("id, script, generated_media_urls, caption, status, created_at, updated_at")
      .eq("collection_id", collectionId)
      .eq("original_post_id", postId)
      .order("created_at", { ascending: false });

    if (fallbackQuery.error) throw fallbackQuery.error;
    return NextResponse.json(fallbackQuery.data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch recreation history" },
      { status: 500 }
    );
  }
}
