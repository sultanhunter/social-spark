import { randomUUID } from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/gemini-image";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isImageGenerationModel,
  type ImageGenerationModel,
} from "@/lib/image-generation-model";
import { DEFAULT_REASONING_MODEL } from "@/lib/reasoning-model";
import { uploadToR2 } from "@/lib/r2";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

type PlanRow = {
  id: string;
  app_name: string;
  plan_payload: Record<string, unknown> | null;
  created_at: string;
};

type MotionControlSegment = {
  segmentId: number;
  timecode: string;
  startFramePrompt?: string;
  characterReferenceIds?: string[];
  script?: {
    hook?: string;
    cta?: string;
    shots?: Array<{
      shotId?: string;
      visual?: string;
      narration?: string;
      onScreenText?: string;
      editNote?: string;
    }>;
  };
  multiShotPrompts?: Array<{
    prompt?: string;
  }>;
};

type ScriptCharacterRecord = {
  id: string;
  key: string;
  name: string;
  role: string;
  visualIdentityPrompt: string;
  styleNotes: string;
  imageUrl: string;
  segmentIds: number[];
};

type PlanShape = {
  title?: string;
  objective?: string;
  campaignMode?: string;
  selectedVideoType?: string;
  motionControlSegments?: MotionControlSegment[];
  scriptCharacters?: {
    generatedAt?: string;
    imageModel?: string;
    characters?: ScriptCharacterRecord[];
    segmentCharacterMap?: Array<{
      segmentId: number;
      characterIds: string[];
    }>;
  };
};

