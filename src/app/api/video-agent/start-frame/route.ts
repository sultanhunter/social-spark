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

function parseStartTimeSeconds(timecode?: string): number {
  if (!timecode) return 0;

  const startPart = timecode.split("-")[0]?.trim();
  if (!startPart) return 0;

  const parts = startPart.split(":").map(Number);

  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return 0;
}

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
  campaignMode?: string;
  klingMotionControlOnly?: boolean;
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
    characterReferenceIds?: string[];
    veoPrompt?: string;
    script?: {
      hook?: string;
      shots?: Array<{
        shotId?: string;
        visual?: string;
        narration?: string;
        onScreenText?: string;
        editNote?: string;
      }>;
      cta?: string;
    };
    multiShotPrompts?: Array<{
      shotId?: string;
      generationType?: string;
      scene?: string;
      prompt?: string;
      shotDuration?: string;
    }>;
    startFrame?: {
      imageUrl?: string;
      prompt?: string;
      generatedAt?: string;
      characterId?: string | null;
      imageModel?: string;
    };
  }>;
  scriptCharacters?: {
    generatedAt?: string;
    imageModel?: string;
    characters?: Array<{
      id?: string;
      name?: string;
      imageUrl?: string;
      segmentIds?: number[];
    }>;
    segmentCharacterMap?: Array<{
      segmentId?: number;
      characterIds?: string[];
    }>;
  };
  startFrame?: {
    imageUrl?: string;
    prompt?: string;
    generatedAt?: string;
    characterId?: string | null;
    imageModel?: string;
  };
};

function getPreviousSegmentStartFrameUrl(plan: PlanShape, segmentIndex?: number): string | null {
  if (typeof segmentIndex !== "number" || segmentIndex <= 0) return null;
  if (!Array.isArray(plan.motionControlSegments)) return null;

  const previousSegmentFrameUrl = cleanText(plan.motionControlSegments[segmentIndex - 1]?.startFrame?.imageUrl);
  if (previousSegmentFrameUrl) return previousSegmentFrameUrl;

  const sharedPlanFrameUrl = cleanText(plan.startFrame?.imageUrl);
  return sharedPlanFrameUrl || null;
}

