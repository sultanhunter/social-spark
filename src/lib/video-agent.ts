import { randomUUID } from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { fetchWithProxy } from "@/lib/proxy-fetch";
import { extractPlatform } from "@/lib/utils";
import { DEFAULT_REASONING_MODEL, type ReasoningModel } from "@/lib/reasoning-model";
import { extractVideoFrames } from "@/lib/social-extractor";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || "");

type NormalizedFormatType = "ugc" | "ai_video" | "hybrid" | "editorial";
type AnalysisMethod = "frame_aware";
type InlineImagePart = { inlineData: { data: string; mimeType: string } };
const MAX_SINGLE_VIDEO_CLIP_SECONDS = 8;

type VideoContentCategory =
  | "islamic_only"
  | "islamic_period_pregnancy"
  | "period_pregnancy_only";

interface VideoContentClassification {
  category: VideoContentCategory;
  confidence: number;
  reason: string;
}

export interface VideoSourceMetadata {
  url: string;
  platform: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  userNotes?: string | null;
  transcriptSummary?: string | null;
  transcriptText?: string | null;
  sourceDurationSeconds?: number | null;
}

export interface VideoFormatAnalysis {
  formatName: string;
  formatType: NormalizedFormatType;
  formatSignature: string;
  analysisMethod: AnalysisMethod;
  sourceDurationSeconds: number | null;
  sampledFrameCount: number;
  sampledFrameSources: string[];
  directMediaUrl: string | null;
  r2VideoUrl: string | null;
  transcriptAvailable: boolean;
  transcriptSummary: string;
  transcriptText: string;
  transcriptHighlights: string[];
  visualSignals: string[];
  onScreenTextPatterns: string[];
  summary: string;
  whyItWorks: string[];
  hookPatterns: string[];
  shotPattern: string[];
  editingStyle: string[];
  scriptScaffold: string;
  higgsfieldPromptTemplate: string;
  recreationChecklist: string[];
  durationGuidance: string;
  confidence: number;
}

export interface ExistingFormatCandidate {
  id: string;
  formatName: string;
  formatType: string;
  formatSignature: string;
  summary: string;
  hookPatterns: string[];
  editingStyle: string[];
}

export interface FormatMatchDecision {
  matchedFormatId: string | null;
  confidence: number;
  reason: string;
}

type PlanBeat = {
  timecode: string;
  visual: string;
  narration: string;
  onScreenText: string;
  editNote: string;
};

type SegmentScriptShot = {
  shotId: string;
  visual: string;
  narration: string;
  onScreenText: string;
  editNote: string;
};

type MultiShotPrompt = {
  shotId: string;
  generationType: "base_ai_video" | "ugc_video" | "ai_broll" | "product_ui_overlay" | "transition_fx";
  scene: string;
  prompt: string;
  shotDuration: string;
};

export interface VideoStartFrame {
  imageUrl?: string;
  prompt?: string;
  generatedAt?: string;
  characterId?: string | null;
  imageModel?: string;
}

export interface MotionControlSegment {
  segmentId: number;
  timecode: string;
  durationSeconds: number;
  startFramePrompt: string;
  script?: {
    hook: string;
    shots: SegmentScriptShot[];
    cta: string;
  };
  veoPrompt?: string;
  multiShotPrompts?: MultiShotPrompt[];
  startFrame?: VideoStartFrame;
}

export interface VideoRecreationPlan {
  title: string;
  strategy: string;
  objective: string;
  klingMotionControlOnly?: boolean;
  contentClassification?: VideoContentClassification;
  maxSingleClipDurationSeconds?: number;
  useMotionControl?: boolean;
  motionControlSegments?: MotionControlSegment[];
  integrationMode: "standard_adaptation" | "public_figure_overlay_only";
  publicFigureNotes: string;
  overlayOpportunities: string[];
  deliverableSpec: {
    duration: string;
    aspectRatio: string;
    platforms: string[];
    voiceStyle: string;
  };
  script: {
    hook: string;
    beats: PlanBeat[];
    cta: string;
  };
  socialCaption: {
    caption: string;
    hashtags: string[];
  };
  seedanceSinglePrompt?: {
    model: string;
    prompt: string;
    targetDuration: string;
  };
  higgsfieldPrompts?: MultiShotPrompt[];
  finalCutProSteps: string[];
  productionSteps: string[];
  editingTimeline: string[];
  assetsChecklist: string[];
  qaChecklist: string[];
}

export interface UGCCharacterProfile {
  id?: string;
  characterName: string;
  personaSummary: string;
  visualStyle: string;
  wardrobeNotes: string;
  voiceTone: string;
  promptTemplate: string;
  referenceImageUrl?: string | null;
  imageModel?: string | null;
}

export type ScriptAgentVideoType = "ugc" | "ai_animation" | "faceless_broll" | "hybrid";
export type ScriptAgentTopicCategory = "period_pregnancy" | "islamic_period_pregnancy";
export type ScriptAgentCampaignMode = "standard" | "widget_reaction_ugc";

export interface VideoScriptIdeationPlan {
  title: string;
  objective: string;
  campaignMode: ScriptAgentCampaignMode;
  topicCategory: ScriptAgentTopicCategory;
  selectedVideoType: ScriptAgentVideoType;
  videoTypeReason: string;
  appHookStrategy: string;
  targetDurationSeconds: number;
  maxSingleClipDurationSeconds: number;
  script: {
    hook: string;
    beats: PlanBeat[];
    cta: string;
  };
  motionControlSegments: MotionControlSegment[];
  socialCaption: {
    caption: string;
    hashtags: string[];
  };
  productionSteps: string[];
  qaChecklist: string[];
}

function requireGeminiKey(): void {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    throw new Error("GOOGLE_GEMINI_API_KEY is missing. Add it before running the video pipeline.");
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function sanitizeString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const cleaned = cleanText(value);
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];

  const output: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") continue;
    const cleaned = cleanText(item);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= max) break;
  }

  return output;
}

function sanitizeHashtagArray(value: unknown, max = 8): string[] {
  const base = sanitizeStringArray(value, max * 2);
  const output: string[] = [];
  const seen = new Set<string>();

  for (const item of base) {
    const compact = item.replace(/\s+/g, "").replace(/^#+/, "").trim();
    if (!compact) continue;
    const tag = `#${compact}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(tag);
    if (output.length >= max) break;
  }

  return output;
}

function sanitizeNumber(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return value;
}

function sanitizePlanBeats(value: unknown, maxBeats: number): PlanBeat[] {
  const beatsRaw = Array.isArray(value) ? value : [];
  return beatsRaw
    .map((beat) => {
      if (!isRecord(beat)) return null;
      return {
        timecode: sanitizeString(beat.timecode, "0:00-0:04"),
        visual: sanitizeString(beat.visual, "Match source format visual pacing."),
        narration: sanitizeString(beat.narration, ""),
        onScreenText: sanitizeString(beat.onScreenText, ""),
        editNote: sanitizeString(beat.editNote, ""),
      };
    })
    .filter((beat): beat is PlanBeat => Boolean(beat))
    .slice(0, maxBeats);
}

function closeOpenEndedLine(text: string): string {
  const cleaned = cleanText(text);
  if (!cleaned) return "";

  const danglingEndPattern = /(\b(and|but|so|because|then|or)\s*)$/i;
  const withoutDangling = cleaned.replace(danglingEndPattern, "").trim();
  const candidate = withoutDangling || cleaned;

  if (/[.!?]$/.test(candidate)) return candidate;
  return `${candidate}.`;
}

function sanitizeSegmentScriptShots(value: unknown, maxShots: number): SegmentScriptShot[] {
  const shotsRaw = Array.isArray(value) ? value : [];
  return shotsRaw
    .map((shot, index) => {
      if (!isRecord(shot)) return null;
      const shotIdRaw = sanitizeString(shot.shotId, "");
      const shotId =
        shotIdRaw || sanitizeString(shot.timecode, "") || `shot${index + 1}`;
      return {
        shotId: /^shot\d+$/i.test(shotId) ? shotId.toLowerCase() : `shot${index + 1}`,
        visual: sanitizeString(shot.visual, "Match source format visual pacing."),
        narration: closeOpenEndedLine(sanitizeString(shot.narration, "")),
        onScreenText: closeOpenEndedLine(sanitizeString(shot.onScreenText, "")),
        editNote: sanitizeString(shot.editNote, ""),
      };
    })
    .filter((shot): shot is SegmentScriptShot => Boolean(shot))
    .slice(0, maxShots);
}

function planBeatsToSegmentShots(beats: PlanBeat[]): SegmentScriptShot[] {
  return beats.map((beat, index) => ({
    shotId: `shot${index + 1}`,
    visual: beat.visual,
    narration: closeOpenEndedLine(beat.narration),
    onScreenText: closeOpenEndedLine(beat.onScreenText),
    editNote: beat.editNote,
  }));
}

function shortenForTransition(value: string, maxWords = 12): string {
  const cleaned = cleanText(value);
  if (!cleaned) return "";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return cleaned;
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function enforceSegmentBoundaryTransitions(segments: MotionControlSegment[]): MotionControlSegment[] {
  return segments.map((segment, index) => {
    const next = segments[index + 1];
    if (!segment.script?.shots?.length || !next?.script?.shots?.length) {
      return segment;
    }

    const shots = [...segment.script.shots];
    const lastShot = shots[shots.length - 1];
    const nextFirstShot = next.script.shots[0];
    const nextAnchor = shortenForTransition(
      nextFirstShot.visual || nextFirstShot.onScreenText || next.startFramePrompt
    );

    const transitionNote = cleanText(
      `End this shot with a clean handoff into Segment ${next.segmentId}. ` +
      `${nextAnchor ? `Match cut toward next opening: ${nextAnchor}. ` : ""}` +
      "Keep camera axis, subject placement, and lighting continuity for seamless merge in final edit."
    );

    shots[shots.length - 1] = {
      ...lastShot,
      narration: closeOpenEndedLine(lastShot.narration),
      onScreenText: closeOpenEndedLine(lastShot.onScreenText),
      editNote: cleanText(`${lastShot.editNote || ""} ${transitionNote}`),
    };

    return {
      ...segment,
      script: {
        ...segment.script,
        shots,
      },
    };
  });
}

function enforceWidgetReactionSeriesPattern(segments: MotionControlSegment[], appName: string): MotionControlSegment[] {
  const overlayTemplates = [
    '"I did not know an app like this existed."',
    '"I just found the perfect widget for tracking cycles."',
    '"Finally clear worship status for each cycle phase."',
  ];

  return segments.map((segment, index, all) => {
    const shots = [...(segment.script?.shots || [])];
    if (shots.length === 0) {
      shots.push({
        shotId: "shot1",
        visual: "UGC talking-head reaction in a real home setting, natural daylight.",
        narration: "I wish I had this earlier.",
        onScreenText: overlayTemplates[index % overlayTemplates.length],
        editNote: "Strong surprised-to-happy expression.",
      });
    }

    const firstShot = shots[0];
    shots[0] = {
      ...firstShot,
      visual: cleanText(`${firstShot.visual} Real UGC reaction beat: initial surprise, then happy relief.`),
      onScreenText: cleanText(firstShot.onScreenText) || overlayTemplates[index % overlayTemplates.length],
      editNote: cleanText(
        `${firstShot.editNote || ""} Keep this as a genuine reaction moment, not salesy delivery.`
      ),
    };

    const overlayShotIndex = Math.min(1, shots.length - 1);
    const overlayShot = shots[overlayShotIndex];
    shots[overlayShotIndex] = {
      ...overlayShot,
      onScreenText:
        cleanText(overlayShot.onScreenText) ||
        "Widget shows current cycle phase and worship status (prayer, fasting, Quran: permissible or paused).",
      editNote: cleanText(
        `${overlayShot.editNote || ""} Emphasize lock-screen/home-screen widget utility in text overlay.`
      ),
    };

    const isLastSegment = index === all.length - 1;
    const lastShotIndex = shots.length - 1;
    const lastShot = shots[lastShotIndex];
    shots[lastShotIndex] = {
      ...lastShot,
      narration: closeOpenEndedLine(lastShot.narration),
      onScreenText: closeOpenEndedLine(lastShot.onScreenText),
      editNote: cleanText(
        `${lastShot.editNote || ""} End with 0.5s visual hold. In final edit, append full-screen ${appName} screen recording showing home and lock-screen widgets.`
      ),
    };

    return {
      ...segment,
      script: {
        hook: segment.script?.hook || "",
        shots,
        cta: isLastSegment
          ? closeOpenEndedLine(segment.script?.cta || "Save this and try the widget setup today.")
          : closeOpenEndedLine(segment.script?.cta || ""),
      },
    };
  });
}

function buildVeo31SegmentPrompt(args: {
  segment: MotionControlSegment;
  nextSegment?: MotionControlSegment;
  styleHint: string;
  appName: string;
  ugcCharacter?: UGCCharacterProfile | null;
}): string {
  const { segment, nextSegment, styleHint, appName, ugcCharacter } = args;
  const isAnimatedStyle = /animated|animation|cgi/i.test(styleHint);
  const shots = segment.script?.shots || [];

  const shotLines = (shots.length > 0 ? shots : [
    {
      shotId: "shot1",
      visual: segment.startFramePrompt,
      narration: segment.script?.hook || "",
      onScreenText: "",
      editNote: "",
    },
  ])
    .map((shot, index) => {
      const narration = closeOpenEndedLine(shot.narration);
      const dialogue = narration
        ? `Dialogue: "${narration.replace(/"/g, "'")}".`
        : isAnimatedStyle
          ? "No dialogue: performance carries emotion through expressive but natural animation acting and readable pose changes."
          : "No dialogue: performance carries emotion through subtle facial expression and natural body language.";
      const textCue = cleanText(shot.onScreenText)
        ? ` On-screen text: ${closeOpenEndedLine(shot.onScreenText)}`
        : "";
      const editCue = cleanText(shot.editNote) ? ` Edit intent: ${shot.editNote}.` : "";
      return `Shot ${index + 1}: ${cleanText(shot.visual)}. ${dialogue}${textCue}${editCue}`;
    })
    .join(" ");

  const characterLock = ugcCharacter
    ? `Character lock: ${ugcCharacter.characterName}. ${cleanText(ugcCharacter.promptTemplate)}.`
    : isAnimatedStyle
      ? "Character consistency: keep same animated character silhouette, face shape language, color palette, and costume continuity throughout this segment."
      : "Character consistency: keep same person identity, face geometry, and wardrobe continuity throughout this segment.";

  const transitionHint = nextSegment
    ? `End frame transition: finish with a clean match-cut handoff toward the next segment opening (${shortenForTransition(nextSegment.startFramePrompt, 14)}).`
    : "End frame transition: finish cleanly with no abrupt visual jump so final edit can close naturally.";

  return cleanText(
    [
      `Veo 3.1 prompt. Generate an ${MAX_SINGLE_VIDEO_CLIP_SECONDS}-second vertical 9:16 ${styleHint} segment (segment ${segment.segmentId}).`,
      isAnimatedStyle
        ? "Quality target: high-end CGI animation look, stylized but premium 3D rendering, clean topology, stable shading, smooth deformation, expressive eyes and lips, coherent lighting, no uncanny artifacts, no texture flicker, no muddy frames."
        : "Quality target: photorealistic, true-to-life UGC realism, natural skin texture and pores, realistic fabric physics, authentic handheld smartphone camera behavior, physically plausible lighting, no waxy skin, no plastic look, no AI artifacts or uncanny facial motion.",
      `Environment continuity: keep location, camera axis, lens feel, and light direction stable across all shots in this segment.`,
      characterLock,
      `App integration: if app is referenced, keep it subtle and practical. Mention ${appName} at most once.`,
      `Shot plan: ${shotLines}`,
      transitionHint,
    ].join(" ")
  );
}

