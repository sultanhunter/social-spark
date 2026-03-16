import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateImage } from "@/lib/gemini-image";
import { uploadToR2 } from "@/lib/r2";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isImageGenerationModel,
  type ImageGenerationModel,
} from "@/lib/image-generation-model";
import fs from "fs";
import { promisify } from "util";
import { extractVideoFrame, parseStartTimeSeconds, cleanupTempFile } from "@/lib/video-extractor";

const readFile = promisify(fs.readFile);

export const runtime = "nodejs";

type PlanRow = {
  id: string;
  collection_id: string;
  format_id: string;
  source_video_id: string;
  app_name: string;
  plan_payload: Record<string, unknown> | null;
  created_at: string;
};

type VideoRow = {
  id: string;
  format_id: string;
  platform: string;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  source_url: string | null;
};

type FormatRow = {
  id: string;
  format_type: string;
};

type CharacterRow = {
  id: string;
  character_name: string;
  prompt_template: string;
  reference_image_url: string | null;
};

type PlanShape = {
  title?: string;
  strategy?: string;
  objective?: string;
  script?: {
    hook?: string;
    beats?: Array<{
      visual?: string;
      narration?: string;
      onScreenText?: string;
      editNote?: string;
    }>;
    cta?: string;
  };
  higgsfieldPrompts?: Array<{
    shotId?: string;
    scene?: string;
    prompt?: string;
  }>;
  motionControlSegments?: Array<{
    segmentId: number;
    timecode: string;
    durationSeconds: number;
    startFramePrompt: string;
    startFrame?: {
      imageUrl?: string;
      prompt?: string;
      generatedAt?: string;
      characterId?: string | null;
      imageModel?: string;
    };
  }>;
  startFrame?: {
    imageUrl?: string;
    prompt?: string;
    generatedAt?: string;
    characterId?: string | null;
    imageModel?: string;
  };
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

function dataUrlToBuffer(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Generated start frame is not a valid image data URL.");
  }

  const mimeType = match[1] || "image/png";
  const base64 = match[2] || "";
  return {
    mimeType,
    buffer: Buffer.from(base64, "base64"),
  };
}

function normalizeShotPromptForStartFrame(value: unknown): string {
  let output = cleanText(value);
  if (!output) return "";

  // Remove prompt metadata/syntax that can conflict with frame generation
  output = output
    .replace(/\bno dialogue\b\.?/gi, " ")
    .replace(/character\s*lock\s*:[^.;\n]+/gi, " ")
    .replace(/(^|\s)@[a-z0-9_-]+(?=\s|$)/gi, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^\}]*\}/g, " ")
    .replace(/<[^>]*>/g, " ");

  // Start frame should represent first instant, not later action in a sequence.
  const beforeThen = output.split(/\bthen\b/i)[0] || output;
  return cleanText(beforeThen);
}

