import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generatePostScript } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { postId, collectionId } = body;

    if (!postId || !collectionId) {
      return NextResponse.json(
        { error: "Post ID and collection ID are required" },
        { status: 400 }
      );
    }

    // Fetch post and collection
    const [postResult, collectionResult] = await Promise.all([
      supabase.from("saved_posts").select("*").eq("id", postId).single(),
      supabase.from("collections").select("*").eq("id", collectionId).single(),
    ]);

    if (postResult.error) throw new Error("Post not found");
    if (collectionResult.error) throw new Error("Collection not found");

    const post = postResult.data;
    const collection = collectionResult.data;

    if (!collection.app_description) {
      return NextResponse.json(
        {
          error:
            "Please provide an app description so the AI can understand your app context.",
        },
        { status: 400 }
      );
    }

    // Generate script with Gemini
    const script = await generatePostScript(
      {
        title: post.title,
        description: post.description,
        platform: post.platform,
        postType: post.post_type,
      },
      collection.app_description,
      collection.app_name
    );

    // Save recreated post record
    const { data: recreated, error: insertError } = await supabase
      .from("recreated_posts")
      .insert({
        original_post_id: postId,
        collection_id: collectionId,
        script,
        status: "draft",
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({ script, recreatedPostId: recreated.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate script" },
      { status: 500 }
    );
  }
}