function ensureVeoPromptQuality(prompt: string, fallback: string, styleHint: string): string {
  const cleaned = cleanText(prompt);
  if (!cleaned) return fallback;

  const hasShotStructure = /\bshot\s*1\b/i.test(cleaned);
  const isAnimatedStyle = /animated|animation|cgi/i.test(styleHint);
  const hasStyleCue = isAnimatedStyle
    ? /\b(animated|animation|cgi|stylized|3d|render|shading|deformation)\b/i.test(cleaned)
    : /\b(photoreal|realistic|natural skin|micro-expression|handheld|no ai artifacts|no uncanny)\b/i.test(cleaned);

  if (!hasShotStructure || !hasStyleCue) {
    return fallback;
  }

  return cleaned;
}

function parseClockToSeconds(value: string): number | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;

  const parts = cleaned.split(":").map((token) => Number(token));
  if (parts.some((part) => Number.isNaN(part))) return null;

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

function parseTimecodeRange(timecode: string): { start: number; end: number } | null {
  const cleaned = cleanText(timecode);
  if (!cleaned) return null;
  const [startRaw, endRaw] = cleaned.split("-").map((token) => token.trim());
  const start = startRaw ? parseClockToSeconds(startRaw) : null;
  const end = endRaw ? parseClockToSeconds(endRaw) : null;

  if (typeof start !== "number") return null;
  if (typeof end === "number" && end > start) {
    return { start, end };
  }

  return { start, end: start + 4 };
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function splitBeatsIntoShotGroups(args: {
  beats: PlanBeat[];
  totalDurationSeconds: number;
  maxSegmentSeconds: number;
  hook: string;
  cta: string;
}): MotionControlSegment[] {
  const { beats, totalDurationSeconds, maxSegmentSeconds, hook, cta } = args;
  const safeTotal = Math.max(maxSegmentSeconds, Math.round(totalDurationSeconds));
  const segmentCount = Math.max(1, Math.ceil(safeTotal / maxSegmentSeconds));
  const beatChunkSize = Math.max(1, Math.ceil(Math.max(1, beats.length) / segmentCount));

  return Array.from({ length: segmentCount }, (_, index): MotionControlSegment => {
    const start = index * maxSegmentSeconds;
    const end = Math.min(safeTotal, start + maxSegmentSeconds);

    const rangedBeats = beats.filter((beat) => {
      const range = parseTimecodeRange(beat.timecode);
      if (!range) return false;
      return range.start >= start && range.start < end;
    });

    const chunkStart = index * beatChunkSize;
    const chunkEnd = chunkStart + beatChunkSize;
    const fallbackChunk = beats.slice(chunkStart, chunkEnd);
    const segmentBeats = rangedBeats.length > 0 ? rangedBeats : fallbackChunk;
    const leadBeat = segmentBeats[0] || beats[0];

    return {
      segmentId: index + 1,
      timecode: `${formatClock(start)}-${formatClock(end)}`,
      durationSeconds: Math.max(1, end - start),
      startFramePrompt: cleanText(
        leadBeat?.visual || leadBeat?.onScreenText || leadBeat?.narration || `Open shot for segment ${index + 1}.`
      ),
      script: {
        hook: index === 0 ? cleanText(hook) : "",
        shots: planBeatsToSegmentShots(segmentBeats),
        cta: index === segmentCount - 1 ? cleanText(cta) : "",
      },
    };
  });
}

function normalizeBeatsToTargetDuration(args: {
  beats: PlanBeat[];
  targetDurationSeconds: number;
  minBeatCount: number;
  hook: string;
}): PlanBeat[] {
  const { beats, targetDurationSeconds, minBeatCount, hook } = args;
  const safeDuration = Math.max(MAX_SINGLE_VIDEO_CLIP_SECONDS, Math.round(targetDurationSeconds));
  const safeMinBeats = Math.max(1, minBeatCount);

  const seedBeats = beats.length > 0
    ? [...beats]
    : [{
      timecode: "0:00-0:04",
      visual: cleanText(hook) || "Open with the source style hook scene.",
      narration: cleanText(hook),
      onScreenText: cleanText(hook),
      editNote: "",
    }];

  const expanded: PlanBeat[] = [...seedBeats];
  while (expanded.length < safeMinBeats) {
    const base = seedBeats[expanded.length % seedBeats.length];
    expanded.push({
      ...base,
      editNote: cleanText(`${base.editNote || ""} Continue this progression naturally.`),
    });
  }

  const totalBeats = expanded.length;
  const step = safeDuration / totalBeats;

  return expanded.map((beat, index) => {
    const start = Math.max(0, Math.round(index * step));
    const nextRaw = index === totalBeats - 1 ? safeDuration : Math.round((index + 1) * step);
    const end = Math.max(start + 1, nextRaw);
    return {
      ...beat,
      timecode: `${formatClock(start)}-${formatClock(end)}`,
    };
  });
}

function sanitizeMultiShotPrompts(value: unknown, max = 8): MultiShotPrompt[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((item, index): MultiShotPrompt | null => {
      if (!isRecord(item)) return null;
      const generationType = sanitizeHiggsfieldGenerationType(item.generationType);
      const scene = sanitizeString(item.scene, `Segment scene ${index + 1}`);
      const basePrompt = sanitizeString(
        item.prompt,
        "Create a high-retention vertical 9:16 scene with natural motion continuity, realistic textures, clean lighting, and faithful emotional tone from the script."
      );
      const withPerformance = ensureHiggsfieldPromptHasPerformanceInstruction(
        stripPromptMetaTags(basePrompt)
      );
      const withScreenCue = needsAppScreenReplacementCue(generationType, scene, withPerformance)
        ? ensureAppScreenReplacementDirective(withPerformance)
        : withPerformance;

      return {
        shotId: sanitizeKlingShotId(item.shotId, index),
        generationType,
        scene,
        prompt: enforceKlingPromptWordLimit(withScreenCue, 77),
        shotDuration: sanitizeString(item.shotDuration, "4s"),
      };
    })
    .filter((item): item is MultiShotPrompt => Boolean(item))
    .slice(0, max);
}

function buildFallbackMultiShotPrompts(segment: MotionControlSegment, segmentIndex: number): MultiShotPrompt[] {
  const shots = segment.script?.shots || [];
  const source = shots.length > 0 ? shots : [
    {
      shotId: "shot1",
      visual: segment.startFramePrompt,
      narration: segment.script?.hook || "",
      onScreenText: "",
      editNote: "",
    },
  ];

  const perShotDuration = Math.max(2, Math.round(segment.durationSeconds / Math.max(1, source.length)));
  const prompts = source.slice(0, 6).map((shot: SegmentScriptShot, shotIndex): MultiShotPrompt => {
    const duration = perShotDuration;
    const scene = cleanText(shot.visual) || `Segment ${segment.segmentId} scene ${shotIndex + 1}`;
    const prompt = cleanText(
      [
        scene,
        shot.narration ? `Narration intent: ${shot.narration}.` : "",
        shot.onScreenText ? `On-screen text direction: ${shot.onScreenText}.` : "",
        "Vertical 9:16, cinematic but natural realism, smooth temporal continuity, clean transitions, no visual artifacts.",
      ].join(" ")
    );

    return {
      shotId: `group${segmentIndex + 1}_shot${shotIndex + 1}`,
      generationType: "ai_broll",
      scene,
      prompt: enforceKlingPromptWordLimit(ensureHiggsfieldPromptHasPerformanceInstruction(prompt), 77),
      shotDuration: `${duration}s`,
    };
  });

  return prompts.length > 0 ? prompts : [
    {
      shotId: `group${segmentIndex + 1}_shot1`,
      generationType: "ai_broll",
      scene: `Segment ${segment.segmentId} opening scene`,
      prompt: enforceKlingPromptWordLimit(
        ensureHiggsfieldPromptHasPerformanceInstruction(
          `${segment.startFramePrompt}. Vertical 9:16, realistic motion, coherent lighting, no artifacts.`
        ),
        77
      ),
      shotDuration: `${Math.max(3, Math.min(6, segment.durationSeconds))}s`,
    },
  ];
}

function truncateToWordLimit(text: string, maxWords: number): string {
  const cleaned = cleanText(text);
  if (!cleaned) return "";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return cleaned;
  return words.slice(0, maxWords).join(" ").trim();
}

function enforceKlingPromptWordLimit(prompt: string, maxWords = 77): string {
  return truncateToWordLimit(prompt, maxWords);
}

function ensureHiggsfieldPromptHasPerformanceInstruction(prompt: string): string {
  const normalized = cleanText(prompt);
  if (!normalized) {
    return "Create a vertical 9:16 AI influencer shot with realistic movement. No dialogue: character expresses the emotion silently through facial expression and body language.";
  }

  const hasPerformanceCue =
    /\bdialogue\b/i.test(normalized) ||
    /\bno dialogue\b/i.test(normalized) ||
    /\bsilent\b/i.test(normalized) ||
    /\bvoiceover\b/i.test(normalized) ||
    /\bsays\b/i.test(normalized) ||
    /\bspeaks\b/i.test(normalized) ||
    /"[^"]+"/.test(normalized);

  if (hasPerformanceCue) {
    return normalized;
  }

  return `${normalized} No dialogue: character expresses the intended emotion and intent silently.`;
}

