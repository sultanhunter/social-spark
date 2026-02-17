import { NextRequest, NextResponse } from "next/server";
import { generatePostCaption } from "@/lib/gemini";
import { supabase } from "@/lib/supabase";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function summarizeSlides(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item, index): string | null => {
      if (typeof item !== "object" || item === null) return null;
      const row = item as Record<string, unknown>;
      const headline = typeof row.headline === "string" ? row.headline.trim() : "";
      const supportingText = typeof row.supportingText === "string" ? row.supportingText.trim() : "";

      if (!headline && !supportingText) return null;

      const parts = [headline ? `Headline: ${headline}` : "", supportingText ? `Supporting: ${supportingText}` : ""]
        .filter(Boolean)
        .join(" | ");

      return `Slide ${index + 1}: ${parts}`;
    })
    .filter((summary): summary is string => Boolean(summary))
    .slice(0, 10);
}

function getCollectionAppContext(collection: unknown): string {
  if (typeof collection !== "object" || collection === null) return "";
  const row = collection as Record<string, unknown>;
  return (
    asNonEmptyString(row.app_description) ||
    asNonEmptyString(row.app_context) ||
    ""
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asNonEmptyString(body.collectionId);
    const postId = asNonEmptyString(body.postId);
    const recreatedPostId = asNonEmptyString(body.recreatedPostId);
    const slideSummaries = summarizeSlides(body.slidePlans);
    let script = asNonEmptyString(body.script);

    if (!collectionId || !postId) {
      return NextResponse.json(
        { error: "Collection ID and post ID are required" },
        { status: 400 }
      );
    }

    if (!script && recreatedPostId) {
      const { data: recreated, error: recreatedError } = await supabase
        .from("recreated_posts")
        .select("script")
        .eq("id", recreatedPostId)
        .eq("collection_id", collectionId)
        .eq("original_post_id", postId)
        .single();

      if (recreatedError) throw recreatedError;
      script = asNonEmptyString(recreated?.script);
    }

    if (!script) {
      return NextResponse.json(
        { error: "Script is required to generate a caption" },
        { status: 400 }
      );
    }

    const [collectionResult, postResult] = await Promise.all([
      supabase.from("collections").select("*").eq("id", collectionId).single(),
      supabase.from("saved_posts").select("platform, title, description").eq("id", postId).single(),
    ]);

    if (collectionResult.error) throw collectionResult.error;
    if (postResult.error) throw postResult.error;

    const appName = asNonEmptyString(collectionResult.data?.app_name);
    if (!appName) {
      return NextResponse.json(
        { error: "Collection is missing an app name." },
        { status: 400 }
      );
    }

    const appContext = getCollectionAppContext(collectionResult.data);
    const platform = asNonEmptyString(postResult.data?.platform) || "unknown";

    const caption = await generatePostCaption({
      script,
      appName,
      appContext,
      platform,
      slideSummaries,
      originalTitle: asNonEmptyString(postResult.data?.title),
      originalDescription: asNonEmptyString(postResult.data?.description),
    });

    if (recreatedPostId) {
      const { error: updateError } = await supabase
        .from("recreated_posts")
        .update({
          caption,
          updated_at: new Date().toISOString(),
        })
        .eq("id", recreatedPostId)
        .eq("collection_id", collectionId)
        .eq("original_post_id", postId);

      if (updateError) {
        console.error("Failed to update caption:", updateError);
      }
    }

    return NextResponse.json({ caption });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate caption" },
      { status: 500 }
    );
  }
}
