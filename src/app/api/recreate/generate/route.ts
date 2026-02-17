import { NextRequest, NextResponse } from "next/server";
import { generateImagePrompts } from "@/lib/gemini";
import { generateSlideImages } from "@/lib/gemini-image";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { script, collectionId, postId, appName } = body;

    if (!script || !collectionId || !postId || !appName) {
      return NextResponse.json(
        { error: "Script, collection ID, post ID, and app name are required" },
        { status: 400 }
      );
    }

    // Step 1: Generate image prompts from the script using Gemini
    const slideCount = 6; // Default to 6 slides
    const imagePrompts = await generateImagePrompts(script, appName, slideCount);

    // Step 2: Generate images using Gemini Imagen 3 and upload to R2
    const images = await generateSlideImages(imagePrompts, collectionId, postId);

    // Step 3: Update the recreated post with generated images
    const { error: updateError } = await supabase
      .from("recreated_posts")
      .update({
        generated_media_urls: images,
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("original_post_id", postId)
      .eq("collection_id", collectionId);

    if (updateError) {
      console.error("Failed to update recreated post:", updateError);
    }

    return NextResponse.json({ images, prompts: imagePrompts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate images" },
      { status: 500 }
    );
  }
}