function stripPromptMetaTags(prompt: string): string {
  const cleaned = prompt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      return !/^(model|recommendedmodel|duration|shotduration|why|reason)\s*:/i.test(line);
    })
    .join(" ")
    .trim();

  return cleaned;
}

function sourceDurationHint(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "unknown";
  }

  const rounded = Math.round(seconds);
  return `${rounded}s`;
}

function sourceMatchedDurationFallback(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "45-60 seconds";
  }

  const base = Math.max(10, Math.round(seconds));
  const min = Math.max(8, Math.round(base * 0.9));
  const max = Math.max(min + 2, Math.round(base * 1.1));
  return `${min}-${max} seconds (match source around ${base}s)`;
}

function sanitizeHiggsfieldGenerationType(value: unknown): MultiShotPrompt["generationType"] {
  const cleaned = sanitizeString(value, "").toLowerCase();
  if (cleaned === "base_ai_video") return "base_ai_video";
  if (cleaned === "ugc_video") return "ugc_video";
  if (cleaned === "ai_broll") return "ai_broll";
  if (cleaned === "product_ui_overlay") return "product_ui_overlay";
  if (cleaned === "transition_fx") return "transition_fx";
  return "ai_broll";
}

function sanitizeKlingShotId(value: unknown, fallbackIndex: number): string {
  const cleaned = sanitizeString(value, "").toLowerCase();
  if (/^shot\s*\d+$/.test(cleaned)) {
    return cleaned.replace(/\s+/g, "");
  }

  const numeric = cleaned.match(/\d+/)?.[0];
  if (numeric) return `shot${numeric}`;

  return `shot${fallbackIndex + 1}`;
}

function buildFinalCutProFallbackSteps(sourceDurationSeconds: number | null | undefined): string[] {
  const targetDuration = sourceMatchedDurationFallback(sourceDurationSeconds);
  return [
    "Create a new Final Cut Pro library and event; set project to vertical 1080x1920, 30fps, Rec.709 color space.",
    `Set project duration target to ${targetDuration} and create primary timeline markers for hook, body beats, and CTA.`,
    "Import all generated multi-shot clips, app screen recordings, source overlays, SFX, and music into organized keyword collections.",
    "Build the rough cut on the primary storyline following script timecodes; trim clips on motion/action to keep retention pacing.",
    "Place UGC/talking-head shots on primary storyline and keep framing continuity between adjacent cuts.",
    "Add AI B-roll and cutaway layers above primary clips (connected clips) to visually support each narration beat.",
    "Insert app UI overlays and screen-recording callouts using transform/opacity keyframes for subtle integrations.",
    "Add on-screen text titles matching hook and beat copy; enforce safe margins and consistent type scale hierarchy.",
    "Apply speed ramps and transitions only where necessary for rhythm (avoid overuse); keep most cuts clean and direct.",
    "Run primary color correction (white balance, exposure, contrast), then secondary skin tone balancing for human shots.",
    "Mix audio: dialogue/VO at consistent LUFS target, duck music under speech, and add light ambience/SFX for realism.",
    "Add captions/subtitles, proofread every line, and ensure subtitle timing aligns to spoken phrases.",
    "Perform QA pass for pacing, visual continuity, faith-positive framing, and accurate app overlay timing.",
    "Export H.264 master (vertical, high quality), then render platform-ready upload version and verify playback on mobile.",
  ];
}

function needsAppScreenReplacementCue(
  generationType: MultiShotPrompt["generationType"],
  scene: string,
  prompt: string
): boolean {
  if (generationType === "product_ui_overlay") return true;
  const combined = `${scene} ${prompt}`.toLowerCase();
  return /\b(app|ui|screen|phone screen|mobile screen|dashboard|tap|swipe|onscreen app|screen recording)\b/i.test(
    combined
  );
}

function ensureAppScreenReplacementDirective(prompt: string): string {
  const cleaned = cleanText(prompt);
  if (!cleaned) return cleaned;

  const hasChromaCue = /\b(chroma|green\s*screen|#00ff00|keyable|for\s+replacement)\b/i.test(cleaned);
  const hasStaticCameraCue =
    /\b(static|locked\s*-?\s*off|tripod|no\s+camera\s+movement|no\s+pan|no\s+tilt|no\s+zoom|no\s+dolly|handheld)\b/i.test(
      cleaned
    );

  if (hasChromaCue && hasStaticCameraCue) {
    return cleaned;
  }

  const directives: string[] = [];

  if (!hasChromaCue) {
    directives.push("Phone screen pure chroma green (#00FF00), no UI/text, minimal glare for replacement.");
  }

  if (!hasStaticCameraCue) {
    directives.push(
      "Static locked-off camera, tripod framing, no pan/tilt/zoom/dolly/handheld movement for clean post screen replacement."
    );
  }

  return `${directives.join(" ")} ${cleaned}`.trim();
}

function toCharacterLockToken(characterName: string): string {
  const cleaned = characterName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return cleaned || "character";
}

function promptNeedsCharacterLock(prompt: string, generationType: MultiShotPrompt["generationType"]): boolean {
  if (generationType === "ugc_video" || generationType === "base_ai_video") return true;
  return /\b(woman|female|girl|lady|muslimah|hijab|she|her|talking[-\s]?head|portrait|face|creator|influencer)\b/i.test(
    prompt
  );
}

function applyUgcCharacterLock(prompt: string, character: UGCCharacterProfile): string {
  const cleanedPrompt = cleanText(prompt);
  const lockLine = `Character Lock: $${toCharacterLockToken(character.characterName)}.`;

  const strippedExistingLock = cleanText(
    cleanedPrompt.replace(/character\s*lock\s*:[^.;\n]+[.;]?/gi, " ")
  );

  if (!strippedExistingLock) {
    return `${lockLine} No dialogue: character expresses calm confidence with natural eye contact.`;
  }

  return `${lockLine} ${strippedExistingLock}`;
}

function toFormatSignature(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");

  if (!normalized) {
    return "hybrid_social_format";
  }

  return normalized.split("_").slice(0, 6).join("_");
}

function normalizeFormatType(value: unknown): NormalizedFormatType {
  if (typeof value !== "string") return "hybrid";

  const cleaned = value.trim().toLowerCase();
  if (cleaned === "ugc") return "ugc";
  if (cleaned === "ai_video" || cleaned === "aivideo" || cleaned === "ai-generated") return "ai_video";
  if (cleaned === "editorial") return "editorial";
  return "hybrid";
}

function sanitizeScriptAgentVideoType(value: unknown): ScriptAgentVideoType {
  if (typeof value !== "string") return "hybrid";
  const cleaned = value.trim().toLowerCase();
  if (cleaned === "ugc") return "ugc";
  if (cleaned === "ai_animation" || cleaned === "animation" || cleaned === "ai-animation") return "ai_animation";
  if (cleaned === "faceless_broll" || cleaned === "faceless" || cleaned === "broll" || cleaned === "b-roll") {
    return "faceless_broll";
  }
  return "hybrid";
}

function sanitizeScriptAgentTopicCategory(value: unknown): ScriptAgentTopicCategory {
  if (typeof value !== "string") return "period_pregnancy";
  const cleaned = value.trim().toLowerCase();
  if (cleaned === "islamic_period_pregnancy" || cleaned === "islamic+period_pregnancy") {
    return "islamic_period_pregnancy";
  }
  return "period_pregnancy";
}

function sanitizeScriptAgentCampaignMode(value: unknown): ScriptAgentCampaignMode {
  if (typeof value !== "string") return "standard";
  const cleaned = value.trim().toLowerCase();
  if (cleaned === "widget_reaction_ugc" || cleaned === "widget-reaction-ugc") {
    return "widget_reaction_ugc";
  }
  return "standard";
}

function parseJsonFromModel(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;

    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function limitAppNameMentions(text: string, appName: string, state: { count: number }): string {
  const normalizedAppName = cleanText(appName);
  if (!normalizedAppName) return text;

  const pattern = new RegExp(escapeRegExp(normalizedAppName), "gi");

  return text.replace(pattern, (match) => {
    state.count += 1;
    return state.count <= 1 ? match : "your tracker";
  });
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function extractMetaContent(html: string, key: string): string | null {
  const escapedKey = escapeRegExp(key);

  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapedKey}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match || !match[1]) continue;
    const value = decodeHtmlEntities(match[1]).trim();
    if (value) return value;
  }

  return null;
}

