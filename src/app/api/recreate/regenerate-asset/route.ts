import path from "path";
import { readFile } from "fs/promises";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/gemini-image";
import {
  type AssetStylePresetId,
  DEFAULT_ASSET_STYLE_PRESET,
  getAssetStylePreset,
  isAssetStylePresetId,
} from "@/lib/asset-style";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isImageGenerationModel,
} from "@/lib/image-generation-model";
import {
  DEFAULT_REASONING_MODEL,
  isReasoningModel,
  type ReasoningModel,
} from "@/lib/reasoning-model";
import { supabase } from "@/lib/supabase";

export const maxDuration = 180;

const APP_BRAND_PRIMARY_COLOR = "#F36F97";
const APP_BRAND_GRADIENT = ["#F36F97", "#EEB4C3", "#F7DFD6"];
const APP_LOGO_PATH = "/Users/sultanibneusman/Desktop/Perri/assets/images/app-logo.png";
const APP_FEATURE_MOCKUP_PATH = path.join(process.cwd(), "public/assets/main_hero.png");
const genAI = process.env.GOOGLE_GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY)
  : null;

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asAssetStylePresetId(value: unknown): AssetStylePresetId | null {
  if (!isAssetStylePresetId(value)) return null;
  return value;
}

function asCharacterMapByAssetIndex(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record)
    .map(([key, rawValue]) => [key, asNonEmptyString(rawValue)] as const)
    .filter(([, rawValue]) => typeof rawValue === "string" && rawValue.length > 0)
    .map(([key, rawValue]) => [key, rawValue as string] as const);

  return Object.fromEntries(entries);
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

function isCharacterAssetPrompt(prompt: string): boolean {
  return /(woman|female|girl|lady|muslimah|hijab|man|male|boy|father|husband|character|person|portrait|face|model|influencer)/i.test(
    prompt.toLowerCase()
  );
}

function inferCharacterGenderFromPrompt(prompt: string): "male" | "female" {
  const normalized = prompt.toLowerCase();
  if (/(man|male|boy|father|husband|brother|beard|bearded)/i.test(normalized)) {
    return "male";
  }
  return "female";
}

function asVisualVariant(value: unknown): "ugc_real" | "brand_optimized" | null {
  if (value === "ugc_real" || value === "brand_optimized") return value;
  return null;
}

function normalizePromptResponse(value: string): string {
  return value
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .replace(/^"+|"+$/g, "")
    .trim();
}

function resolveStyleReferenceImagePath(styleReferenceImagePath: string): string {
  if (styleReferenceImagePath.startsWith("/assets/")) {
    return path.join(process.cwd(), "public", styleReferenceImagePath.replace(/^\/+/, ""));
  }

  if (path.isAbsolute(styleReferenceImagePath)) {
    return styleReferenceImagePath;
  }

  return path.join(process.cwd(), styleReferenceImagePath);
}

async function applyAssetStylePrompt(
  assetPrompt: string,
  stylePrompt: string,
  styleReferenceImagePath: string,
  reasoningModel: ReasoningModel
): Promise<string> {
  const fallbackPrompt = `${assetPrompt}\n\nStyle reference to match: ${stylePrompt}`;

  if (!genAI) return fallbackPrompt;

  try {
    const model = genAI.getGenerativeModel({ model: reasoningModel });
    const instruction = `Rewrite this image-generation prompt to preserve the original subject intent but match the style reference.

ORIGINAL ASSET PROMPT:
${assetPrompt}

STYLE REFERENCE:
${stylePrompt}

Rules:
- Keep the original subject, scene purpose, and composition intent.
- Apply the style reference strongly and consistently.
- Keep it practical for image generation.
- Do not add markdown, labels, bullets, JSON, or explanations.

Return only the final rewritten prompt.`;

    let response;
    if (styleReferenceImagePath) {
      try {
        const resolvedReferencePath = resolveStyleReferenceImagePath(styleReferenceImagePath);
        const imageBuffer = await readFile(resolvedReferencePath);
        const lowerPath = resolvedReferencePath.toLowerCase();
        const mimeType =
          lowerPath.endsWith(".png")
            ? "image/png"
            : lowerPath.endsWith(".webp")
              ? "image/webp"
              : "image/jpeg";

        response = await model.generateContent([
          { text: instruction },
          {
            inlineData: {
              data: imageBuffer.toString("base64"),
              mimeType,
            },
          },
        ]);
      } catch {
        response = await model.generateContent(instruction);
      }
    } else {
      response = await model.generateContent(instruction);
    }

    const rewritten = normalizePromptResponse(response.response.text());
    return rewritten.length > 0 ? rewritten : fallbackPrompt;
  } catch {
    return fallbackPrompt;
  }
}

