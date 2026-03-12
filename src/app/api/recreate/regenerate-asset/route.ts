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

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const message = typeof row.message === "string" ? row.message.toLowerCase() : "";
  const details = typeof row.details === "string" ? row.details.toLowerCase() : "";
  const combined = `${message} ${details}`;
  return combined.includes("column") && combined.includes(columnName.toLowerCase());
}

function formatSupabaseError(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown error";
  const row = error as Record<string, unknown>;
  const message = typeof row.message === "string" ? row.message : "unknown error";
  const code = typeof row.code === "string" ? row.code : null;
  return code ? `${message} (code: ${code})` : message;
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
    const totalAssets = asPositiveInteger(body.totalAssets);
    const isFinalAsset = body.isFinalAsset === true;
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

    let collectionResult = await supabase
      .from("collections")
      .select("app_name, app_description, app_context")
      .eq("id", collectionId)
      .single();

    if (collectionResult.error && isMissingColumnError(collectionResult.error, "app_context")) {
      collectionResult = await supabase
        .from("collections")
        .select("app_name, app_description")
        .eq("id", collectionId)
        .single();
    }

    const collection = collectionResult.data;
    const collectionError = collectionResult.error;

    if (postError || collectionError) {
      const details = [
        postError ? `post: ${formatSupabaseError(postError)}` : null,
        collectionError ? `collection: ${formatSupabaseError(collectionError)}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      throw new Error(
        details
          ? `Could not load post context for single-asset regeneration (${details})`
          : "Could not load post context for single-asset regeneration"
      );
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

    const generatedMediaUrls = Array.isArray(recreatedPost.generated_media_urls)
      ? recreatedPost.generated_media_urls.map((item) => (typeof item === "string" ? item : ""))
      : [];

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
    if (assetIndex >= nextMediaUrls.length) {
      nextMediaUrls.push(...Array.from({ length: assetIndex - nextMediaUrls.length + 1 }, () => ""));
    }
    nextMediaUrls[assetIndex] = imageUrl;

    const generatedCount = nextMediaUrls.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    ).length;
    const effectiveTotal = totalAssets || nextMediaUrls.length;
    const status = isFinalAsset || generatedCount >= effectiveTotal ? "completed" : "generating";

    const updatePayload: Record<string, unknown> = {
      generated_media_urls: nextMediaUrls,
      status,
      generation_state: {
        generatedAssets: generatedCount,
        totalAssets: effectiveTotal,
        lastAssetIndex: assetIndex,
        updatedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    };

    let { error: updateError } = await supabase
      .from("recreated_posts")
      .update(updatePayload)
      .eq("id", recreatedPostId)
      .eq("original_post_id", postId)
      .eq("collection_id", collectionId);

    if (updateError && /generation_state/i.test(updateError.message || "")) {
      const fallbackPayload = { ...updatePayload };
      delete fallbackPayload.generation_state;

      const fallbackUpdate = await supabase
        .from("recreated_posts")
        .update(fallbackPayload)
        .eq("id", recreatedPostId)
        .eq("original_post_id", postId)
        .eq("collection_id", collectionId);

      updateError = fallbackUpdate.error;
    }

    if (updateError) throw updateError;

    return NextResponse.json({
      recreatedPostId,
      assetIndex,
      imageUrl,
      generatedMediaUrls: nextMediaUrls,
      generatedCount,
      totalAssets: effectiveTotal,
      status,
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