async function buildVisualEvidence(source: VideoSourceMetadata, collectionId?: string): Promise<{
  method: AnalysisMethod;
  sourceDurationSeconds: number | null;
  parts: InlineImagePart[];
  sampledFrameSources: string[];
  directMediaUrl: string | null;
  r2VideoUrl: string | null;
  transcript: {
    available: boolean;
    summary: string | null;
    fullText: string | null;
    highlights: string[];
  };
}> {
  if (source.platform !== "instagram" && source.platform !== "tiktok") {
    throw new Error(
      `Strict frame-aware analysis is currently supported only for Instagram/TikTok links. Received platform: ${source.platform}`
    );
  }

  const sessionId = randomUUID().slice(0, 8);
  const frameExtraction = await extractVideoFrames(source.url, source.platform, {
    sessionId,
    frameWidth: 960,
    includeTranscript: true,
    collectionId,
  });

  const frameParts = frameExtraction.frames
    .filter((frame) => typeof frame.data === "string" && frame.data.length > 0)
    .map((frame) => ({
      inlineData: {
        data: frame.data,
        mimeType: frame.mimeType || "image/jpeg",
      },
    }));

  if (frameParts.length === 0) {
    throw new Error(
      "No frames were extracted by remote extractor. Strict frame-aware analysis requires at least one sampled frame."
    );
  }

  const transcriptHighlights = frameExtraction.transcript.segments
    .map((segment) => cleanText(segment.text))
    .filter(Boolean)
    .slice(0, 8);

  return {
    method: "frame_aware",
    sourceDurationSeconds:
      typeof frameExtraction.durationSeconds === "number" && Number.isFinite(frameExtraction.durationSeconds)
        ? frameExtraction.durationSeconds
        : null,
    parts: frameParts,
    sampledFrameSources: ["remote_extractor_frames"],
    directMediaUrl: frameExtraction.videoUrl,
    r2VideoUrl: frameExtraction.r2VideoUrl || null,
    transcript: {
      available: frameExtraction.transcript.available,
      summary: frameExtraction.transcript.summary,
      fullText: frameExtraction.transcript.fullText,
      highlights: transcriptHighlights,
    },
  };
}