function buildStartFramePrompt(args: {
  appName: string;
  formatType: string;
  video: VideoRow;
  plan: PlanShape;
  character: CharacterRow | null;
  segmentIndex?: number;
}): string {
  const { appName, formatType, video, plan, character, segmentIndex } = args;

  if (typeof segmentIndex === "number" && plan.motionControlSegments && plan.motionControlSegments[segmentIndex]) {
    const segment = plan.motionControlSegments[segmentIndex];
    const characterInstruction = character
      ? `Use the selected recurring character identity (${character.character_name}). Keep face identity and styling consistent.`
      : "No fixed character lock required unless script clearly needs a person.";

    return [
      `Generate ONE photorealistic opening start frame for segment ${segment.segmentId} (timecode: ${segment.timecode}) of this video.`,
      `This frame will be used as the starting image for Kling Motion Control 3.0.`,
      `Segment Start Visual Intent: ${cleanText(segment.startFramePrompt) || "N/A"}.`,
      characterInstruction,
      `Vertical 9:16 composition at 1080x1920 output framing.`,
      `Photorealistic ultra-detailed 4K-quality look (high texture fidelity, clean dynamic range, realistic skin and fabric detail).`,
      `If a person appears, enforce modest, non-sexual framing: neutral posture, respectful body language, and modest wardrobe.`,
      `No suggestive posing, no cleavage, no lingerie/swimwear styling, no glamourized sensual focus.`,
      `No text overlays, no subtitles, no logos, no watermark.`,
      `High realism and coherent scene setup suitable for AI video generation start frame input.`,
    ].join(" ");
  }

  const hook = cleanText(plan.script?.hook);
  const firstBeat = Array.isArray(plan.script?.beats) ? plan.script?.beats?.[0] : null;
  const firstBeatVisual = cleanText(firstBeat?.visual);
  const firstBeatNarration = cleanText(firstBeat?.narration);
  const firstScene = Array.isArray(plan.higgsfieldPrompts)
    ? plan.higgsfieldPrompts.find((item) => cleanText(item?.shotId).toLowerCase() === "shot1") ||
    plan.higgsfieldPrompts?.[0]
    : null;
  const firstScenePrompt = normalizeShotPromptForStartFrame(firstScene?.prompt);

  const characterInstruction = character
    ? `Use the selected recurring character identity (${character.character_name}). Keep face identity and styling consistent.`
    : "No fixed character lock required unless script clearly needs a person.";

  return [
    `Generate ONE photorealistic opening start frame for a short-form vertical video concept.`,
    `This is frame zero (first moment before motion) and must match the script tone exactly.`,
    `Use Shot 1 as the highest-priority visual authority. Hook/beat context is secondary support only.`,
    `App context: ${appName}.`,
    `Format type: ${formatType}.`,
    `Source video title/context: ${video.title || video.description || "N/A"}.`,
    `Script hook: ${hook || "N/A"}.`,
    `First beat visual intent: ${firstBeatVisual || "N/A"}.`,
    `First beat narration intent: ${firstBeatNarration || "N/A"}.`,
    `Shot 1 cue (start-state only): ${firstScenePrompt || "N/A"}.`,
    `Render the first instant before any major action begins. If script later includes jump/dive/run/fall, do NOT depict that later action in this frame.`,
    characterInstruction,
    `Vertical 9:16 composition at 1080x1920 output framing.`,
    `Photorealistic ultra-detailed 4K-quality look (high texture fidelity, clean dynamic range, realistic skin and fabric detail), while keeping output composition suitable for 1080x1920 video start frame usage.`,
    `If a person appears, enforce modest, non-sexual framing: neutral posture, respectful body language, and modest wardrobe with no tight/transparent clothing.`,
    `Avoid camera angles or poses that emphasize chest, hips, or body contours. Prefer chest-up or waist-up framing unless script requires wider context.`,
    `No suggestive posing, no cleavage, no lingerie/swimwear styling, no glamourized sensual focus.`,
    `No text overlays, no subtitles, no logos, no watermark.`,
    `High realism and coherent scene setup suitable for AI video generation start frame input.`,
  ].join(" ");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const videoId = asText(body.videoId);
    const explicitFormatId = asText(body.formatId);
    const explicitCharacterId = asText(body.characterId);
    const segmentIndex = typeof body.segmentIndex === "number" ? body.segmentIndex : undefined;
    const imageGenerationModel: ImageGenerationModel = isImageGenerationModel(body.imageGenerationModel)
      ? body.imageGenerationModel
      : DEFAULT_IMAGE_GENERATION_MODEL;

    if (!collectionId || !videoId) {
      return NextResponse.json({ error: "collectionId and videoId are required." }, { status: 400 });
    }

    const [videoResult, latestPlanResult] = await Promise.all([
      supabase
        .from("video_format_videos")
        .select("id, format_id, platform, title, description, thumbnail_url, source_url")
        .eq("id", videoId)
        .eq("collection_id", collectionId)
        .single(),
      supabase
        .from("video_recreation_plans")
        .select("id, collection_id, format_id, source_video_id, app_name, plan_payload, created_at")
        .eq("collection_id", collectionId)
        .eq("source_video_id", videoId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (videoResult.error || !videoResult.data) {
      return NextResponse.json({ error: "Video source not found." }, { status: 404 });
    }

    if (latestPlanResult.error || !latestPlanResult.data) {
      return NextResponse.json(
        { error: "No recreation plan found for this video. Generate a plan first." },
        { status: 404 }
      );
    }

    const video = videoResult.data as unknown as VideoRow;
    const planRow = latestPlanResult.data as unknown as PlanRow;

    const payload = isRecord(planRow.plan_payload) ? { ...planRow.plan_payload } : {};
    const plan = isRecord(payload.plan) ? ({ ...(payload.plan as Record<string, unknown>) } as PlanShape) : null;

    if (!plan) {
      return NextResponse.json(
        { error: "Saved recreation plan payload is missing or invalid." },
        { status: 500 }
      );
    }

    const formatId = explicitFormatId || video.format_id;
    const formatResult = await supabase
      .from("video_formats")
      .select("id, format_type")
      .eq("id", formatId)
      .eq("collection_id", collectionId)
      .maybeSingle();

    const format = (formatResult.data || { id: formatId, format_type: "hybrid" }) as FormatRow;

    const payloadCharacterId = asText(payload.ugcCharacterId);
    const characterId = explicitCharacterId || payloadCharacterId;

    let character: CharacterRow | null = null;
    if (characterId) {
      const characterResult = await supabase
        .from("video_ugc_characters")
        .select("id, character_name, prompt_template, reference_image_url")
        .eq("collection_id", collectionId)
        .eq("id", characterId)
        .maybeSingle();

      if (characterResult.data) {
        character = characterResult.data as unknown as CharacterRow;
      }
    }

    const prompt = buildStartFramePrompt({
      appName: asText(planRow.app_name) || "Muslimah Pro",
      formatType: asText(format.format_type) || "hybrid",
      video,
      plan,
      character,
      segmentIndex,
    });

    let extractedFrameDataUrl: string | null = null;
    let extractedFramePath: string | null = null;

    // We try to extract the exact frame from the source video using FFmpeg.
    // If it fails, we fall back to the generic video.thumbnail_url
    if (video.source_url) {
      try {
        let timecodeSeconds = 0;
        if (typeof segmentIndex === "number" && plan.motionControlSegments && plan.motionControlSegments[segmentIndex]) {
          timecodeSeconds = parseStartTimeSeconds(plan.motionControlSegments[segmentIndex].timecode);
        }

        extractedFramePath = await extractVideoFrame(video.source_url, timecodeSeconds);
        const imageBuffer = await readFile(extractedFramePath);
        extractedFrameDataUrl = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;
      } catch (err) {
        console.warn(`[start-frame] Failed to extract exact video frame, falling back to thumbnail. Error:`, err);
      }
    }

    const referenceImageUrls: string[] = [];
    if (extractedFrameDataUrl) {
      referenceImageUrls.push(extractedFrameDataUrl);
    } else if (video.thumbnail_url) {
      referenceImageUrls.push(video.thumbnail_url);
    }

    const generatedDataUrl = await generateImage(prompt, {
      platform: "tiktok",
      uiGenerationMode: "ai_creative",
      visualVariant: format.format_type === "ugc" ? "ugc_real" : "brand_optimized",
      referenceImageUrls,
      characterReferenceImageUrls:
        character?.reference_image_url && character.reference_image_url.trim().length > 0
          ? [character.reference_image_url]
          : [],
      characterLockDescriptor:
        character && character.prompt_template
          ? `${character.character_name}. ${character.prompt_template}`
          : undefined,
      imageModel: imageGenerationModel,
    });

    const { buffer, mimeType } = dataUrlToBuffer(generatedDataUrl);
    const generatedAt = new Date().toISOString();
    const key = `collections/${collectionId}/video-agent/start-frames/${videoId}/${generatedAt.replace(/[:.]/g, "-")}-${randomUUID()}.png`;
    const imageUrl = await uploadToR2(key, buffer, mimeType || "image/png");

    if (extractedFramePath) {
      void cleanupTempFile(extractedFramePath);
    }

    const nextStartFrame = {
      imageUrl,
      prompt,
      generatedAt,
      characterId: character?.id || characterId || null,
      imageModel: imageGenerationModel,
    };

    let nextPlan: PlanShape;
    if (typeof segmentIndex === "number" && plan.motionControlSegments && plan.motionControlSegments[segmentIndex]) {
      const updatedSegments = [...plan.motionControlSegments];
      updatedSegments[segmentIndex] = {
        ...updatedSegments[segmentIndex],
        startFrame: nextStartFrame,
      };
      nextPlan = {
        ...plan,
        motionControlSegments: updatedSegments,
      };
    } else {
      nextPlan = {
        ...plan,
        startFrame: nextStartFrame,
      };
    }

    const nextPayload = {
      ...payload,
      plan: nextPlan,
      ugcCharacterId: character?.id || payloadCharacterId || null,
      startFrameGeneratedAt: generatedAt,
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
      startFrame: nextStartFrame,
      plan: nextPlan,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate start frame." },
      { status: 500 }
    );
  }
}
