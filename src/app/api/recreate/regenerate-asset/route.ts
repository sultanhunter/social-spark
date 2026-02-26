import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/gemini-image";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isImageGenerationModel,
} from "@/lib/image-generation-model";
import {
  DEFAULT_REASONING_MODEL,
  isReasoningModel,
} from "@/lib/reasoning-model";
import { supabase } from "@/lib/supabase";

export const maxDuration = 180;

const APP_BRAND_PRIMARY_COLOR = "#F36F97";
const APP_BRAND_GRADIENT = ["#F36F97", "#EEB4C3", "#F7DFD6"];
const APP_LOGO_PATH = "/Users/sultanibneusman/Desktop/Perri/assets/images/app-logo.png";
const APP_FEATURE_MOCKUP_PATH = path.join(process.cwd(), "public/assets/main_hero.png");

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeMediaUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

function getCollectionAppContext(collection: unknown): string {
  if (typeof collection !== "object" || collection === null) return "";

  const row = collection as Record<string, unknown>;
  const appDescription = asNonEmptyString(row.app_description);
  if (appDescription) return appDescription;

  const appContext = asNonEmptyString(row.app_context);
  if (appContext) return appContext;

  return "";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asNonEmptyString(body.collectionId);
    const postId = asNonEmptyString(body.postId);
    const recreatedPostId = asNonEmptyString(body.recreatedPostId);
    const assetPrompt = asNonEmptyString(body.assetPrompt);
    const assetIndex = asNonNegativeInteger(body.assetIndex);
    const explicitAppName = asNonEmptyString(body.appName);
    const imageGenerationModel = isImageGenerationModel(body.imageGenerationModel)
      ? body.imageGenerationModel
      : DEFAULT_IMAGE_GENERATION_MODEL;
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;

    if (!collectionId || !postId || !recreatedPostId) {
      return NextResponse.json(
        { error: "Collection ID, post ID, and recreated post ID are required" },
        { status: 400 }
      );
    }

    if (assetIndex === null) {
      return NextResponse.json(
        { error: "A valid non-negative asset index is required" },
        { status: 400 }
      );
    }

    if (!assetPrompt) {
      return NextResponse.json(
        { error: "Asset prompt is required" },
        { status: 400 }
      );
    }

    const { data: originalPost, error: postError } = await supabase
      .from("saved_posts")
      .select("platform, media_urls, thumbnail_url")
      .eq("id", postId)
      .eq("collection_id", collectionId)
      .single();

    const { data: collection, error: collectionError } = await supabase
      .from("collections")
      .select("app_name, app_description, app_context")
      .eq("id", collectionId)
      .single();

    if (postError || collectionError) {
      throw new Error("Could not load post context for single-asset regeneration");
    }

    const { data: recreatedPost, error: recreatedPostError } = await supabase
      .from("recreated_posts")
      .select("generated_media_urls")
      .eq("id", recreatedPostId)
      .eq("original_post_id", postId)
      .eq("collection_id", collectionId)
      .single();

    if (recreatedPostError || !recreatedPost) {
      throw new Error("Recreated post set not found for this collection/post pair");
    }

    const generatedMediaUrls = normalizeMediaUrls(recreatedPost.generated_media_urls);
    if (assetIndex >= generatedMediaUrls.length) {
      return NextResponse.json(
        { error: "Asset index is out of range for this recreated set" },
        { status: 400 }
      );
    }

    const platform = asNonEmptyString(originalPost?.platform) || "unknown";
    const thumbnailUrl = asNonEmptyString(originalPost?.thumbnail_url);
    const referenceImageUrls = [
      ...normalizeMediaUrls(originalPost?.media_urls),
      ...(thumbnailUrl ? [thumbnailUrl] : []),
    ].slice(0, 8);

    const appContext = getCollectionAppContext(collection);
    const appName = asNonEmptyString(collection?.app_name) || explicitAppName || appContext || "Social Spark";

    const imageUrl = await generateImage(assetPrompt, {
      collectionId,
      postId,
      index: assetIndex,
      platform,
      generationId: `single-asset-${recreatedPostId}-${Date.now()}`,
      versionId: `recreated-${recreatedPostId}`,
      imageModel: imageGenerationModel,
      uiGenerationMode: "ai_creative",
      referenceImageUrls,
      brandAssets: {
        appName,
        primaryColorHex: APP_BRAND_PRIMARY_COLOR,
        gradientHexColors: APP_BRAND_GRADIENT,
        logoImagePath: APP_LOGO_PATH,
        featureMockupPath: APP_FEATURE_MOCKUP_PATH,
      },
    });

    const nextMediaUrls = [...generatedMediaUrls];
    nextMediaUrls[assetIndex] = imageUrl;

    const { error: updateError } = await supabase
      .from("recreated_posts")
      .update({
        generated_media_urls: nextMediaUrls,
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", recreatedPostId)
      .eq("original_post_id", postId)
      .eq("collection_id", collectionId);

    if (updateError) throw updateError;

    return NextResponse.json({
      recreatedPostId,
      assetIndex,
      imageUrl,
      generatedMediaUrls: nextMediaUrls,
      imageGenerationModel,
      reasoningModel,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to regenerate this asset" },
      { status: 500 }
    );
  }
}