function inferVideoContentCategoryFallback(sourceVideo: BuildRecreationPlanArgs["sourceVideo"]): VideoContentCategory {
  const text = cleanText(
    [
      sourceVideo.title,
      sourceVideo.description,
      sourceVideo.userNotes,
      sourceVideo.transcriptSummary,
      sourceVideo.transcriptText,
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();

  const hasIslamicSignal = /(allah|dua|quran|hadith|salah|islam|islamic|deen|ramadan|hijab|muslim)/i.test(text);
  const hasPeriodPregnancySignal =
    /(period|menstrual|cycle|ovulation|pms|pcos|pregnan|fertility|postpartum|trimester|breastfeed|conception)/i.test(text);

  if (hasIslamicSignal && hasPeriodPregnancySignal) return "islamic_period_pregnancy";
  if (hasIslamicSignal) return "islamic_only";
  return "period_pregnancy_only";
}

async function classifyVideoContentCategory(args: {
  model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;
  sourceVideo: BuildRecreationPlanArgs["sourceVideo"];
  appName: string;
  appContext: string;
}): Promise<VideoContentClassification> {
  const { model, sourceVideo, appName, appContext } = args;

  const prompt = `You are a strict content classifier for short-form video rewriting.

Classify the source video into exactly ONE category:
- islamic_only
- islamic_period_pregnancy
- period_pregnancy_only

APP CONTEXT:
- App Name: ${appName}
- App Context: ${appContext || "N/A"}

SOURCE VIDEO:
- Title: ${sourceVideo.title || "N/A"}
- Description: ${sourceVideo.description || "N/A"}
- User Notes: ${sourceVideo.userNotes || "N/A"}
- Transcript Summary: ${sourceVideo.transcriptSummary || "N/A"}
- Transcript Text: ${(sourceVideo.transcriptText || "N/A").slice(0, 8000)}

Classification guide:
- islamic_only: Islamic/spiritual framing is central, but period/pregnancy topic is absent.
- islamic_period_pregnancy: Islamic/spiritual framing and period/pregnancy are both clearly present.
- period_pregnancy_only: Period/pregnancy is central and Islamic framing is absent or minor.

Return strict JSON only:
{
  "category": "islamic_only|islamic_period_pregnancy|period_pregnancy_only",
  "confidence": 0.0,
  "reason": "short reason"
}`;

  try {
    const result = await model.generateContent(prompt);
    const parsed = parseJsonFromModel(result.response.text());
    const row = isRecord(parsed) ? parsed : {};

    const categoryRaw = sanitizeString(row.category, "").toLowerCase();
    const category: VideoContentCategory =
      categoryRaw === "islamic_only" ||
      categoryRaw === "islamic_period_pregnancy" ||
      categoryRaw === "period_pregnancy_only"
        ? categoryRaw
        : inferVideoContentCategoryFallback(sourceVideo);

    return {
      category,
      confidence: clamp(sanitizeNumber(row.confidence, 0.6), 0, 1),
      reason: sanitizeString(row.reason, "Category inferred from source transcript and metadata."),
    };
  } catch {
    const fallback = inferVideoContentCategoryFallback(sourceVideo);
    return {
      category: fallback,
      confidence: 0.55,
      reason: "Fallback classification from source metadata and transcript keywords.",
    };
  }
}

export async function fetchVideoSourceMetadata(url: string): Promise<VideoSourceMetadata> {
  const platform = extractPlatform(url);
  let title: string | null = null;
  let description: string | null = null;
  let thumbnailUrl: string | null = null;

  try {
    const response = await fetchWithProxy(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      redirect: "follow",
    });

    if (response.ok) {
      const html = await response.text();

      title =
        extractMetaContent(html, "og:title") ||
        extractMetaContent(html, "twitter:title") ||
        (() => {
          const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
          return titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : null;
        })();

      description =
        extractMetaContent(html, "og:description") ||
        extractMetaContent(html, "twitter:description") ||
        extractMetaContent(html, "description");

      thumbnailUrl =
        extractMetaContent(html, "og:image") ||
        extractMetaContent(html, "twitter:image") ||
        null;
    }
  } catch {
    // Metadata fallback is acceptable. We'll continue with URL + platform only.
  }

  return {
    url,
    platform,
    title,
    description,
    thumbnailUrl,
  };
}

export async function analyzeVideoFormatFromSource(
  source: VideoSourceMetadata,
  reasoningModel: ReasoningModel = DEFAULT_REASONING_MODEL,
  collectionId?: string
): Promise<VideoFormatAnalysis> {
  requireGeminiKey();
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const visualEvidence = await buildVisualEvidence(source, collectionId);

  const prompt = `You are a short-form video format analyst.

Task:
Classify this source video into a reusable format template that can be reused for future videos.

SOURCE VIDEO:
- URL: ${source.url}
- Platform: ${source.platform}
- Title: ${source.title || "N/A"}
- Description: ${source.description || "N/A"}
- User Notes: ${source.userNotes || "N/A"}

VISUAL EVIDENCE:
- analysisMethod: ${visualEvidence.method}
- sampledFramesAttached: ${visualEvidence.parts.length}
- sampledFrameSources: ${visualEvidence.sampledFrameSources.join(", ") || "none"}
- directMediaUrl: ${visualEvidence.directMediaUrl || "N/A"}

TRANSCRIPT EVIDENCE:
- transcriptAvailable: ${visualEvidence.transcript.available ? "yes" : "no"}
- transcriptSummary: ${visualEvidence.transcript.summary || "N/A"}
- transcriptHighlights: ${visualEvidence.transcript.highlights.join(" | ") || "N/A"}
- transcriptFullText: ${visualEvidence.transcript.fullText || "N/A"}

OUTPUT RULES:
- Return strict JSON only.
- formatType must be one of: ugc, ai_video, hybrid, editorial.
- formatSignature must be stable across similar videos, lowercase snake_case, 3-6 words.
- Focus on structure and repeatable production system (hook type, shot style, edit rhythm), not topic specifics.
- Extract visible text overlays from attached frames when possible.
- If transcript is available, use it heavily for hook language patterns and messaging structure.

JSON SHAPE:
{
  "formatName": "string",
  "formatType": "ugc|ai_video|hybrid|editorial",
  "formatSignature": "string",
  "transcriptHighlights": ["string"],
  "visualSignals": ["string"],
  "onScreenTextPatterns": ["string"],
  "summary": "string",
  "whyItWorks": ["string"],
  "hookPatterns": ["string"],
  "shotPattern": ["string"],
  "editingStyle": ["string"],
  "scriptScaffold": "string",
  "higgsfieldPromptTemplate": "string",
  "recreationChecklist": ["string"],
  "durationGuidance": "string",
  "confidence": 0.0
}`;

  const payload = [{ text: prompt }, ...visualEvidence.parts] as Array<
    { text: string } | InlineImagePart
  >;

  const result = await model.generateContent(payload);
  const parsed = parseJsonFromModel(result.response.text());
  const row = isRecord(parsed) ? parsed : {};

  const formatName = sanitizeString(row.formatName, "Short-form social format");
  const formatType = normalizeFormatType(row.formatType);
  const rawSignature = sanitizeString(row.formatSignature, "");
  const formatSignature = toFormatSignature(rawSignature || `${formatType}_${formatName}`);

  return {
    formatName,
    formatType,
    formatSignature,
    analysisMethod: visualEvidence.method,
    sourceDurationSeconds: visualEvidence.sourceDurationSeconds,
    sampledFrameCount: visualEvidence.parts.length,
    sampledFrameSources: visualEvidence.sampledFrameSources,
    directMediaUrl: visualEvidence.directMediaUrl,
    r2VideoUrl: visualEvidence.r2VideoUrl,
    transcriptAvailable: visualEvidence.transcript.available,
    transcriptSummary: sanitizeString(
      visualEvidence.transcript.summary,
      visualEvidence.transcript.available ? "Transcript extracted from source video." : ""
    ),
    transcriptText: sanitizeString(visualEvidence.transcript.fullText, ""),
    transcriptHighlights: sanitizeStringArray(
      row.transcriptHighlights,
      10
    ).length
      ? sanitizeStringArray(row.transcriptHighlights, 10)
      : visualEvidence.transcript.highlights,
    visualSignals: sanitizeStringArray(row.visualSignals, 8),
    onScreenTextPatterns: sanitizeStringArray(row.onScreenTextPatterns, 10),
    summary: sanitizeString(row.summary, "Reusable short-form structure with a strong hook and clear CTA."),
    whyItWorks: sanitizeStringArray(row.whyItWorks, 6),
    hookPatterns: sanitizeStringArray(row.hookPatterns, 6),
    shotPattern: sanitizeStringArray(row.shotPattern, 10),
    editingStyle: sanitizeStringArray(row.editingStyle, 8),
    scriptScaffold: sanitizeString(
      row.scriptScaffold,
      "Hook (0-3s) -> Value beats (3-18s) -> CTA (18-25s). Keep narration direct and emotionally grounded."
    ),
    higgsfieldPromptTemplate: sanitizeString(
      row.higgsfieldPromptTemplate,
      "Create a cinematic 9:16 vertical short with soft natural lighting, clean composition, and realistic movement."
    ),
    recreationChecklist: sanitizeStringArray(row.recreationChecklist, 10),
    durationGuidance: sanitizeString(row.durationGuidance, "15-30 seconds, vertical 9:16"),
    confidence: clamp(sanitizeNumber(row.confidence, 0.64), 0, 1),
  };
}

export async function matchCandidateToExistingFormat(
  candidate: VideoFormatAnalysis,
  existingFormats: ExistingFormatCandidate[],
  reasoningModel: ReasoningModel = DEFAULT_REASONING_MODEL
): Promise<FormatMatchDecision> {
  if (existingFormats.length === 0) {
    return {
      matchedFormatId: null,
      confidence: 1,
      reason: "No existing formats yet.",
    };
  }

  requireGeminiKey();
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const existingSerialized = existingFormats
    .slice(0, 40)
    .map((format) => ({
      id: format.id,
      formatName: format.formatName,
      formatType: format.formatType,
      formatSignature: format.formatSignature,
      summary: format.summary,
      hookPatterns: format.hookPatterns,
      editingStyle: format.editingStyle,
    }));

  const prompt = `You are matching a new video format candidate against an existing format library.

CANDIDATE:
${JSON.stringify(candidate, null, 2)}

EXISTING FORMATS:
${JSON.stringify(existingSerialized, null, 2)}

TASK:
- If candidate is the same reusable format system as one existing format, return that format id.
- If not similar enough, return null.
- Prioritize structure and production system, not topic.

Output strict JSON only:
{
  "matchedFormatId": "existing-id-or-null",
  "confidence": 0.0,
  "reason": "short reason"
}`;

  const result = await model.generateContent(prompt);
  const parsed = parseJsonFromModel(result.response.text());
  const row = isRecord(parsed) ? parsed : {};
  const idSet = new Set(existingFormats.map((format) => format.id));

  const matchedFormatIdRaw = row.matchedFormatId;
  const matchedFormatId =
    typeof matchedFormatIdRaw === "string" && idSet.has(matchedFormatIdRaw)
      ? matchedFormatIdRaw
      : null;

  return {
    matchedFormatId,
    confidence: clamp(sanitizeNumber(row.confidence, matchedFormatId ? 0.68 : 0.42), 0, 1),
    reason: sanitizeString(row.reason, matchedFormatId ? "Matched to an existing format." : "No strong format match."),
  };
}

interface BuildRecreationPlanArgs {
  appName: string;
  appContext: string;
  sourceVideo: {
    sourceUrl: string;
    title: string | null;
    description: string | null;
    platform: string;
    userNotes: string | null;
    transcriptSummary?: string | null;
    transcriptText?: string | null;
    sourceDurationSeconds?: number | null;
  };
  format: VideoFormatAnalysis;
  ugcCharacter?: UGCCharacterProfile | null;
  reasoningModel?: ReasoningModel;
  useMotionControl?: boolean;
  useKlingMotionControl?: boolean;
}

export async function buildVideoRecreationPlan({
  appName,
  appContext,
  sourceVideo,
  format,
  ugcCharacter,
  reasoningModel = DEFAULT_REASONING_MODEL,
  useMotionControl = false,
  useKlingMotionControl = false,
}: BuildRecreationPlanArgs): Promise<VideoRecreationPlan> {
  const sourceDurationSeconds =
    typeof sourceVideo.sourceDurationSeconds === "number" && Number.isFinite(sourceVideo.sourceDurationSeconds)
      ? sourceVideo.sourceDurationSeconds
      : typeof format.sourceDurationSeconds === "number" && Number.isFinite(format.sourceDurationSeconds)
        ? format.sourceDurationSeconds
        : null;

  if (useKlingMotionControl) {
    return {
      title: sanitizeString(sourceVideo.title, `${appName} Kling motion control start-frame plan`),
      strategy:
        "Kling motion control variant: generate one high-fidelity start frame that matches the source frame-zero composition and selected character lock.",
      objective:
        "Provide a single continuity-safe start frame optimized for motion control workflows, without full script generation.",
      klingMotionControlOnly: true,
      maxSingleClipDurationSeconds: MAX_SINGLE_VIDEO_CLIP_SECONDS,
      useMotionControl: false,
      integrationMode: "standard_adaptation",
      publicFigureNotes: "No rewrite plan generated. Start-frame-only motion control mode.",
      overlayOpportunities: [],
      deliverableSpec: {
        duration: "start-frame-only",
        aspectRatio: "9:16",
        platforms: ["tiktok", "instagram_reels", "youtube_shorts"],
        voiceStyle: "N/A",
      },
      script: {
        hook: "",
        beats: [],
        cta: "",
      },
      socialCaption: {
        caption: "",
        hashtags: [],
      },
      higgsfieldPrompts: [],
      finalCutProSteps: [
        "Generate shared start frame in motion control mode.",
        "Use this frame as frame-zero input for Kling motion control generation.",
      ],
      productionSteps: [
        "Match source opening frame composition and character lock.",
        "Generate motion directly from shared start frame in Kling.",
      ],
      editingTimeline: [],
      assetsChecklist: ["Shared start frame", "Character reference image (optional)"],
      qaChecklist: [
        "Character identity matches selected profile.",
        "Environment matches source opening frame.",
      ],
    };
  }

  requireGeminiKey();
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const targetDurationSeconds =
    typeof sourceDurationSeconds === "number" && Number.isFinite(sourceDurationSeconds)
      ? Math.max(MAX_SINGLE_VIDEO_CLIP_SECONDS, Math.round(sourceDurationSeconds))
      : 60;
  const shouldGenerateShotGroups =
    useMotionControl || targetDurationSeconds > MAX_SINGLE_VIDEO_CLIP_SECONDS;
  const minBeatCount = Math.max(8, Math.ceil(targetDurationSeconds / 4));

  const contentClassification = await classifyVideoContentCategory({
    model,
    sourceVideo,
    appName,
    appContext,
  });

  const categoryStrategyBlock =
    contentClassification.category === "islamic_only"
      ? `
CATEGORY SCRIPT STRATEGY (islamic_only):
- Keep the source's Islamic tone and structure faithful.
- Add one natural bridge beat that introduces a relevant period/pregnancy challenge to make app context genuinely useful.
- Then connect that bridge to an app-supported action without hard selling.
`
      : contentClassification.category === "islamic_period_pregnancy"
        ? `
CATEGORY SCRIPT STRATEGY (islamic_period_pregnancy):
- Preserve both Islamic framing and period/pregnancy topic throughout the script.
- Integrate app context as a practical support mechanism within the main flow.
- Use app mention as proof/help moment, not ad language.
`
        : `
CATEGORY SCRIPT STRATEGY (period_pregnancy_only):
- Preserve the period/pregnancy core topic and original structure.
- Add light faith-aware framing where natural and respectful (not preachy).
- Integrate app context as a practical daily-use support in a native way.
`;

  const prompt = `You are a senior short-form video strategist.

Goal:
Create a full recreation plan for the app below using this selected source format.

APP:
- Name: ${appName}
- Context: ${appContext || "N/A"}

TOOLS AVAILABLE:
- AI multi-shot video generation tools (shot-based workflow)
- Professional video editing tools

CREATOR CONSTRAINT:
- Assume there are no real human creators available for collaboration.
- If this format requires on-camera human presence (UGC, testimonial, talking-head, lifestyle human actions), use AI-generated creator shots.
- Keep one consistent influencer persona across scenes (face, age range, modest styling, tone, lighting continuity).
- Do not mention "AI" or "generated" inside the public-facing script unless explicitly needed.
- If formatType is ugc, ALWAYS use the provided UGC character profile consistently across all scenes.

SELECTED FORMAT:
${JSON.stringify(format, null, 2)}

UGC CHARACTER PROFILE:
${ugcCharacter ? JSON.stringify(ugcCharacter, null, 2) : "N/A"}

REFERENCE VIDEO:
- URL: ${sourceVideo.sourceUrl}
- Platform: ${sourceVideo.platform}
- Title: ${sourceVideo.title || "N/A"}
- Description: ${sourceVideo.description || "N/A"}
- Notes: ${sourceVideo.userNotes || "N/A"}
- Transcript Summary: ${sourceVideo.transcriptSummary || "N/A"}
- Transcript Text: ${sourceVideo.transcriptText || "N/A"}
- Source Duration: ${sourceDurationHint(sourceDurationSeconds)}

FIXED CONTENT CLASSIFICATION (already decided):
- category: ${contentClassification.category}
- confidence: ${contentClassification.confidence}
- reason: ${contentClassification.reason}

${categoryStrategyBlock}

RESPONSE RULES:
- Build for Muslim women audience and keep tone faith-aware, practical, and respectful.
- Keep output execution-ready, not high-level fluff.
- Match the source video length by default (target within +/-10% of source duration when source duration is available).
- Use enough timing beats to cover the full source-matched duration.
- Target duration: ${targetDurationSeconds}s.
- Minimum beat count: ${minBeatCount}.
- Beat timecodes should span nearly the full target duration.
- Keep this value-first, not ad-first. The video should feel like native educational/lifestyle content.
- Include app context in at least one natural beat, without turning the script into an ad.
- Prefer subtle app integration (screen recording/screenshot overlay, UI callout, or quick proof moment) instead of hard-selling narration.
- Keep explicit app name mentions to a maximum of 1 in the entire script (hook + beats + CTA).
- CTA must be soft and non-salesy (example style: save/share/follow/use this method), with optional subtle app reference only if it fits context.
- For any app overlay moment, specify placement and intent in editNote (for example: "top-right mini overlay of cycle day screen for 2s").
- Reuse the source transcript style (cadence, phrasing, emotional tone) when drafting narration so output feels native to the original format.
- Preserve the source opening mechanic in the first 1-2 beats (for example reaction face + hook text + reveal order) instead of converting to generic ad structure.
- If source has little/no spoken audio, keep the adaptation text-led and visual-led: prioritize hook text + reactions + app screen flow, avoid forcing voiceover-heavy scripting.
- When transcript is sparse, rely heavily on hookPatterns, shotPattern, onScreenTextPatterns, visualSignals, and user notes from SELECTED FORMAT.
- Include a socialCaption block with a platform-ready post caption and 3-8 relevant hashtags.
- If human presence is needed, include execution-ready multi-shot prompts with persona continuity instructions.
- Production steps must explicitly describe how to generate and stitch shot groups with app overlays.
- Add a dedicated finalCutProSteps list with explicit, ordered Final Cut Pro execution steps from project setup to export.
- Every multi-shot prompt must include performance instruction:
  - If character speaks on camera, include the exact spoken line in quotes and prefix with "Dialogue:".
  - If character does not speak, explicitly write "No dialogue" and describe facial/body expression intent.
- For every multi-shot prompt, include individual shotDuration (for example: "3.5s" or "0:08").
- For every multi-shot prompt, include generationType from: base_ai_video | ugc_video | ai_broll | product_ui_overlay | transition_fx.
- For every multi-shot prompt, include shotId in strict sequence format: shot1, shot2, shot3, ...
- Each prompt field must be 77 words maximum (hard limit).
- Prompts are for video generation, not still photos. Do not use wording like "photo", "portrait photo", "still image", or "snapshot".
- For any app showcase / phone UI shot, force a keyable phone screen: pure chroma green (#00FF00), no UI/text baked in, minimal glare/reflections.
- For any app showcase / phone UI shot, enforce static camera only: locked-off/tripod framing, no pan/tilt/zoom/dolly/handheld movement.
- Ensure prompts are ready for shot-based generation and continuity across groups.
- Ensure prompts cover required generation types for this concept (at minimum base_ai_video + ai_broll, and ugc_video whenever human talking-head presence is required).
- Keep the prompt field clean scene direction only. Do NOT include model, reason, or duration text inside prompt; use the dedicated fields.
- For ugc format, include a Character Lock continuity directive in each scene using the provided UGC character profile.
- If source content appears to include a famous public figure, public speech, or recognisable creator persona that should not be rewritten:
  - Set integrationMode to "public_figure_overlay_only".
  - Do NOT rewrite their core spoken lines or impersonate them.
  - Keep original speech/audio moments and only integrate app via subtle overlays/screenshots/screen recordings.
  - Avoid making it look like endorsement by that public figure.
${shouldGenerateShotGroups ? `
SHOT GROUP CONSTRAINTS:
- You must generate motionControlSegments (shot groups) because generation clips have a strict ${MAX_SINGLE_VIDEO_CLIP_SECONDS}-second limit.
- Split the full script into sequential logical groups with each group <= ${MAX_SINGLE_VIDEO_CLIP_SECONDS} seconds.
- For each segment, provide a startFramePrompt describing the exact visual of the very first frame (character identity, clothing, setting, framing).
- For each segment, provide segment-level script (hook/shots/cta) that covers only that segment's time window.
- Segment script shots must be continuous and self-contained.
- Do NOT end a segment with unfinished dialogue that requires continuation in next segment.
- End every segment's spoken lines as complete thoughts with full stop punctuation.
- In each segment script, shots are ordered by shotId only (shot1, shot2, ...). Do NOT use per-shot timing.
- The last shot of each segment must be transition-friendly with the next segment opening (matching camera axis/lighting/subject position where possible).
- For each segment, provide one complete detailed veoPrompt optimized for Veo 3.1. It must be copy-paste ready, include shot-wise structure (Shot 1: ... Shot 2: ...), and push photorealistic UGC realism.
- Veo prompt realism directives: natural skin texture and pores, realistic eye blinks/micro-expressions, physically plausible lighting, authentic handheld phone motion, no uncanny facial artifacts, no waxy/plastic skin look.
- For each segment, provide multiShotPrompts tailored to that segment only.
` : ""}
- Return strict JSON only.

JSON SHAPE:
{
  "title": "string",
  "strategy": "string",
  "objective": "string",
  "integrationMode": "standard_adaptation|public_figure_overlay_only",
  "publicFigureNotes": "string",
  "overlayOpportunities": ["string"],
  "deliverableSpec": {
    "duration": "string",
    "aspectRatio": "9:16",
    "platforms": ["string"],
    "voiceStyle": "string"
  },
  "script": {
    "hook": "string",
    "beats": [
      {
        "timecode": "0:00-0:03",
        "visual": "string",
        "narration": "string",
        "onScreenText": "string",
        "editNote": "string"
      }
    ],
    "cta": "string"
  },
  "socialCaption": {
    "caption": "string",
    "hashtags": ["string"]
  },
${shouldGenerateShotGroups ? `  "motionControlSegments": [
    {
      "segmentId": 1,
      "timecode": "0:00-0:08",
      "durationSeconds": 8,
      "startFramePrompt": "string",
      "script": {
        "hook": "string",
        "shots": [
          {
            "shotId": "shot1",
            "visual": "string",
            "narration": "string",
            "onScreenText": "string",
            "editNote": "string"
          }
        ],
        "cta": "string"
      },
      "veoPrompt": "single detailed Veo 3.1 prompt with Shot 1 / Shot 2 / ...",
      "multiShotPrompts": [
        {
          "shotId": "shot1",
          "generationType": "base_ai_video|ugc_video|ai_broll|product_ui_overlay|transition_fx",
          "scene": "string",
          "prompt": "string with Dialogue: \"...\" OR No dialogue: ...",
          "shotDuration": "string"
        }
      ]
    }
  ],` : `  "higgsfieldPrompts": [
    {
      "shotId": "shot1",
      "generationType": "base_ai_video|ugc_video|ai_broll|product_ui_overlay|transition_fx",
      "scene": "string",
      "prompt": "string with Dialogue: \"...\" OR No dialogue: ...",
      "shotDuration": "string"
    }
  ],`}
  "finalCutProSteps": ["string"],
  "productionSteps": ["string"],
  "editingTimeline": ["string"],
  "assetsChecklist": ["string"],
  "qaChecklist": ["string"]
}`;

  const result = await model.generateContent(prompt);
  const parsed = parseJsonFromModel(result.response.text());
  const row = isRecord(parsed) ? parsed : {};
  const deliverableSpecRow = isRecord(row.deliverableSpec) ? row.deliverableSpec : {};
  const scriptRow = isRecord(row.script) ? row.script : {};
  const socialCaptionRow = isRecord(row.socialCaption) ? row.socialCaption : {};
  const maxBeats =
    typeof sourceDurationSeconds === "number" && Number.isFinite(sourceDurationSeconds)
      ? clamp(Math.round(sourceDurationSeconds / 3), minBeatCount, 64)
      : Math.max(minBeatCount, 20);

  const beatsRaw: PlanBeat[] = sanitizePlanBeats(scriptRow.beats, maxBeats);

  const promptsRaw = Array.isArray(row.higgsfieldPrompts) ? row.higgsfieldPrompts : [];
  const parsedGlobalPrompts = sanitizeMultiShotPrompts(promptsRaw, 24);

  const ugcLockedPrompts =
    format.formatType === "ugc" && ugcCharacter
      ? parsedGlobalPrompts.map((item) => ({
        ...item,
        prompt: promptNeedsCharacterLock(item.prompt, item.generationType)
          ? enforceKlingPromptWordLimit(
            ensureHiggsfieldPromptHasPerformanceInstruction(
              applyUgcCharacterLock(item.prompt, ugcCharacter)
            ),
            77
          )
          : item.prompt,
      }))
      : parsedGlobalPrompts;

  const finalCutProSteps = sanitizeStringArray(row.finalCutProSteps, 20);

  const mentionState = { count: 0 };
  const integrationModeRaw = sanitizeString(row.integrationMode, "standard_adaptation");
  const integrationMode: "standard_adaptation" | "public_figure_overlay_only" =
    integrationModeRaw === "public_figure_overlay_only"
      ? "public_figure_overlay_only"
      : "standard_adaptation";
  const adjustedHook = limitAppNameMentions(
    sanitizeString(scriptRow.hook, "Start with a direct pain-point hook in first 2 seconds."),
    appName,
    mentionState
  );

  const beats = normalizeBeatsToTargetDuration({
    beats: beatsRaw,
    targetDurationSeconds,
    minBeatCount,
    hook: adjustedHook,
  });

  const adjustedBeats = beats.map((beat): PlanBeat => ({
    ...beat,
    narration: limitAppNameMentions(beat.narration, appName, mentionState),
    onScreenText: limitAppNameMentions(beat.onScreenText, appName, mentionState),
    editNote: beat.editNote,
  }));
  const adjustedCta = limitAppNameMentions(
    sanitizeString(scriptRow.cta, "Save this and try the routine today; use your tracker to stay consistent."),
    appName,
    mentionState
  );

  const adjustedBeatsForMode =
    integrationMode === "public_figure_overlay_only"
      ? adjustedBeats.map((beat) => ({
        ...beat,
        narration:
          sanitizeString(beat.narration, "").length > 0 && /original|keep|source audio|use source/i.test(beat.narration)
            ? beat.narration
            : "Keep original source speech/audio for this beat; no rewritten voice line.",
      }))
      : adjustedBeats;

  const sourceHasSparseAudio =
    cleanText(sourceVideo.transcriptText).length === 0 &&
    cleanText(sourceVideo.transcriptSummary).length === 0 &&
    !format.transcriptAvailable;

  const openingMechanicHint = [
    format.hookPatterns[0] || "",
    format.onScreenTextPatterns[0] || "",
    format.shotPattern[0] || "",
  ]
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, 3)
    .join(" | ");

  const sourceAlignedBeats = adjustedBeatsForMode.map((beat, index) => {
    if (!sourceHasSparseAudio) return beat;

    const beatNarration = cleanText(beat.narration);
    const beatOnScreenText = cleanText(beat.onScreenText);
    const fallbackText = index === 0 ? cleanText(adjustedHook) : beatNarration;

    return {
      ...beat,
      narration: "",
      onScreenText: beatOnScreenText || fallbackText,
    };
  });

  const sourceAlignedBeatsWithOpeningHint =
    openingMechanicHint && sourceAlignedBeats.length > 0
      ? sourceAlignedBeats.map((beat, index) => {
        if (index !== 0) return beat;
        const existingNote = cleanText(beat.editNote);
        if (/preserve source opening mechanic/i.test(existingNote)) return beat;
        return {
          ...beat,
          editNote: cleanText(
            `${existingNote}${existingNote ? " " : ""}Preserve source opening mechanic: ${openingMechanicHint}.`
          ),
        };
      })
      : sourceAlignedBeats;

  const fallbackCaption = [
    adjustedHook,
    sourceAlignedBeatsWithOpeningHint[0]?.onScreenText || sourceAlignedBeatsWithOpeningHint[0]?.narration || "",
    adjustedCta,
  ]
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join(" ");
  const socialCaption = sanitizeString(
    socialCaptionRow.caption,
    fallbackCaption || "Save this flow and try it today for a calmer, more consistent routine."
  );
  const socialHashtags = sanitizeHashtagArray(socialCaptionRow.hashtags, 8);

  const motionControlSegmentsRaw = Array.isArray(row.motionControlSegments) ? row.motionControlSegments : [];
  const modelShotGroups: MotionControlSegment[] = motionControlSegmentsRaw
    .map((seg, index): MotionControlSegment | null => {
      if (!isRecord(seg)) return null;

      const segmentScriptRow = isRecord(seg.script) ? seg.script : {};
      const segmentShots = sanitizeSegmentScriptShots(
        isRecord(segmentScriptRow) && Array.isArray(segmentScriptRow.shots)
          ? segmentScriptRow.shots
          : segmentScriptRow.beats,
        Math.max(1, Math.ceil(maxBeats / 2))
      );
      const segmentScript =
        cleanText(sanitizeString(segmentScriptRow.hook, "")).length > 0 ||
          segmentShots.length > 0 ||
          cleanText(sanitizeString(segmentScriptRow.cta, "")).length > 0
          ? {
            hook: sanitizeString(segmentScriptRow.hook, ""),
            shots: segmentShots,
            cta: closeOpenEndedLine(sanitizeString(segmentScriptRow.cta, "")),
          }
          : undefined;
      const segmentPrompts = sanitizeMultiShotPrompts(seg.multiShotPrompts, 8);
      const segmentVeoPrompt = sanitizeString(seg.veoPrompt, "");

      return {
        segmentId: typeof seg.segmentId === "number" ? seg.segmentId : index + 1,
        timecode: sanitizeString(
          seg.timecode,
          `${formatClock(index * MAX_SINGLE_VIDEO_CLIP_SECONDS)}-${formatClock((index + 1) * MAX_SINGLE_VIDEO_CLIP_SECONDS)}`
        ),
        durationSeconds: clamp(
          Math.round(sanitizeNumber(seg.durationSeconds, MAX_SINGLE_VIDEO_CLIP_SECONDS)),
          1,
          MAX_SINGLE_VIDEO_CLIP_SECONDS
        ),
        startFramePrompt: sanitizeString(seg.startFramePrompt, ""),
        ...(segmentScript ? { script: segmentScript } : {}),
        ...(segmentVeoPrompt ? { veoPrompt: segmentVeoPrompt } : {}),
        ...(segmentPrompts.length > 0 ? { multiShotPrompts: segmentPrompts } : {}),
      };
    })
    .filter((seg): seg is MotionControlSegment => seg !== null);

  const fallbackShotGroups = shouldGenerateShotGroups
    ? splitBeatsIntoShotGroups({
      beats: sourceAlignedBeatsWithOpeningHint,
      totalDurationSeconds: targetDurationSeconds,
      maxSegmentSeconds: MAX_SINGLE_VIDEO_CLIP_SECONDS,
      hook: adjustedHook,
      cta: adjustedCta,
    })
    : [];

  const resolvedBaseGroups = modelShotGroups.length > 0 ? modelShotGroups : fallbackShotGroups;
  const globalPromptChunkSize = Math.max(1, Math.ceil(ugcLockedPrompts.length / Math.max(1, resolvedBaseGroups.length)));

  const shotGroups = resolvedBaseGroups.map((segment, index) => {
    const fallbackSegment = fallbackShotGroups[index];
    const fallbackScript = fallbackSegment?.script;
    const nextScript = segment.script || fallbackScript;
    const inheritedGlobalPrompts = ugcLockedPrompts.slice(
      index * globalPromptChunkSize,
      (index + 1) * globalPromptChunkSize
    );
    const basePrompts = segment.multiShotPrompts && segment.multiShotPrompts.length > 0
      ? segment.multiShotPrompts
      : inheritedGlobalPrompts;
    const fallbackSegmentPrompts = buildFallbackMultiShotPrompts(
      {
        ...segment,
        script: nextScript,
      },
      index
    );
    const mergedPrompts = (basePrompts.length > 0 ? basePrompts : fallbackSegmentPrompts).map((prompt, promptIndex) => ({
      ...prompt,
      shotId: `group${segment.segmentId}_shot${promptIndex + 1}`,
      prompt: promptNeedsCharacterLock(prompt.prompt, prompt.generationType) && format.formatType === "ugc" && ugcCharacter
        ? enforceKlingPromptWordLimit(
          ensureHiggsfieldPromptHasPerformanceInstruction(
            applyUgcCharacterLock(prompt.prompt, ugcCharacter)
          ),
          77
        )
        : prompt.prompt,
    }));

    return {
      ...segment,
      startFramePrompt:
        cleanText(segment.startFramePrompt).length > 0
          ? segment.startFramePrompt
          : cleanText(fallbackSegment?.startFramePrompt) || `Opening frame for segment ${segment.segmentId}.`,
      durationSeconds: clamp(segment.durationSeconds, 1, MAX_SINGLE_VIDEO_CLIP_SECONDS),
      script: nextScript
        ? {
          hook: closeOpenEndedLine(sanitizeString(nextScript.hook, "")),
          shots: sanitizeSegmentScriptShots(nextScript.shots, Math.max(1, Math.ceil(maxBeats / 2))),
          cta: closeOpenEndedLine(sanitizeString(nextScript.cta, "")),
        }
        : undefined,
      multiShotPrompts: mergedPrompts,
    };
  });
  const transitionReadyShotGroups = enforceSegmentBoundaryTransitions(shotGroups);
  const styleHint =
    format.formatType === "ugc"
      ? "ugc creator-style live-action"
      : format.formatType === "ai_video"
        ? "live-action style ai video"
        : "social-first live-action style";
  const veoReadyShotGroups = transitionReadyShotGroups.map((segment, index, all) => ({
    ...segment,
    veoPrompt: ensureVeoPromptQuality(
      segment.veoPrompt || "",
      buildVeo31SegmentPrompt({
        segment,
        nextSegment: all[index + 1],
        styleHint,
        appName,
        ugcCharacter,
      }),
      styleHint
    ),
  }));

  return {
    title: sanitizeString(row.title, `${appName} format recreation plan`),
    contentClassification,
    maxSingleClipDurationSeconds: MAX_SINGLE_VIDEO_CLIP_SECONDS,
    useMotionControl: shouldGenerateShotGroups,
    motionControlSegments:
      shouldGenerateShotGroups && veoReadyShotGroups.length > 0
        ? veoReadyShotGroups
        : undefined,
    strategy: (() => {
      const normalized = sanitizeString(row.strategy, "");
      return normalized || "Reuse the selected format skeleton as value-first content, maintain native source pacing, and add subtle app integration where naturally relevant.";
    })(),
    objective: (() => {
      const normalized = sanitizeString(row.objective, "");
      return normalized || "Deliver practical guidance with authentic retention flow and optional low-friction app visibility.";
    })(),
    integrationMode,
    publicFigureNotes: sanitizeString(
      row.publicFigureNotes,
      integrationMode === "public_figure_overlay_only"
        ? "Detected public-figure style source. Preserve original speech and use overlay-only app integration."
        : "No strict public-figure preservation constraints detected."
    ),
    overlayOpportunities: sanitizeStringArray(row.overlayOpportunities, 8),
    deliverableSpec: {
      duration: sanitizeString(
        deliverableSpecRow.duration,
        sourceMatchedDurationFallback(sourceDurationSeconds)
      ),
      aspectRatio: sanitizeString(deliverableSpecRow.aspectRatio, "9:16"),
      platforms: sanitizeStringArray(deliverableSpecRow.platforms, 4),
      voiceStyle: sanitizeString(deliverableSpecRow.voiceStyle, "Warm, direct, practical"),
    },
    script: {
      hook: adjustedHook,
      beats: sourceAlignedBeatsWithOpeningHint,
      cta: adjustedCta,
    },
    socialCaption: {
      caption: socialCaption,
      hashtags:
        socialHashtags.length > 0
          ? socialHashtags
          : ["#MuslimahLifestyle", "#FaithBasedHabits", "#ProductiveRoutine"],
    },
    higgsfieldPrompts: veoReadyShotGroups.flatMap((segment) => segment.multiShotPrompts || []).slice(0, 24),
    finalCutProSteps:
      finalCutProSteps.length > 0
        ? finalCutProSteps
        : buildFinalCutProFallbackSteps(sourceDurationSeconds),
    productionSteps: sanitizeStringArray(row.productionSteps, 12),
    editingTimeline: sanitizeStringArray(row.editingTimeline, 12),
    assetsChecklist: sanitizeStringArray(row.assetsChecklist, 12),
    qaChecklist: sanitizeStringArray(row.qaChecklist, 12),
  };
}

