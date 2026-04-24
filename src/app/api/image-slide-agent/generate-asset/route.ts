import path from "path";
import { readFile } from "fs/promises";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_ASSET_STYLE_PRESET,
  getAssetStylePreset,
  isAssetStylePresetId,
} from "@/lib/asset-style";
import type { SlideGenerationPlan } from "@/lib/gemini";
import { generateImage } from "@/lib/gemini-image";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isImageGenerationModel,
  type ImageGenerationModel,
} from "@/lib/image-generation-model";
import {
  DEFAULT_REASONING_MODEL,
  isReasoningModel,
  type ReasoningModel,
} from "@/lib/reasoning-model";

export const runtime = "nodejs";
export const maxDuration = 300;

const APP_BRAND_PRIMARY_COLOR = "#F36F97";
const APP_BRAND_GRADIENT = ["#F36F97", "#EEB4C3", "#F7DFD6"];
const genAI = process.env.GOOGLE_GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY)
  : null;

type GeneratedImageAssetEntry = {
  slideIndex: number;
  assetIndex: number;
  imageUrl: string;
  prompt: string;
  description: string;
  imageModel: string;
  generatedAt: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asIndex(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 0) return null;
  return rounded;
}

function resolveStyleReferenceImagePath(styleReferenceImagePath: string): string {
  if (styleReferenceImagePath.startsWith("/assets/")) {
    return path.join(process.cwd(), "public", styleReferenceImagePath.replace(/^\/+/, ""));
  }

  if (path.isAbsolute(styleReferenceImagePath)) return styleReferenceImagePath;
  return path.join(process.cwd(), styleReferenceImagePath);
}

function normalizePromptResponse(value: string): string {
  return value
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .replace(/^"+|"+$/g, "")
    .trim();
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function isCharacterAssetPrompt(prompt: string, description: string): boolean {
  const combined = `${prompt} ${description}`.toLowerCase();
  return /(woman|female|girl|lady|muslimah|hijab|character|person|portrait|face|model|influencer|selfie)/i.test(
    combined
  );
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  return row.code === "42P01";
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const message = typeof row.message === "string" ? row.message.toLowerCase() : "";
  const details = typeof row.details === "string" ? row.details.toLowerCase() : "";
  const combined = `${message} ${details}`;
  return combined.includes(columnName.toLowerCase()) && combined.includes("column");
}

function parseSlidePlans(value: unknown): SlideGenerationPlan[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): SlideGenerationPlan | null => {
      if (typeof item !== "object" || item === null) return null;
      const row = item as Record<string, unknown>;
      const headline = typeof row.headline === "string" ? row.headline : "";
      const supportingText = typeof row.supportingText === "string" ? row.supportingText : "";
      const figmaInstructions = Array.isArray(row.figmaInstructions)
        ? row.figmaInstructions.filter((step): step is string => typeof step === "string")
        : [];
      const assetPrompts = Array.isArray(row.assetPrompts)
        ? row.assetPrompts
          .filter((asset): asset is Record<string, unknown> => typeof asset === "object" && asset !== null)
          .map((asset) => ({
            prompt: typeof asset.prompt === "string" ? asset.prompt : "",
            description: typeof asset.description === "string" ? asset.description : "Asset",
          }))
          .filter((asset) => asset.prompt.trim().length > 0)
        : [];

      return {
        headline,
        supportingText,
        figmaInstructions,
        assetPrompts,
      };
    })
    .filter((plan): plan is SlideGenerationPlan => Boolean(plan));
}

function parseGeneratedAssets(value: unknown): GeneratedImageAssetEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): GeneratedImageAssetEntry | null => {
      if (typeof item !== "object" || item === null) return null;
      const row = item as Record<string, unknown>;
      const slideIndex = typeof row.slideIndex === "number" ? Math.max(0, Math.round(row.slideIndex)) : 0;
      const assetIndex = typeof row.assetIndex === "number" ? Math.max(0, Math.round(row.assetIndex)) : 0;
      const imageUrl = typeof row.imageUrl === "string" ? row.imageUrl.trim() : "";
      const prompt = typeof row.prompt === "string" ? row.prompt : "";
      const description = typeof row.description === "string" ? row.description : "Asset";
      const imageModel = typeof row.imageModel === "string" ? row.imageModel : "unknown";
      const generatedAt = typeof row.generatedAt === "string" ? row.generatedAt : new Date(0).toISOString();
      if (!imageUrl) return null;
      return {
        slideIndex,
        assetIndex,
        imageUrl,
        prompt,
        description,
        imageModel,
        generatedAt,
      };
    })
    .filter((asset): asset is GeneratedImageAssetEntry => Boolean(asset));
}

