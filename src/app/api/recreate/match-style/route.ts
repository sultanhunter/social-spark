import path from "path";
import { readFile } from "fs/promises";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import {
  getAssetStylePreset,
  isAssetStylePresetId,
  type AssetStylePresetId,
} from "@/lib/asset-style";
import {
  DEFAULT_REASONING_MODEL,
  isReasoningModel,
  type ReasoningModel,
} from "@/lib/reasoning-model";
import { supabase } from "@/lib/supabase";

export const maxDuration = 300;

const genAI = process.env.GOOGLE_GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY)
  : null;

type SlidePlan = {
  headline: string;
  supportingText: string;
  figmaInstructions: string[];
  assetPrompts: Array<{
    prompt: string;
    description: string;
  }>;
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizeSlidePlans(value: unknown): SlidePlan[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): SlidePlan | null => {
      const row = asRecord(item);
      if (!row) return null;

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

      if (!headline && figmaInstructions.length === 0 && assetPrompts.length === 0) return null;

      return {
        headline,
        supportingText,
        figmaInstructions,
        assetPrompts,
      };
    })
    .filter((plan): plan is SlidePlan => Boolean(plan));
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

  if (path.isAbsolute(styleReferenceImagePath)) return styleReferenceImagePath;
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const postId = asText(body.postId);
    const recreatedPostId = asText(body.recreatedPostId);
    const assetStyleId = isAssetStylePresetId(body.assetStyleId)
      ? body.assetStyleId
      : null;
    const reasoningModel: ReasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;

    if (!collectionId || !postId || !recreatedPostId || !assetStyleId) {
      return NextResponse.json(
        { error: "collectionId, postId, recreatedPostId, and assetStyleId are required." },
        { status: 400 }
      );
    }

    const rowResult = await supabase
      .from("recreated_posts")
      .select("id, slide_plans, generation_state")
      .eq("id", recreatedPostId)
      .eq("collection_id", collectionId)
      .eq("original_post_id", postId)
      .maybeSingle();

    if (rowResult.error) throw rowResult.error;
    if (!rowResult.data) {
      return NextResponse.json({ error: "Saved recreation not found." }, { status: 404 });
    }

    const existingSlidePlans = sanitizeSlidePlans(rowResult.data.slide_plans);
    if (existingSlidePlans.length === 0) {
      return NextResponse.json(
        { error: "No slide plans found for this saved recreation." },
        { status: 400 }
      );
    }

    const previousGenerationState = asRecord(rowResult.data.generation_state) || {};
    const persistedBaseSlidePlans = sanitizeSlidePlans(previousGenerationState.baseSlidePlans);
    const baseSlidePlans = persistedBaseSlidePlans.length > 0
      ? persistedBaseSlidePlans
      : existingSlidePlans;

    const selectedStyle = getAssetStylePreset(assetStyleId);
    let rewrittenAssetCount = 0;
    let nextSlidePlans: SlidePlan[] = baseSlidePlans;

    if (selectedStyle.stylePrompt) {
      const rewrittenPlans: SlidePlan[] = [];

      for (const plan of baseSlidePlans) {
        const rewrittenAssets: SlidePlan["assetPrompts"] = [];

        for (const asset of plan.assetPrompts) {
          const rewrittenPrompt = await applyAssetStylePrompt(
            asset.prompt,
            selectedStyle.stylePrompt,
            selectedStyle.referenceImagePath,
            reasoningModel
          );

          rewrittenAssets.push({
            ...asset,
            prompt: rewrittenPrompt,
          });
          rewrittenAssetCount += 1;
        }

        rewrittenPlans.push({
          ...plan,
          assetPrompts: rewrittenAssets,
        });
      }

      nextSlidePlans = rewrittenPlans;
    } else {
      rewrittenAssetCount = baseSlidePlans.reduce((sum, plan) => sum + plan.assetPrompts.length, 0);
    }

    const nextGenerationState = {
      ...previousGenerationState,
      assetStyleId,
      baseSlidePlans,
      styleMatchedAt: new Date().toISOString(),
      styleMatchedAssetCount: rewrittenAssetCount,
    };

    const updatePayload: Record<string, unknown> = {
      slide_plans: nextSlidePlans,
      generation_state: nextGenerationState,
      updated_at: new Date().toISOString(),
    };

    let { error: updateError } = await supabase
      .from("recreated_posts")
      .update(updatePayload)
      .eq("id", recreatedPostId)
      .eq("collection_id", collectionId)
      .eq("original_post_id", postId);

    if (updateError && /generation_state/i.test(updateError.message || "")) {
      const fallbackPayload = {
        slide_plans: nextSlidePlans,
        updated_at: new Date().toISOString(),
      };

      const fallbackUpdate = await supabase
        .from("recreated_posts")
        .update(fallbackPayload)
        .eq("id", recreatedPostId)
        .eq("collection_id", collectionId)
        .eq("original_post_id", postId);

      updateError = fallbackUpdate.error;
    }

    if (updateError) throw updateError;

    return NextResponse.json({
      recreatedPostId,
      assetStyleId: assetStyleId as AssetStylePresetId,
      rewrittenAssetCount,
      slidePlans: nextSlidePlans,
      generationState: nextGenerationState,
      reasoningModel,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to match style for asset prompts." },
      { status: 500 }
    );
  }
}
