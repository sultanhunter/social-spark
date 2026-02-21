import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { publishInstagramPostSet } from "@/lib/instagram-publisher";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, 10);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const collectionId = asNonEmptyString(body.collectionId);
    const postId = asNonEmptyString(body.postId);
    const recreatedPostId = asNonEmptyString(body.recreatedPostId);
    const requestCaption = asNonEmptyString(body.caption) || "";
    const requestImageUrls = normalizeImageUrls(body.imageUrls);

    if (!collectionId || !postId) {
      return NextResponse.json(
        { error: "Collection ID and post ID are required." },
        { status: 400 }
      );
    }

    let imageUrls = requestImageUrls;
    let caption = requestCaption;

    if (recreatedPostId && (imageUrls.length === 0 || !caption)) {
      const { data: recreated, error: recreatedError } = await supabase
        .from("recreated_posts")
        .select("generated_media_urls, caption")
        .eq("id", recreatedPostId)
        .eq("collection_id", collectionId)
        .eq("original_post_id", postId)
        .single();

      if (recreatedError) {
        throw recreatedError;
      }

      if (imageUrls.length === 0) {
        imageUrls = normalizeImageUrls(recreated?.generated_media_urls);
      }

      if (!caption) {
        caption = asNonEmptyString(recreated?.caption) || "";
      }
    }

    if (imageUrls.length === 0) {
      return NextResponse.json(
        { error: "No generated images were provided for Instagram publishing." },
        { status: 400 }
      );
    }

    const accessToken =
      asNonEmptyString(body.accessToken) || asNonEmptyString(process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN);
    const igUserId = asNonEmptyString(body.igUserId) || asNonEmptyString(process.env.INSTAGRAM_GRAPH_USER_ID);

    if (!accessToken || !igUserId) {
      return NextResponse.json(
        {
          error:
            "Instagram publishing is not configured. Set INSTAGRAM_GRAPH_ACCESS_TOKEN and INSTAGRAM_GRAPH_USER_ID, or send accessToken/igUserId in request.",
        },
        { status: 400 }
      );
    }

    const publishResult = await publishInstagramPostSet({
      accessToken,
      igUserId,
      imageUrls,
      caption,
      apiVersion: asNonEmptyString(process.env.INSTAGRAM_GRAPH_API_VERSION) || undefined,
    });

    return NextResponse.json({
      success: true,
      ...publishResult,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to publish post set to Instagram.",
      },
      { status: 500 }
    );
  }
}
