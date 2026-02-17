import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; postId: string }> }
) {
  try {
    const { collectionId, postId } = await params;

    const { data, error } = await supabase
      .from("recreated_posts")
      .select("id, script, generated_media_urls, caption, status, created_at, updated_at")
      .eq("collection_id", collectionId)
      .eq("original_post_id", postId)
      .eq("status", "completed")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch recreation history" },
      { status: 500 }
    );
  }
}