function getSegmentScriptCharacterReferences(
  plan: PlanShape,
  segmentIndex?: number
): { urls: string[]; names: string[] } {
  if (typeof segmentIndex !== "number") {
    return { urls: [], names: [] };
  }
  if (!Array.isArray(plan.motionControlSegments) || !plan.motionControlSegments[segmentIndex]) {
    return { urls: [], names: [] };
  }

  const segment = plan.motionControlSegments[segmentIndex];
  const segmentId = typeof segment.segmentId === "number" ? segment.segmentId : segmentIndex + 1;
  const scriptCharacters = plan.scriptCharacters;
  const characters = Array.isArray(scriptCharacters?.characters) ? scriptCharacters?.characters : [];

  const idsFromSegment = Array.isArray(segment.characterReferenceIds)
    ? segment.characterReferenceIds.map((id) => cleanText(id)).filter(Boolean)
    : [];
  const idsFromMap = Array.isArray(scriptCharacters?.segmentCharacterMap)
    ? scriptCharacters.segmentCharacterMap
      .find((item) => Number(item?.segmentId) === segmentId)
      ?.characterIds
      ?.map((id) => cleanText(id))
      .filter(Boolean) || []
    : [];
  const idsFromCharacterSegments = characters
    .filter((character) =>
      Array.isArray(character.segmentIds)
        ? character.segmentIds.some((id) => Number(id) === segmentId)
        : false
    )
    .map((character) => cleanText(character.id))
    .filter(Boolean);

  const resolvedIds = Array.from(new Set([...idsFromSegment, ...idsFromMap, ...idsFromCharacterSegments]));

  const refs = resolvedIds
    .map((id) => characters.find((character) => cleanText(character.id) === id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const urls = refs
    .map((ref) => cleanText(ref.imageUrl))
    .filter(Boolean)
    .slice(0, 4);
  const names = refs
    .map((ref) => cleanText(ref.name) || cleanText(ref.id) || "Character")
    .filter(Boolean)
    .slice(0, 6);

  return { urls, names };
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanText(value: unknown): string {
  return asText(value).replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const WARDROBE_COLORWAYS = [
  "deep teal hijab, warm sand abaya, soft ivory inner layer",
  "dusty rose hijab, mocha brown abaya, cream inner layer",
  "forest olive hijab, stone beige abaya, muted oatmeal inner layer",
  "slate blue hijab, camel tan abaya, off-white inner layer",
  "plum mauve hijab, cocoa taupe abaya, light almond inner layer",
  "terracotta hijab, charcoal abaya, warm beige inner layer",
  "sage green hijab, walnut brown abaya, ivory inner layer",
  "midnight navy hijab, mushroom taupe abaya, soft cream inner layer",
];

function hashToIndex(seed: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return size > 0 ? hash % size : 0;
}

function pickWardrobeColorway(seed: string): string {
  return WARDROBE_COLORWAYS[hashToIndex(seed, WARDROBE_COLORWAYS.length)] || WARDROBE_COLORWAYS[0];
}

function stripColorTerms(value: string): string {
  const cleaned = cleanText(value);
  if (!cleaned) return "";

  return cleanText(
    cleaned
      .replace(
        /\b(black|white|red|blue|green|yellow|orange|purple|pink|brown|beige|tan|gray|grey|maroon|navy|teal|olive|gold|silver|cream|burgundy|lavender|peach|mustard|rust|charcoal|turquoise|indigo|khaki|stone|camel|sage|plum|mauve|terracotta|mocha|oatmeal|ivory|almond|midnight)\b/gi,
        " "
      )
      .replace(/\b(light|dark|pastel|muted|vibrant|bright|colorful|monochrome)\b/gi, " ")
      .replace(/\s{2,}/g, " ")
  );
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

function hasWorshipGestureCue(...values: unknown[]): boolean {
  const combined = values.map((value) => cleanText(value)).join(" ").toLowerCase();
  if (!combined) return false;
  return /\b(dua|du'a|supplication|prayer|salah|salat|dhikr|adhkar|gratitude|shukr)\b/i.test(combined);
}

function hasQuranCue(...values: unknown[]): boolean {
  const combined = values.map((value) => cleanText(value)).join(" ").toLowerCase();
  if (!combined) return false;
  return /\b(quran|qur'an|mushaf|surah|ayah|verse|tafsir|tilawah|recitation)\b/i.test(combined);
}

function worshipGestureInstruction(shouldEnforce: boolean): string {
  if (!shouldEnforce) return "";
  return "If a worship/gratitude gesture appears, use authentic Muslim dua posture: both hands open with palms facing upward near chest level; do not use clasped-hands or namaste-style gesture.";
}

function quranClosedInstruction(shouldEnforce: boolean): string {
  if (!shouldEnforce) return "";
  return "Hard rule: if the Quran/mushaf appears in frame, it must be CLOSED with cover visible; do not show open pages, open spread, or readable Arabic text pages.";
}

function quranNightLightingInstruction(shouldEnforce: boolean): string {
  if (!shouldEnforce) return "";
  return "For Quran reflection scenes in 3D animation, use indoor night-time room lighting: warm desk-lamp key light, soft low-key falloff, soothing ambience, and focused face illumination. Avoid bright daylight, overexposed white fill, or mixed day-and-night lighting.";
}

function hasAnimatedCue(...values: unknown[]): boolean {
  const combined = values.map((value) => cleanText(value)).join(" ").toLowerCase();
  if (!combined) return false;
  return /\b(3d|animated|animation|cgi|stylized)\b/i.test(combined);
}

function isAnimatedFormat(formatType: string): boolean {
  const cleaned = cleanText(formatType).toLowerCase();
  return cleaned === "ai_video" || /\b(animated|animation|cgi|3d)\b/i.test(cleaned);
}

type SceneTimeOfDay = "morning" | "midday" | "afternoon" | "evening" | "night" | "neutral";

function detectSceneTimeOfDay(...values: unknown[]): SceneTimeOfDay {
  const combined = values.map((value) => cleanText(value)).join(" ").toLowerCase();
  if (!combined) return "neutral";

  if (/\b(isha|night|nighttime|late\s*night|moonlight|starlight|study\s*lamp|desk\s*lamp)\b/i.test(combined)) {
    return "night";
  }
  if (/\b(maghrib|sunset|evening|golden\s*hour|dusk)\b/i.test(combined)) {
    return "evening";
  }
  if (/\b(afternoon|asr|after\s*lunch|nap)\b/i.test(combined)) {
    return "afternoon";
  }
  if (/\b(dhuhr|noon|midday|mid\s*day)\b/i.test(combined)) {
    return "midday";
  }
  if (/\b(fajr|dawn|sunrise|morning|breakfast|early\s*day)\b/i.test(combined)) {
    return "morning";
  }

  return "neutral";
}

function animatedLightingInstruction(args: { shouldEnforce: boolean; timeOfDay: SceneTimeOfDay }): string {
  const { shouldEnforce, timeOfDay } = args;
  if (!shouldEnforce) return "";

  const baseLock =
    "Lighting lock for 3D animation: keep lighting stable and coherent for this shot with fixed key/fill ratio, fixed color temperature, soft diffuse shadows, and no flicker, no color shifts, no exposure pumping, and no dramatic dynamic-lighting swings.";

  const timeRule = (() => {
    switch (timeOfDay) {
      case "morning":
        return "Time-of-day lighting: morning only - soft warm morning daylight, gentle window-side key light, light pastel ambience, mild shadow contrast.";
      case "midday":
        return "Time-of-day lighting: midday only - bright neutral daylight, balanced white tone, clean fill, clear but soft shadow edges.";
      case "afternoon":
        return "Time-of-day lighting: afternoon only - warm natural daylight with slightly lower sun angle, calm golden-neutral ambience, moderate soft shadows.";
      case "evening":
        return "Time-of-day lighting: evening only - warm sunset/early-evening tones or warm indoor practicals, lower overall brightness, soft amber ambience.";
      case "night":
        return "Time-of-day lighting: night only - low-key warm indoor practical lighting (lamp-like), no bright white daytime fill, controlled soft contrast.";
      default:
        return "Time-of-day lighting: infer from script context and keep one coherent lighting setup without mixing day and night traits.";
    }
  })();

  return `${baseLock} ${timeRule}`;
}

function isUgcShockingFactReactionMode(plan: PlanShape): boolean {
  const mode = cleanText(plan.campaignMode).toLowerCase();
  return mode === "ugc_shocking_fact_reaction" || mode === "ugc-shocking-fact-reaction";
}

function isUgcFruitCuttingFactExplainerMode(plan: PlanShape): boolean {
  const mode = cleanText(plan.campaignMode).toLowerCase();
  return mode === "ugc_fruit_cutting_fact_explainer" || mode === "ugc-fruit-cutting-fact-explainer";
}

function buildStartFramePrompt(args: {
  appName: string;
  formatType: string;
  video: VideoRow;
  plan: PlanShape;
  character: CharacterRow | null;
  characterLockDescriptorBase?: string;
  wardrobeColorwayLock?: string;
  segmentIndex?: number;
  previousSegmentStartFrameUrl?: string | null;
  segmentCharacterNames?: string[];
}): string {
  const {
    appName,
    formatType,
    video,
    plan,
    character,
    characterLockDescriptorBase,
    wardrobeColorwayLock,
    segmentIndex,
    previousSegmentStartFrameUrl,
    segmentCharacterNames,
  } = args;
  const wardrobeVariationInstruction = wardrobeColorwayLock
    ? `Wardrobe style rule for this full script: keep the SAME hijab type and SAME outfit silhouette as the selected character reference, but use this recolored palette: ${wardrobeColorwayLock}. Do not reuse the original clothing colors from source/reference images.`
    : "";
  const wardrobeSegmentContinuityInstruction =
    wardrobeColorwayLock && typeof segmentIndex === "number" && segmentIndex > 0
      ? "Across segments, keep exactly the same hijab style, outfit structure, and colorway as earlier generated segments."
      : "";
  const positiveShockExpressionInstruction = isUgcShockingFactReactionMode(plan)
    ? "Expression lock for this campaign: surprised in a cool-discovery way (intrigued + lightly excited + relatable), not fearful. Keep eyes natural size and realistic; avoid bulging eyes, panic face, anxious brows, or distressed worry expression."
    : "";
  const fruitCuttingOpeningInstruction =
    isUgcFruitCuttingFactExplainerMode(plan) && (typeof segmentIndex !== "number" || segmentIndex === 0)
      ? "Opening action lock for this campaign: creator is seated at a table and gently cutting fresh fruit on a cutting board while talking to camera. Keep this everyday-natural and safe (calm knife handling, no dramatic motion)."
      : "";
  const globalWorshipPoseInstruction = worshipGestureInstruction(
    hasWorshipGestureCue(
      video.title,
      video.description,
      plan.title,
      plan.objective,
      plan.script?.hook,
      plan.script?.cta
    )
  );
  const globalQuranClosedInstruction = quranClosedInstruction(
    hasQuranCue(
      video.title,
      video.description,
      plan.title,
      plan.objective,
      plan.script?.hook,
      plan.script?.cta
    )
  );
  const isAnimatedContext =
    isAnimatedFormat(formatType) ||
    hasAnimatedCue(
      plan.title,
      plan.objective,
      plan.script?.hook,
      plan.script?.cta,
      character?.prompt_template
    );
  const globalTimeOfDay = detectSceneTimeOfDay(
    video.title,
    video.description,
    plan.title,
    plan.objective,
    plan.script?.hook,
    plan.script?.cta
  );
  const globalAnimatedLightingInstruction = animatedLightingInstruction({
    shouldEnforce: isAnimatedContext,
    timeOfDay: globalTimeOfDay,
  });
  const globalQuranNightLightingInstruction = quranNightLightingInstruction(
    isAnimatedContext &&
    hasQuranCue(
      video.title,
      video.description,
      plan.title,
      plan.objective,
      plan.script?.hook,
      plan.script?.cta
    )
  );

  if (plan.klingMotionControlOnly) {
    const characterInstruction = character
      ? `Use the selected recurring character identity (${character.character_name}) while preserving source frame-zero composition and environment. Character descriptor: ${cleanText(characterLockDescriptorBase) || "Keep same face identity and modest wardrobe family."}`
      : "No fixed character lock required unless script clearly needs a person.";

    return [
      "Generate ONE photorealistic frame-zero image optimized for Kling motion control.",
      "Primary objective: match the source video's opening frame composition and environment as closely as possible.",
      "Hard lock: preserve camera angle, framing, lens feel, subject distance, background geometry, and light direction from the reference frame.",
      "If a character appears, keep identity consistent with selected character lock while retaining source pose and composition.",
      `App context: ${appName}.`,
      `Format type: ${formatType}.`,
      `Source video title/context: ${video.title || video.description || "N/A"}.`,
      characterInstruction,
      wardrobeVariationInstruction,
      positiveShockExpressionInstruction,
      fruitCuttingOpeningInstruction,
      "If a woman appears, wardrobe must include long sleeves with both arms fully covered to the wrists.",
      globalWorshipPoseInstruction,
      globalQuranClosedInstruction,
      globalQuranNightLightingInstruction,
      globalAnimatedLightingInstruction,
      "Vertical 9:16 composition at 1080x1920 output framing.",
      "Photorealistic ultra-detailed 4K-quality look (true skin texture, realistic fabric, plausible natural lighting, no uncanny artifacts).",
      "No text overlays, no subtitles, no logos, no watermark.",
    ].join(" ");
  }

  if (typeof segmentIndex === "number" && plan.motionControlSegments && plan.motionControlSegments[segmentIndex]) {
    const segment = plan.motionControlSegments[segmentIndex];
    const segmentHook = cleanText(segment.script?.hook);
    const legacySegmentBeats = isRecord(segment.script) && Array.isArray((segment.script as Record<string, unknown>).beats)
      ? ((segment.script as Record<string, unknown>).beats as Array<Record<string, unknown>>)
      : [];
    const firstSegmentShot = Array.isArray(segment.script?.shots)
      ? segment.script?.shots?.[0]
      : legacySegmentBeats[0] || null;
    const segmentVisualCue = cleanText(firstSegmentShot?.visual || firstSegmentShot?.onScreenText || firstSegmentShot?.narration);
    const segmentCta = cleanText(segment.script?.cta);
    const firstSegmentPrompt = Array.isArray(segment.multiShotPrompts) ? cleanText(segment.multiShotPrompts?.[0]?.prompt) : "";
    const veoPromptCue = cleanText(segment.veoPrompt || "");
    const worshipPoseInstruction = worshipGestureInstruction(
      hasWorshipGestureCue(
        segment.startFramePrompt,
        segmentHook,
        segmentVisualCue,
        segmentCta,
        firstSegmentPrompt,
        veoPromptCue
      )
    );
    const segmentQuranClosedInstruction = quranClosedInstruction(
      hasQuranCue(
        segment.startFramePrompt,
        segmentHook,
        segmentVisualCue,
        segmentCta,
        firstSegmentPrompt,
        veoPromptCue
      )
    );
    const segmentQuranNightLightingInstruction = quranNightLightingInstruction(
      (isAnimatedContext ||
        hasAnimatedCue(
          segment.startFramePrompt,
          segmentHook,
          segmentVisualCue,
          segmentCta,
          firstSegmentPrompt,
          veoPromptCue,
          character?.prompt_template
        )) &&
      hasQuranCue(
        segment.startFramePrompt,
        segmentHook,
        segmentVisualCue,
        segmentCta,
        firstSegmentPrompt,
        veoPromptCue
      )
    );
    const segmentAnimatedLightingInstruction = animatedLightingInstruction(
      {
        shouldEnforce:
          isAnimatedContext ||
          hasAnimatedCue(
            segment.startFramePrompt,
            segmentHook,
            segmentVisualCue,
            segmentCta,
            firstSegmentPrompt,
            veoPromptCue,
            character?.prompt_template
          ),
        timeOfDay: detectSceneTimeOfDay(
          segment.startFramePrompt,
          segmentHook,
          segmentVisualCue,
          segmentCta,
          firstSegmentPrompt,
          veoPromptCue
        ),
      }
    );
    const continuityInstruction =
      typeof segmentIndex === "number" && segmentIndex > 0
        ? "Continuity requirement: this segment must look like an immediate continuation of earlier generated segments. Keep the same main character identity unless script explicitly introduces a new person."
        : "";
    const environmentContinuityInstruction =
      typeof segmentIndex === "number" && segmentIndex > 0
        ? "Keep environment continuity as default: same location family, lighting mood, camera language, color tone, and prop layout unless script clearly calls for a scene change."
        : "";
    const hardEnvironmentLockInstruction =
      typeof segmentIndex === "number" && segmentIndex > 0
        ? "Environment lock (hard rule): match the attached previous segment frame background, room/location, camera angle, lens feel, framing height, and light direction as closely as possible."
        : "";
    const conflictResolutionInstruction =
      typeof segmentIndex === "number" && segmentIndex > 0
        ? "If Segment Start Visual Intent conflicts with the attached previous segment frame, continuity frame wins. Apply only minimal forward progression within the same environment."
        : "";
    const strictIdentityRule =
      typeof segmentIndex === "number" && segmentIndex > 0
        ? "Do not change face identity, skin tone, age range, hair style, body proportions, or core wardrobe silhouette across segments."
        : "";
    const previousFrameInstruction =
      previousSegmentStartFrameUrl
        ? "A previous segment continuity reference image is attached. Treat it as the strongest visual continuity anchor."
        : "";
    const continuityReferenceInstruction = previousSegmentStartFrameUrl
      ? "Exactly one continuity reference image is attached from segment N-1. Match that environment and character identity first, then apply only minimal progression into this segment."
      : "";
    const scriptCharacterReferenceInstruction =
      Array.isArray(segmentCharacterNames) && segmentCharacterNames.length > 0
        ? `Segment cast references: ${segmentCharacterNames.join(", ")}. Use attached segment-specific character reference image(s) as identity anchors for whoever appears in frame zero.`
        : "";
    const characterInstruction = character
      ? `Use the selected recurring character identity (${character.character_name}). Character lock descriptor: ${cleanText(characterLockDescriptorBase) || "Keep same face, styling, and wardrobe family in every segment."}`
      : "No fixed character lock required unless script clearly needs a person.";

    return [
      `Generate ONE photorealistic opening start frame for segment ${segment.segmentId} (timecode: ${segment.timecode}) of this video.`,
      `This frame will be used as the starting image for this segment's video generation group.`,
      `Segment Start Visual Intent: ${cleanText(segment.startFramePrompt) || "N/A"}.`,
      `Segment hook context: ${segmentHook || "N/A"}.`,
      `Segment first beat visual context: ${segmentVisualCue || "N/A"}.`,
      `Segment CTA context: ${segmentCta || "N/A"}.`,
      `Segment first multi-shot prompt cue: ${firstSegmentPrompt || "N/A"}.`,
      `Veo prompt reference (full, highest-priority semantic anchor): ${veoPromptCue || "N/A"}.`,
      "Use the full Veo prompt as the primary semantic anchor; then apply continuity locks and frame-zero still-image rules.",
      "Interpret Veo as first instant only: no motion blur, no action progression, and no text rendering.",
      continuityInstruction,
      environmentContinuityInstruction,
      hardEnvironmentLockInstruction,
      strictIdentityRule,
      previousFrameInstruction,
      continuityReferenceInstruction,
      scriptCharacterReferenceInstruction,
      conflictResolutionInstruction,
      characterInstruction,
      wardrobeVariationInstruction,
      wardrobeSegmentContinuityInstruction,
      positiveShockExpressionInstruction,
      fruitCuttingOpeningInstruction,
      `Vertical 9:16 composition at 1080x1920 output framing.`,
      `Photorealistic ultra-detailed 4K-quality look (high texture fidelity, clean dynamic range, realistic skin and fabric detail).`,
      `If a person appears, enforce modest, non-sexual framing: neutral posture, respectful body language, and modest wardrobe.`,
      `If a woman appears, enforce long sleeves with both arms fully covered to the wrists in every frame.`,
      worshipPoseInstruction,
      segmentQuranClosedInstruction,
      segmentQuranNightLightingInstruction,
      segmentAnimatedLightingInstruction,
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
  const worshipPoseInstruction = worshipGestureInstruction(
    hasWorshipGestureCue(hook, firstBeatVisual, firstBeatNarration, firstScenePrompt)
  );
  const quranClosedPoseInstruction = quranClosedInstruction(
    hasQuranCue(hook, firstBeatVisual, firstBeatNarration, firstScenePrompt)
  );
  const quranNightLightingPoseInstruction = quranNightLightingInstruction(
    (isAnimatedContext || hasAnimatedCue(hook, firstBeatVisual, firstBeatNarration, firstScenePrompt, character?.prompt_template)) &&
    hasQuranCue(hook, firstBeatVisual, firstBeatNarration, firstScenePrompt)
  );
  const animatedLightingPoseInstruction = animatedLightingInstruction(
    {
      shouldEnforce:
        isAnimatedContext ||
        hasAnimatedCue(hook, firstBeatVisual, firstBeatNarration, firstScenePrompt, character?.prompt_template),
      timeOfDay: detectSceneTimeOfDay(hook, firstBeatVisual, firstBeatNarration, firstScenePrompt),
    }
  );

  const characterInstruction = character
    ? `Use the selected recurring character identity (${character.character_name}). Character descriptor: ${cleanText(characterLockDescriptorBase) || "Keep face identity and styling consistent."}`
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
    wardrobeVariationInstruction,
    positiveShockExpressionInstruction,
    fruitCuttingOpeningInstruction,
    `Vertical 9:16 composition at 1080x1920 output framing.`,
    `Photorealistic ultra-detailed 4K-quality look (high texture fidelity, clean dynamic range, realistic skin and fabric detail), while keeping output composition suitable for 1080x1920 video start frame usage.`,
    `If a person appears, enforce modest, non-sexual framing: neutral posture, respectful body language, and modest wardrobe with no tight/transparent clothing.`,
    `If a woman appears, enforce long sleeves with both arms fully covered to the wrists in every frame.`,
    worshipPoseInstruction,
    quranClosedPoseInstruction,
    quranNightLightingPoseInstruction,
    animatedLightingPoseInstruction,
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

    const characterLockDescriptorBase = character
      ? cleanText(stripColorTerms(character.prompt_template)) || cleanText(character.prompt_template)
      : "";
    const wardrobeColorwayLock = character
      ? pickWardrobeColorway(`${planRow.id}:${videoId}:${character.id}`)
      : "";
    const positiveShockExpressionLock = isUgcShockingFactReactionMode(plan)
      ? "Expression lock: surprised-in-a-good-way, intrigued, lightly excited, and relatable. Avoid fearful or worried look, avoid bulging eyes, avoid panic face, and avoid distressed expression."
      : "";
    const fruitCuttingOpeningLock = isUgcFruitCuttingFactExplainerMode(plan)
      ? "Opening lock: seated-at-table fruit-cutting while talking to camera, calm and safe knife handling, everyday natural home realism, no staged ad performance."
      : "";

    const hasShotGroups = Array.isArray(plan.motionControlSegments) && plan.motionControlSegments.length > 0;

    let effectiveSegmentIndex: number | undefined;
    if (hasShotGroups) {
      const normalizedSegmentIndex =
        typeof segmentIndex === "number" && Number.isFinite(segmentIndex)
          ? Math.floor(segmentIndex)
          : 0;

      if (!plan.motionControlSegments || !plan.motionControlSegments[normalizedSegmentIndex]) {
        return NextResponse.json(
          { error: "Invalid segment index for this plan." },
          { status: 400 }
        );
      }

      effectiveSegmentIndex = normalizedSegmentIndex;
    }

    const previousSegmentStartFrameUrl = getPreviousSegmentStartFrameUrl(plan, effectiveSegmentIndex);
    const segmentScriptCharacterReferences = getSegmentScriptCharacterReferences(plan, effectiveSegmentIndex);

    const prompt = buildStartFramePrompt({
      appName: asText(planRow.app_name) || "Muslimah Pro",
      formatType: asText(format.format_type) || "hybrid",
      video,
      plan,
      character,
      characterLockDescriptorBase,
      wardrobeColorwayLock,
      segmentIndex: effectiveSegmentIndex,
      previousSegmentStartFrameUrl,
      segmentCharacterNames: segmentScriptCharacterReferences.names,
    });

    let extractedFrameDataUrl: string | null = null;

    // We try to extract the exact frame from the source video using the Render Extractor service.
    // If it fails, we fall back to the generic video.thumbnail_url
    if (video.source_url) {
      try {
        let timecodeSeconds = 0;
        if (
          typeof effectiveSegmentIndex === "number" &&
          plan.motionControlSegments &&
          plan.motionControlSegments[effectiveSegmentIndex]
        ) {
          timecodeSeconds = parseStartTimeSeconds(plan.motionControlSegments[effectiveSegmentIndex].timecode);
        }

        const extractorUrl = process.env.SOCIAL_EXTRACTOR_API_URL || process.env.EXTRACTOR_API_URL || "https://social-extractor-render.onrender.com";
        const cleanUrl = extractorUrl.replace(/\/+$/, "");
        const extractorToken = process.env.SOCIAL_EXTRACTOR_API_TOKEN || process.env.EXTRACTOR_API_TOKEN || "";

        const response = await fetch(`${cleanUrl}/api/extract-single-frame`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(extractorToken ? { Authorization: `Bearer ${extractorToken}` } : {}),
          },
          body: JSON.stringify({
            url: video.source_url,
            platform: video.platform || "tiktok",
            timeSeconds: timecodeSeconds,
          }),
        });

        if (response.ok) {
          const json = await response.json();
          if (json.data) {
            extractedFrameDataUrl = json.data;
          }
        } else {
          const errText = await response.text();
          console.warn(`[start-frame] Extractor service returned error (${response.status}): ${errText}`);
        }
      } catch (err) {
        console.warn(`[start-frame] Failed to extract exact video frame via service, falling back to thumbnail. Error:`, err);
      }
    }

    const referenceImageUrls: string[] = [];
    if (previousSegmentStartFrameUrl) {
      referenceImageUrls.push(previousSegmentStartFrameUrl);
    }

    if (referenceImageUrls.length === 0 && extractedFrameDataUrl) {
      referenceImageUrls.push(extractedFrameDataUrl);
    } else if (referenceImageUrls.length === 0 && video.thumbnail_url) {
      referenceImageUrls.push(video.thumbnail_url);
    }

    const generatedDataUrl = await generateImage(prompt, {
      platform: "tiktok",
      uiGenerationMode: "ai_creative",
      visualVariant: format.format_type === "ugc" ? "ugc_real" : "brand_optimized",
      referenceImageUrls,
      characterReferenceImageUrls: Array.from(
        new Set([
          ...segmentScriptCharacterReferences.urls,
          ...(character?.reference_image_url && character.reference_image_url.trim().length > 0
            ? [character.reference_image_url]
            : []),
        ])
      ).slice(0, 4),
      characterLockDescriptor:
        character
          ? `${character.character_name}. ${characterLockDescriptorBase || "Keep same face identity and same hijab/outfit structure."}. Wardrobe recolor lock for this full script: ${wardrobeColorwayLock}. Keep hijab type and outfit silhouette unchanged, but do not use the original reference-image clothing colors. Apply this same colorway across all segments. ${positiveShockExpressionLock} ${fruitCuttingOpeningLock}`
          : segmentScriptCharacterReferences.names.length > 0
            ? `Maintain consistent identity for segment cast: ${segmentScriptCharacterReferences.names.join(", ")}.`
          : undefined,
      imageModel: imageGenerationModel,
    });

    const { buffer, mimeType } = dataUrlToBuffer(generatedDataUrl);
    const generatedAt = new Date().toISOString();
    const key = `collections/${collectionId}/video-agent/start-frames/${videoId}/${generatedAt.replace(/[:.]/g, "-")}-${randomUUID()}.png`;
    const imageUrl = await uploadToR2(key, buffer, mimeType || "image/png");

    const nextStartFrame = {
      imageUrl,
      prompt,
      generatedAt,
      characterId: character?.id || characterId || null,
      imageModel: imageGenerationModel,
    };

    let nextPlan: PlanShape;
    if (typeof effectiveSegmentIndex === "number" && plan.motionControlSegments && plan.motionControlSegments[effectiveSegmentIndex]) {
      const updatedSegments = [...plan.motionControlSegments];
      updatedSegments[effectiveSegmentIndex] = {
        ...updatedSegments[effectiveSegmentIndex],
        startFrame: nextStartFrame,
      };
      nextPlan = {
        ...plan,
        startFrame: effectiveSegmentIndex === 0 ? nextStartFrame : plan.startFrame,
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