async function fetchCollectionAppName(collectionId: string): Promise<string> {
  let result = await supabase
    .from("collections")
    .select("app_name, app_description, app_context")
    .eq("id", collectionId)
    .maybeSingle();

  if (result.error && isMissingColumnError(result.error, "app_context")) {
    result = await supabase
      .from("collections")
      .select("app_name, app_description")
      .eq("id", collectionId)
      .maybeSingle();
  }

  const appName = asText(result.data?.app_name) || "Muslimah Pro";
  return appName;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const planId = asText(body.planId);
    const slideIndex = asIndex(body.slideIndex);
    const assetIndex = asIndex(body.assetIndex);
    const assetStyleId = isAssetStylePresetId(body.assetStyleId)
      ? body.assetStyleId
      : DEFAULT_ASSET_STYLE_PRESET;
    const reasoningModel: ReasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;
    const imageGenerationModel: ImageGenerationModel = isImageGenerationModel(body.imageGenerationModel)
      ? body.imageGenerationModel
      : DEFAULT_IMAGE_GENERATION_MODEL;

    if (!collectionId || !planId) {
      return NextResponse.json({ error: "collectionId and planId are required." }, { status: 400 });
    }

    if (slideIndex === null || assetIndex === null) {
      return NextResponse.json({ error: "slideIndex and assetIndex must be valid non-negative numbers." }, { status: 400 });
    }

    const planResult = await supabase
      .from("video_image_slide_plans")
      .select("id, collection_id, character_id, plan_payload")
      .eq("id", planId)
      .eq("collection_id", collectionId)
      .maybeSingle();

    if (planResult.error) {
      if (isMissingTableError(planResult.error)) {
        return NextResponse.json(
          { error: "Table video_image_slide_plans is missing. Run latest Supabase migration first." },
          { status: 500 }
        );
      }
      throw planResult.error;
    }

    if (!planResult.data) {
      return NextResponse.json({ error: "Image-slide plan not found." }, { status: 404 });
    }

    const payload =
      planResult.data.plan_payload && typeof planResult.data.plan_payload === "object"
        ? (planResult.data.plan_payload as Record<string, unknown>)
        : {};
    const slidePlans = parseSlidePlans(payload.slidePlans);

    if (!slidePlans[slideIndex]) {
      return NextResponse.json({ error: `Slide ${slideIndex + 1} not found in this plan.` }, { status: 400 });
    }

    const asset = slidePlans[slideIndex].assetPrompts[assetIndex];
    if (!asset) {
      return NextResponse.json({ error: `Asset ${assetIndex + 1} not found for slide ${slideIndex + 1}.` }, { status: 400 });
    }

    const assetStylePreset = getAssetStylePreset(assetStyleId);
    const styledAssetPrompt = assetStylePreset.stylePrompt
      ? await applyAssetStylePrompt(
        asset.prompt,
        assetStylePreset.stylePrompt,
        assetStylePreset.referenceImagePath,
        reasoningModel
      )
      : asset.prompt;

    const payloadCharacter = asRecord(payload.character);
    let characterReferenceImageUrl = payloadCharacter ? asText(payloadCharacter.referenceImageUrl) : "";
    let characterLockDescriptor = payloadCharacter ? asText(payloadCharacter.promptTemplate) : "";

    if (!characterReferenceImageUrl && typeof planResult.data.character_id === "string" && planResult.data.character_id) {
      const characterLookup = await supabase
        .from("video_ugc_characters")
        .select("reference_image_url, prompt_template")
        .eq("collection_id", collectionId)
        .eq("id", planResult.data.character_id)
        .maybeSingle();

      if (!characterLookup.error && characterLookup.data) {
        characterReferenceImageUrl = asText(characterLookup.data.reference_image_url);
        if (!characterLockDescriptor) {
          characterLockDescriptor = asText(characterLookup.data.prompt_template);
        }
      }
    }

    const shouldApplyCharacterReference =
      Boolean(characterReferenceImageUrl) && isCharacterAssetPrompt(asset.prompt, asset.description);

    const appName = await fetchCollectionAppName(collectionId);
    const imageUrl = await generateImage(styledAssetPrompt, {
      collectionId,
      postId: planId,
      index: slideIndex * 100 + assetIndex,
      platform: "tiktok",
      generationId: `image-slide-plan-${planId}-${Date.now()}`,
      versionId: `plan-${planId}`,
      uiGenerationMode: "ai_creative",
      visualVariant: "ugc_real",
      forceCarouselAspect: true,
      imageModel: imageGenerationModel,
      characterReferenceImageUrls: shouldApplyCharacterReference && characterReferenceImageUrl
        ? [characterReferenceImageUrl]
        : [],
      characterLockDescriptor: shouldApplyCharacterReference
        ? characterLockDescriptor || "Same fictional woman identity across all assets."
        : undefined,
      brandAssets: {
        appName,
        primaryColorHex: APP_BRAND_PRIMARY_COLOR,
        gradientHexColors: APP_BRAND_GRADIENT,
      },
    });

    const existingGeneratedAssets = parseGeneratedAssets(payload.generatedAssets);
    const nextGeneratedAssets = [
      ...existingGeneratedAssets.filter((entry) => !(entry.slideIndex === slideIndex && entry.assetIndex === assetIndex)),
      {
        slideIndex,
        assetIndex,
        imageUrl,
        prompt: styledAssetPrompt,
        description: asset.description,
        imageModel: imageGenerationModel,
        generatedAt: new Date().toISOString(),
      },
    ].sort((a, b) => {
      if (a.slideIndex !== b.slideIndex) return a.slideIndex - b.slideIndex;
      return a.assetIndex - b.assetIndex;
    });

    const updatedPayload = {
      ...payload,
      generatedAssets: nextGeneratedAssets,
      lastGeneratedAsset: {
        slideIndex,
        assetIndex,
        imageUrl,
        imageModel: imageGenerationModel,
      },
    };

    const updateResult = await supabase
      .from("video_image_slide_plans")
      .update({
        plan_payload: updatedPayload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", planId)
      .eq("collection_id", collectionId)
      .select("id")
      .single();

    if (updateResult.error) {
      throw updateResult.error;
    }

    return NextResponse.json({
      planId,
      slideIndex,
      assetIndex,
      imageUrl,
      imageGenerationModel,
      assetStyleId,
      reasoningModel,
      generatedAssets: nextGeneratedAssets,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate image-slide asset." },
      { status: 500 }
    );
  }
}