interface BuildVideoScriptIdeationArgs {
  appName: string;
  appContext: string;
  topicBrief: string;
  targetDurationSeconds?: number;
  preferredVideoType?: ScriptAgentVideoType | "auto";
  campaignMode?: ScriptAgentCampaignMode;
  ugcCharacter?: UGCCharacterProfile | null;
  reasoningModel?: ReasoningModel;
}

export async function buildVideoScriptIdeationPlan({
  appName,
  appContext,
  topicBrief,
  targetDurationSeconds = 75,
  preferredVideoType = "auto",
  campaignMode = "standard",
  ugcCharacter,
  reasoningModel = DEFAULT_REASONING_MODEL,
}: BuildVideoScriptIdeationArgs): Promise<VideoScriptIdeationPlan> {
  requireGeminiKey();
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const safeDurationSeconds = clamp(Math.round(targetDurationSeconds), 30, 180);
  const minBeatCount = Math.max(8, Math.ceil(safeDurationSeconds / 4));
  const resolvedCampaignMode = sanitizeScriptAgentCampaignMode(campaignMode);
  const forcedVideoType: ScriptAgentVideoType | null =
    resolvedCampaignMode === "widget_reaction_ugc" ? "ugc" : null;
  const preferredVideoTypeForPrompt = forcedVideoType || preferredVideoType;

  const campaignRulesBlock = resolvedCampaignMode === "widget_reaction_ugc"
    ? `
CAMPAIGN MODE: widget_reaction_ugc
- Build reaction-driven UGC videos for Muslim women app widgets.
- Character should show genuine surprise-to-happy reaction.
- Focus on text overlays about app features, lock-screen widgets, and home-screen widgets.
- Include overlay themes like:
  * "I did not know an app like this existed."
  * "I just found the perfect widget for tracking cycles."
  * "Always confused about whether prayer is permissible in each phase?"
- Ensure script clearly communicates: widget shows current cycle phase plus worship status (prayer, fasting, Quran: permissible or paused).
- Reserve final handoff for external full-screen app screen recording after generated segment (recording added in edit).
- Keep this mode strictly UGC (not animation).
`
    : "";

  const prompt = `You are a senior short-form video script strategist.

TASK:
Generate an original informational video script plan WITHOUT using any source video.

APP CONTEXT:
- App Name: ${appName}
- App Context: ${appContext || "Period/pregnancy tracking app for Muslim women with worship support."}

USER INPUT:
- Topic brief: ${topicBrief}
- Preferred video type: ${preferredVideoTypeForPrompt}
- Target duration seconds: ${safeDurationSeconds}
${campaignRulesBlock}

AVAILABLE VIDEO TYPES:
- ugc (creator/talking-head style)
- ai_animation (animated explainers)
- faceless_broll (voiceover + visual metaphors)
- hybrid (mix of talking-head and motion graphics)

TOPIC CATEGORY OPTIONS:
- period_pregnancy
- islamic_period_pregnancy

RULES:
- Choose exactly one topic category and one video type.
- Keep tone educational, compassionate, practical, and non-judgmental.
- App hook must be natural and useful (not ad-like), ideally as one practical proof/help beat.
- Mention app name at most once in full script.
- Duration must closely match target.
- Use enough beats to fill full duration (minimum ${minBeatCount} beats).
- Beat timecodes should span almost full duration.
- Split into shot groups of max ${MAX_SINGLE_VIDEO_CLIP_SECONDS}s each.
- Each shot group must include startFramePrompt, segment script (hook/shots/cta), and multiShotPrompts.
- Each shot group must include startFramePrompt, segment script (hook/shots/cta), and one copy-paste-ready veoPrompt for Veo 3.1.
- Segment scripts must be self-contained per group with no unfinished sentence that continues into the next segment.
- Use shotId ordering inside each segment (shot1, shot2, ...), no per-shot timing.
- Last shot in each segment should transition smoothly into next segment opening for clean final merge.
- Veo prompt must be a single detailed prompt with explicit shot-wise structure (Shot 1: ..., Shot 2: ...).
- Veo prompt style directives by video type:
  - ugc/hybrid/faceless_broll: photoreal live-action realism (natural skin detail, plausible lighting, no uncanny artifacts).
  - ai_animation: stylized CGI animation look (clean shading, stable topology/deformation, smooth motion), explicitly not photoreal live-action skin realism.

MULTI-SHOT PROMPT RULES:
- Each prompt must be <= 77 words.
- Each prompt must contain either:
  - Dialogue: "..." (if spoken), OR
  - No dialogue: ... (if non-speaking).
- Use generationType from: base_ai_video | ugc_video | ai_broll | product_ui_overlay | transition_fx.
- If phone/app UI is shown, require pure chroma green phone screen (#00FF00), no baked UI.

${ugcCharacter ? `UGC CHARACTER LOCK:
- characterName: ${ugcCharacter.characterName}
- personaSummary: ${ugcCharacter.personaSummary}
- visualStyle: ${ugcCharacter.visualStyle}
- wardrobeNotes: ${ugcCharacter.wardrobeNotes}
- voiceTone: ${ugcCharacter.voiceTone}
- promptTemplate: ${ugcCharacter.promptTemplate}
- If selectedVideoType is ugc or hybrid, maintain this identity across all segments.
` : ""}

Return strict JSON only:
{
  "title": "string",
  "objective": "string",
  "topicCategory": "period_pregnancy|islamic_period_pregnancy",
  "selectedVideoType": "ugc|ai_animation|faceless_broll|hybrid",
  "videoTypeReason": "string",
  "appHookStrategy": "string",
  "targetDurationSeconds": ${safeDurationSeconds},
  "script": {
    "hook": "string",
    "beats": [
      {
        "timecode": "0:00-0:04",
        "visual": "string",
        "narration": "string",
        "onScreenText": "string",
        "editNote": "string"
      }
    ],
    "cta": "string"
  },
  "motionControlSegments": [
    {
      "segmentId": 1,
      "timecode": "0:00-0:08",
      "durationSeconds": 8,
      "startFramePrompt": "string",
      "script": {
        "hook": "string",
        "shots": [
          {
            "shotId": "shot1",
            "visual": "string",
            "narration": "string",
            "onScreenText": "string",
            "editNote": "string"
          }
        ],
        "cta": "string"
      },
      "veoPrompt": "single detailed Veo 3.1 prompt with Shot 1 / Shot 2 / ...",
      "multiShotPrompts": [
        {
          "shotId": "shot1",
          "generationType": "base_ai_video|ugc_video|ai_broll|product_ui_overlay|transition_fx",
          "scene": "string",
          "prompt": "string with Dialogue: \"...\" OR No dialogue: ...",
          "shotDuration": "string"
        }
      ]
    }
  ],
  "socialCaption": {
    "caption": "string",
    "hashtags": ["string"]
  },
  "productionSteps": ["string"],
  "qaChecklist": ["string"]
}`;

  const result = await model.generateContent(prompt);
  const parsed = parseJsonFromModel(result.response.text());
  const row = isRecord(parsed) ? parsed : {};
  const scriptRow = isRecord(row.script) ? row.script : {};

  const mentionState = { count: 0 };
  const hook = limitAppNameMentions(
    sanitizeString(scriptRow.hook, `A practical myth-busting hook about ${topicBrief}.`),
    appName,
    mentionState
  );
  const rawBeats = sanitizePlanBeats(scriptRow.beats, 64);
  const normalizedBeats = normalizeBeatsToTargetDuration({
    beats: rawBeats,
    targetDurationSeconds: safeDurationSeconds,
    minBeatCount,
    hook,
  });
  const beats = normalizedBeats.map((beat) => ({
    ...beat,
    narration: limitAppNameMentions(beat.narration, appName, mentionState),
    onScreenText: limitAppNameMentions(beat.onScreenText, appName, mentionState),
  }));
  const cta = limitAppNameMentions(
    sanitizeString(scriptRow.cta, "Save this for later and share with someone who needs it."),
    appName,
    mentionState
  );

  const modelSegmentsRaw = Array.isArray(row.motionControlSegments) ? row.motionControlSegments : [];
  const modelSegments: MotionControlSegment[] = modelSegmentsRaw
    .map((seg, index): MotionControlSegment | null => {
      if (!isRecord(seg)) return null;
      const segmentScriptRow = isRecord(seg.script) ? seg.script : {};

      return {
        segmentId: typeof seg.segmentId === "number" ? seg.segmentId : index + 1,
        timecode: sanitizeString(
          seg.timecode,
          `${formatClock(index * MAX_SINGLE_VIDEO_CLIP_SECONDS)}-${formatClock((index + 1) * MAX_SINGLE_VIDEO_CLIP_SECONDS)}`
        ),
        durationSeconds: clamp(
          Math.round(sanitizeNumber(seg.durationSeconds, MAX_SINGLE_VIDEO_CLIP_SECONDS)),
          1,
          MAX_SINGLE_VIDEO_CLIP_SECONDS
        ),
        startFramePrompt: sanitizeString(seg.startFramePrompt, ""),
        script: {
          hook: closeOpenEndedLine(sanitizeString(segmentScriptRow.hook, "")),
          shots: sanitizeSegmentScriptShots(
            Array.isArray(segmentScriptRow.shots) ? segmentScriptRow.shots : segmentScriptRow.beats,
            Math.max(1, Math.ceil(minBeatCount / 2))
          ),
          cta: closeOpenEndedLine(sanitizeString(segmentScriptRow.cta, "")),
        },
        veoPrompt: sanitizeString(seg.veoPrompt, ""),
        multiShotPrompts: sanitizeMultiShotPrompts(seg.multiShotPrompts, 8),
      };
    })
    .filter((seg): seg is MotionControlSegment => seg !== null);

  const fallbackSegments = splitBeatsIntoShotGroups({
    beats,
    totalDurationSeconds: safeDurationSeconds,
    maxSegmentSeconds: MAX_SINGLE_VIDEO_CLIP_SECONDS,
    hook,
    cta,
  });

  const selectedVideoType = sanitizeScriptAgentVideoType(row.selectedVideoType);
  const segmentSource = modelSegments.length > 0 ? modelSegments : fallbackSegments;
  const resolvedVideoType =
    forcedVideoType ||
    (preferredVideoType && preferredVideoType !== "auto"
      ? preferredVideoType
      : selectedVideoType);

  const resolvedSegments = segmentSource.map((segment, index) => {
    const fallbackSegment = fallbackSegments[index];
    const nextScript = segment.script || fallbackSegment?.script;
    const basePrompts = segment.multiShotPrompts && segment.multiShotPrompts.length > 0
      ? segment.multiShotPrompts
      : [];
    const fallbackPrompts = buildFallbackMultiShotPrompts(
      {
        ...segment,
        script: nextScript,
      },
      index
    );
    const prompts = (basePrompts.length > 0 ? basePrompts : fallbackPrompts)
      .slice(0, 8)
      .map((promptItem, promptIndex) => {
        const normalizedType =
          resolvedVideoType === "ugc"
            ? promptItem.generationType === "ugc_video" ? promptItem.generationType : "ugc_video"
            : resolvedVideoType === "ai_animation"
              ? promptItem.generationType === "transition_fx" ? "transition_fx" : "base_ai_video"
              : resolvedVideoType === "faceless_broll"
                ? promptItem.generationType === "product_ui_overlay" ? "product_ui_overlay" : "ai_broll"
                : promptItem.generationType;

        const promptWithLock =
          ugcCharacter && (resolvedVideoType === "ugc" || resolvedVideoType === "hybrid")
            ? applyUgcCharacterLock(promptItem.prompt, ugcCharacter)
            : promptItem.prompt;

        return {
          ...promptItem,
          shotId: `group${segment.segmentId}_shot${promptIndex + 1}`,
          generationType: normalizedType,
          prompt: enforceKlingPromptWordLimit(
            ensureHiggsfieldPromptHasPerformanceInstruction(promptWithLock),
            77
          ),
        };
      });

    return {
      ...segment,
      timecode: sanitizeString(
        segment.timecode,
        `${formatClock(index * MAX_SINGLE_VIDEO_CLIP_SECONDS)}-${formatClock((index + 1) * MAX_SINGLE_VIDEO_CLIP_SECONDS)}`
      ),
      durationSeconds: clamp(segment.durationSeconds, 1, MAX_SINGLE_VIDEO_CLIP_SECONDS),
      startFramePrompt:
        cleanText(segment.startFramePrompt) ||
        cleanText(fallbackSegment?.startFramePrompt) ||
        `Opening frame for segment ${segment.segmentId}.`,
      script: {
        hook: closeOpenEndedLine(sanitizeString(nextScript?.hook, index === 0 ? hook : "")),
        shots: sanitizeSegmentScriptShots(nextScript?.shots, Math.max(1, Math.ceil(minBeatCount / 2))),
        cta: closeOpenEndedLine(sanitizeString(nextScript?.cta, index === segmentSource.length - 1 ? cta : "")),
      },
      multiShotPrompts: prompts,
    };
  });
  const transitionReadySegments = enforceSegmentBoundaryTransitions(resolvedSegments);
  const campaignAdjustedSegments =
    resolvedCampaignMode === "widget_reaction_ugc"
      ? enforceWidgetReactionSeriesPattern(transitionReadySegments, appName)
      : transitionReadySegments;
  const scriptAgentStyleHint =
    resolvedVideoType === "ugc"
      ? "ugc creator-style live-action"
      : resolvedVideoType === "ai_animation"
        ? "animated explainer with realistic motion and texture"
        : resolvedVideoType === "faceless_broll"
          ? "faceless b-roll educational live-action"
          : "hybrid social explainer";
  const veoReadySegments = campaignAdjustedSegments.map((segment, index, all) => ({
    ...segment,
    veoPrompt: ensureVeoPromptQuality(
      segment.veoPrompt || "",
      buildVeo31SegmentPrompt({
        segment,
        nextSegment: all[index + 1],
        styleHint: scriptAgentStyleHint,
        appName,
        ugcCharacter,
      }),
      scriptAgentStyleHint
    ),
  }));

  return {
    title: sanitizeString(row.title, `${appName} informational video plan`),
    objective: sanitizeString(
      row.objective,
      "Deliver practical, trustworthy education with a native app-support hook."
    ),
    campaignMode: resolvedCampaignMode,
    topicCategory: sanitizeScriptAgentTopicCategory(row.topicCategory),
    selectedVideoType: resolvedVideoType,
    videoTypeReason: sanitizeString(
      row.videoTypeReason,
      "Selected to maximize clarity, retention, and execution speed for this topic."
    ),
    appHookStrategy: sanitizeString(
      row.appHookStrategy,
      "Introduce app support in one practical moment tied to the audience pain point."
    ),
    targetDurationSeconds: safeDurationSeconds,
    maxSingleClipDurationSeconds: MAX_SINGLE_VIDEO_CLIP_SECONDS,
    script: {
      hook,
      beats,
      cta,
    },
    motionControlSegments: veoReadySegments,
    socialCaption: {
      caption: sanitizeString(
        isRecord(row.socialCaption) ? row.socialCaption.caption : "",
        "Save this guide and share it with someone who needs gentle, practical support."
      ),
      hashtags: sanitizeHashtagArray(
        isRecord(row.socialCaption) ? row.socialCaption.hashtags : [],
        8
      ).length
        ? sanitizeHashtagArray(isRecord(row.socialCaption) ? row.socialCaption.hashtags : [], 8)
        : ["#PeriodHealth", "#PregnancyCare", "#MuslimahWellness", "#WorshipSupport"],
    },
    productionSteps: sanitizeStringArray(row.productionSteps, 12),
    qaChecklist: sanitizeStringArray(row.qaChecklist, 12),
  };
}