type ModelCharacterDraft = {
  key: string;
  name: string;
  role: string;
  visualIdentityPrompt: string;
  styleNotes: string;
  segmentIds: number[];
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanText(value: unknown): string {
  return asText(value).replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return isRecord(parsed) ? parsed : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function slugify(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return normalized || fallback;
}

function dataUrlToBuffer(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Generated character reference is not a valid image data URL.");
  }

  const mimeType = match[1] || "image/png";
  const base64 = match[2] || "";
  return {
    mimeType,
    buffer: Buffer.from(base64, "base64"),
  };
}

function coerceSegmentIds(value: unknown, validSegmentIds: number[]): number[] {
  if (!Array.isArray(value)) return [];
  const validSet = new Set(validSegmentIds);
  const ids = value
    .map((item) => (typeof item === "number" ? Math.floor(item) : Number.parseInt(String(item || ""), 10)))
    .filter((item) => Number.isFinite(item) && validSet.has(item));
  return Array.from(new Set(ids));
}

function buildFallbackCharacterDrafts(segments: MotionControlSegment[], campaignMode: string): ModelCharacterDraft[] {
  const segmentIds = segments.map((segment) => segment.segmentId);
  const isAiObjectsMode = campaignMode === "ai_objects_educational_explainer";

  if (isAiObjectsMode) {
    return [
      {
        key: "guide_object",
        name: "Guide Object",
        role: "Primary explainer",
        visualIdentityPrompt:
          "Cute feminine-coded anthropomorphic household object with expressive eyes, soft silhouette, and educational-friendly design language.",
        styleNotes: "Premium stylized 3D CGI look, warm pastel palette, gentle gestures, clear readable face at medium-close framing.",
        segmentIds,
      },
    ];
  }

  return [
    {
      key: "guide_host",
      name: "Guide Host",
      role: "Primary narrator",
      visualIdentityPrompt:
        "Warm female presenter identity with calm, practical expression and continuity-safe styling.",
      styleNotes: "Keep identity stable, modest styling, and clear educational screen presence.",
      segmentIds,
    },
  ];
}

async function inferCharacterDrafts(args: {
  appName: string;
  campaignMode: string;
  selectedVideoType: string;
  segments: MotionControlSegment[];
  reasoningModel: string;
}): Promise<ModelCharacterDraft[]> {
  const { appName, campaignMode, selectedVideoType, segments, reasoningModel } = args;
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    return buildFallbackCharacterDrafts(segments, campaignMode);
  }

  const segmentDigest = segments.map((segment) => ({
    segmentId: segment.segmentId,
    timecode: cleanText(segment.timecode),
    startFramePrompt: cleanText(segment.startFramePrompt),
    hook: cleanText(segment.script?.hook),
    cta: cleanText(segment.script?.cta),
    shots: Array.isArray(segment.script?.shots)
      ? segment.script?.shots?.slice(0, 3).map((shot) => ({
        visual: cleanText(shot.visual),
        narration: cleanText(shot.narration),
        onScreenText: cleanText(shot.onScreenText),
      }))
      : [],
    firstPrompt: Array.isArray(segment.multiShotPrompts)
      ? cleanText(segment.multiShotPrompts[0]?.prompt)
      : "",
  }));

  const prompt = `You are a character continuity casting director for short-form videos.

APP CONTEXT:
- App name: ${appName}
- Campaign mode: ${campaignMode || "standard"}
- Selected video type: ${selectedVideoType || "unknown"}

TASK:
- Read all segment scripts and identify recurring ON-SCREEN characters/entities that must stay visually consistent.
- Include anthropomorphic objects as characters if they are personified narrators/explainers.
- For this women-focused app, default to feminine-coded, women-audience-friendly character styling unless script explicitly requires otherwise.
- Keep cast compact (1-5 characters max).
- Do NOT include background props that do not act as characters.

SEGMENT DATA:
${JSON.stringify(segmentDigest, null, 2)}

Return strict JSON only:
{
  "characters": [
    {
      "key": "snake_case_key",
      "name": "Display Name",
      "role": "short role",
      "visualIdentityPrompt": "one concise sentence for how this character should look",
      "styleNotes": "one concise sentence for style/consistency cues",
      "segmentIds": [1,2,3]
    }
  ]
}`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: reasoningModel || DEFAULT_REASONING_MODEL });
    const result = await model.generateContent(prompt);
    const parsed = parseJsonObject(result.response.text()) || {};
    const rows = Array.isArray(parsed.characters) ? parsed.characters : [];
    const validSegmentIds = segments.map((segment) => segment.segmentId);

    const drafts = rows
      .map((row, index): ModelCharacterDraft | null => {
        if (!isRecord(row)) return null;
        const name = cleanText(row.name) || `Character ${index + 1}`;
        const key = slugify(cleanText(row.key) || name, `character_${index + 1}`);
        const segmentIds = coerceSegmentIds(row.segmentIds, validSegmentIds);

        return {
          key,
          name,
          role: cleanText(row.role) || "Recurring character",
          visualIdentityPrompt:
            cleanText(row.visualIdentityPrompt) ||
            "Consistent feminine-coded character identity with expressive face and continuity-safe silhouette.",
          styleNotes:
            cleanText(row.styleNotes) ||
            "Keep shape language, facial expression style, and color palette consistent in every segment.",
          segmentIds,
        };
      })
      .filter((row): row is ModelCharacterDraft => row !== null)
      .slice(0, 5);

    if (drafts.length > 0) {
      return drafts;
    }
  } catch {
    // fall back below
  }

  return buildFallbackCharacterDrafts(segments, campaignMode);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const videoId = asText(body.videoId);
    const imageModel: ImageGenerationModel = isImageGenerationModel(body.imageGenerationModel)
      ? body.imageGenerationModel
      : DEFAULT_IMAGE_GENERATION_MODEL;

    if (!collectionId || !videoId) {
      return NextResponse.json({ error: "collectionId and videoId are required." }, { status: 400 });
    }

    const latestPlanResult = await supabase
      .from("video_recreation_plans")
      .select("id, app_name, plan_payload, created_at")
      .eq("collection_id", collectionId)
      .eq("source_video_id", videoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestPlanResult.error || !latestPlanResult.data) {
      return NextResponse.json(
        { error: "No recreation plan found for this video. Generate a plan first." },
        { status: 404 }
      );
    }

    const planRow = latestPlanResult.data as unknown as PlanRow;
    const payload = isRecord(planRow.plan_payload) ? { ...planRow.plan_payload } : {};
    const plan = isRecord(payload.plan) ? ({ ...(payload.plan as Record<string, unknown>) } as PlanShape) : null;

    if (!plan) {
      return NextResponse.json({ error: "Saved plan payload is missing or invalid." }, { status: 500 });
    }

    const segments = Array.isArray(plan.motionControlSegments)
      ? plan.motionControlSegments.filter((segment) => typeof segment.segmentId === "number")
      : [];

    if (segments.length === 0) {
      return NextResponse.json(
        { error: "This plan has no motion-control segments to map characters." },
        { status: 400 }
      );
    }

    const appName = cleanText(planRow.app_name) || "Muslimah Pro";
    const campaignMode = cleanText(plan.campaignMode) || "standard";
    const selectedVideoType = cleanText(plan.selectedVideoType) || "hybrid";
    const reasoningModel = cleanText(payload.reasoningModel) || DEFAULT_REASONING_MODEL;
    const draftCharacters = await inferCharacterDrafts({
      appName,
      campaignMode,
      selectedVideoType,
      segments,
      reasoningModel,
    });

    const segmentIds = segments.map((segment) => segment.segmentId);
    const isAnimatedVisual = selectedVideoType === "ai_animation" || campaignMode === "ai_objects_educational_explainer";
    const existingCharacters = Array.isArray(plan.scriptCharacters?.characters)
      ? plan.scriptCharacters?.characters
      : [];
    const existingByKey = new Map(
      existingCharacters
        .map((character) => ({
          key: slugify(cleanText(character.key) || cleanText(character.id) || cleanText(character.name), ""),
          imageUrl: cleanText(character.imageUrl),
        }))
        .filter((entry) => entry.key && entry.imageUrl)
        .map((entry) => [entry.key, entry.imageUrl])
    );

    const warnings: string[] = [];
    const generatedCharacters: ScriptCharacterRecord[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < draftCharacters.length; index += 1) {
      const draft = draftCharacters[index];
      const fallbackSegmentIds = index === 0 ? segmentIds : [segmentIds[Math.min(index, segmentIds.length - 1)]];
      const assignedSegmentIds = draft.segmentIds.length > 0 ? draft.segmentIds : fallbackSegmentIds;

      const baseId = `script_char_${slugify(draft.key || draft.name, `character_${index + 1}`)}`;
      let resolvedId = baseId;
      let dedupe = 2;
      while (usedIds.has(resolvedId)) {
        resolvedId = `${baseId}_${dedupe}`;
        dedupe += 1;
      }
      usedIds.add(resolvedId);

      const previousReferenceUrl = existingByKey.get(slugify(draft.key, draft.key));
      const referenceImageUrls = previousReferenceUrl ? [previousReferenceUrl] : [];

      const generationPrompt = [
        `Create ONE character reference image for recurring character \"${draft.name}\".`,
        `Role: ${draft.role}.`,
        `Visual identity: ${draft.visualIdentityPrompt}.`,
        `Style notes: ${draft.styleNotes}.`,
        isAnimatedVisual
          ? "Render as premium stylized 3D CGI character design for animation workflows (not photoreal human skin rendering)."
          : "Render as realistic continuity-safe character image with natural texture and believable lighting.",
        "Keep presentation feminine-coded and women-audience-friendly: soft shape language, warm expression, graceful posture, tasteful styling.",
        "Single character only. Medium-close framing. Clean uncluttered background. No text, no logos, no watermark.",
      ].join(" ");

      try {
        const generatedImage = await generateImage(generationPrompt, {
          platform: "tiktok",
          uiGenerationMode: referenceImageUrls.length > 0 ? "reference_exact" : "ai_creative",
          referenceImageUrls,
          characterReferenceImageUrls: referenceImageUrls,
          characterLockDescriptor: `${draft.name}. ${draft.visualIdentityPrompt}`,
          visualVariant: isAnimatedVisual ? "brand_optimized" : "ugc_real",
          imageModel,
        });

        let imageUrl = generatedImage;
        if (generatedImage.startsWith("data:")) {
          const { buffer, mimeType } = dataUrlToBuffer(generatedImage);
          const key = `collections/${collectionId}/video-agent/script-characters/${videoId}/${Date.now()}-${resolvedId}-${randomUUID().slice(0, 8)}.png`;
          imageUrl = await uploadToR2(key, buffer, mimeType || "image/png");
        }

        generatedCharacters.push({
          id: resolvedId,
          key: draft.key,
          name: draft.name,
          role: draft.role,
          visualIdentityPrompt: draft.visualIdentityPrompt,
          styleNotes: draft.styleNotes,
          imageUrl,
          segmentIds: assignedSegmentIds,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown image generation error";
        warnings.push(`${draft.name}: ${message}`);
      }
    }

    if (generatedCharacters.length === 0) {
      return NextResponse.json(
        { error: "Failed to generate any script character references.", warnings },
        { status: 500 }
      );
    }

    const segmentCharacterMap = segments.map((segment) => {
      const linkedIds = generatedCharacters
        .filter((character) => character.segmentIds.includes(segment.segmentId))
        .map((character) => character.id);
      return {
        segmentId: segment.segmentId,
        characterIds: linkedIds.length > 0 ? linkedIds : [generatedCharacters[0].id],
      };
    });

    const updatedSegments = segments.map((segment) => {
      const mapItem = segmentCharacterMap.find((item) => item.segmentId === segment.segmentId);
      return {
        ...segment,
        characterReferenceIds: mapItem?.characterIds || [],
      };
    });

    const generatedAt = new Date().toISOString();
    const nextPlan: PlanShape = {
      ...plan,
      motionControlSegments: updatedSegments,
      scriptCharacters: {
        generatedAt,
        imageModel,
        characters: generatedCharacters,
        segmentCharacterMap,
      },
    };

    const nextPayload = {
      ...payload,
      plan: nextPlan,
      scriptCharactersGeneratedAt: generatedAt,
    };

    const updateResult = await supabase
      .from("video_recreation_plans")
      .update({ plan_payload: nextPayload })
      .eq("id", planRow.id)
      .select("id")
      .single();

    if (updateResult.error) {
      throw updateResult.error;
    }

    return NextResponse.json({
      planId: planRow.id,
      generatedCount: generatedCharacters.length,
      warnings,
      scriptCharacters: nextPlan.scriptCharacters,
      plan: nextPlan,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate script characters." },
      { status: 500 }
    );
  }
}