type UgcCharacterRow = {
  id: string;
  prompt_template: string | null;
  reference_image_url: string | null;
};

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
    const selectedCharacterId = asNonEmptyString(body.characterId);
    const requestedVisualVariant = asVisualVariant(body.visualVariant);
    const requestedAssetStyleId = asAssetStylePresetId(body.assetStyleId);
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
      .select("platform, post_type, media_urls, thumbnail_url")
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
      .select("generated_media_urls, generation_state")
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
    const forceCarouselAspect = originalPost?.post_type === "image_slides";
    const thumbnailUrl = asNonEmptyString(originalPost?.thumbnail_url);
    const referenceImageUrls = [
      ...normalizeMediaUrls(originalPost?.media_urls),
      ...(thumbnailUrl ? [thumbnailUrl] : []),
    ].slice(0, 8);

    const appContext = getCollectionAppContext(collection);
    const appName = asNonEmptyString(collection?.app_name) || explicitAppName || appContext || "Social Spark";
    const previousGenerationState =
      recreatedPost.generation_state && typeof recreatedPost.generation_state === "object"
        ? (recreatedPost.generation_state as Record<string, unknown>)
        : {};
    const persistedVisualVariant = asVisualVariant(previousGenerationState.visualVariant);
    const visualVariant = requestedVisualVariant || persistedVisualVariant || "brand_optimized";
    const persistedCharacterId = asNonEmptyString(previousGenerationState.characterId);
    const persistedCharacterMap = asCharacterMapByAssetIndex(previousGenerationState.characterMapByAssetIndex);
    const mappedCharacterId = asNonEmptyString(persistedCharacterMap[String(assetIndex)]);
    const preferredCharacterId = mappedCharacterId || selectedCharacterId || persistedCharacterId;
    const persistedAssetStyleId = asAssetStylePresetId(previousGenerationState.assetStyleId);
    const assetStyleId =
      requestedAssetStyleId || persistedAssetStyleId || DEFAULT_ASSET_STYLE_PRESET;
    const assetStylePreset = getAssetStylePreset(assetStyleId);
    const styledAssetPrompt = assetStylePreset.stylePrompt
      ? await applyAssetStylePrompt(
        assetPrompt,
        assetStylePreset.stylePrompt,
        assetStylePreset.referenceImagePath,
        reasoningModel
      )
      : assetPrompt;

    const isCharacterAsset = isCharacterAssetPrompt(assetPrompt);
    const firstExistingGenerated = generatedMediaUrls.find(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    );

    let studioCharacter: UgcCharacterRow | null = null;
    if (isCharacterAsset) {
      const fetchSelected = async () => {
        if (!preferredCharacterId) return { data: null as UgcCharacterRow | null, error: null as unknown };
        const result = await supabase
          .from("video_ugc_characters")
          .select("id, prompt_template, reference_image_url")
          .eq("collection_id", collectionId)
          .eq("id", preferredCharacterId)
          .maybeSingle();
        return { data: (result.data as UgcCharacterRow | null) || null, error: result.error };
      };

      const fetchDefault = async () => {
        let result = await supabase
          .from("video_ugc_characters")
          .select("id, prompt_template, reference_image_url")
          .eq("collection_id", collectionId)
          .eq("is_default", true)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (result.error && isMissingColumnError(result.error, "is_default")) {
          result = await supabase
            .from("video_ugc_characters")
            .select("id, prompt_template, reference_image_url")
            .eq("collection_id", collectionId)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        }

        return { data: (result.data as UgcCharacterRow | null) || null, error: result.error };
      };

      const selectedResult = await fetchSelected();
      if (!selectedResult.error && selectedResult.data) {
        studioCharacter = selectedResult.data;
      } else {
        const defaultResult = await fetchDefault();
        if (!defaultResult.error && defaultResult.data) {
          studioCharacter = defaultResult.data;
        }
      }
    }

    const characterReferenceImageUrls =
      isCharacterAsset && studioCharacter?.reference_image_url
        ? [studioCharacter.reference_image_url]
        : isCharacterAsset && firstExistingGenerated
          ? [firstExistingGenerated]
          : [];

    const characterLockDescriptor = isCharacterAsset
      ? studioCharacter?.prompt_template ||
        (inferCharacterGenderFromPrompt(assetPrompt) === "male"
          ? "Same fictional male identity across all character assets. Preserve face, age range, skin tone, and masculine styling. Always keep a clearly visible natural beard in every appearance."
          : "Same fictional female identity across all character assets. Preserve face, age range, skin tone, and hijab/wardrobe style. Always use loose hijab and loose, modest, non-tight, non-revealing clothing.")
      : undefined;

    const imageUrl = await generateImage(styledAssetPrompt, {
      collectionId,
      postId,
      index: assetIndex,
      platform,
      generationId: `single-asset-${recreatedPostId}-${Date.now()}`,
      versionId: `recreated-${recreatedPostId}`,
      imageModel: imageGenerationModel,
      uiGenerationMode: "ai_creative",
      referenceImageUrls,
      visualVariant,
      forceCarouselAspect,
      characterReferenceImageUrls,
      characterLockDescriptor,
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
        ...previousGenerationState,
        visualVariant,
        assetStyleId,
        characterId: studioCharacter?.id || preferredCharacterId || null,
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
      assetStyleId,
      appliedAssetPrompt: styledAssetPrompt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to regenerate this asset" },
      { status: 500 }
    );
  }
}
