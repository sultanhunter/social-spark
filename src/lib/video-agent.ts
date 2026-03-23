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
const FRAME_SAMPLE_TARGET = 6;
const MAX_SINGLE_VIDEO_CLIP_SECONDS = 15;

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
    beats: PlanBeat[];
    cta: string;
  };
  multiShotPrompts?: MultiShotPrompt[];
  startFrame?: VideoStartFrame;
}

export interface VideoRecreationPlan {
  title: string;
  strategy: string;
  objective: string;
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
        beats: segmentBeats,
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
  const beats = segment.script?.beats || [];
  const source = beats.length > 0 ? beats : [
    {
      timecode: segment.timecode,
      visual: segment.startFramePrompt,
      narration: segment.script?.hook || "",
      onScreenText: "",
      editNote: "",
    },
  ];

  const prompts = source.slice(0, 6).map((beat, beatIndex): MultiShotPrompt => {
    const range = parseTimecodeRange(beat.timecode);
    const duration = range ? Math.max(1, range.end - range.start) : Math.max(2, Math.round(segment.durationSeconds / Math.max(1, source.length)));
    const scene = cleanText(beat.visual) || `Segment ${segment.segmentId} scene ${beatIndex + 1}`;
    const prompt = cleanText(
      [
        scene,
        beat.narration ? `Narration intent: ${beat.narration}.` : "",
        beat.onScreenText ? `On-screen text direction: ${beat.onScreenText}.` : "",
        "Vertical 9:16, cinematic but natural realism, smooth temporal continuity, clean transitions, no visual artifacts.",
      ].join(" ")
    );

    return {
      shotId: `group${segmentIndex + 1}_shot${beatIndex + 1}`,
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
    frameCount: FRAME_SAMPLE_TARGET,
    frameWidth: 960,
    includeTranscript: true,
    transcriptMaxSeconds: 90,
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
}

export async function buildVideoRecreationPlan({
  appName,
  appContext,
  sourceVideo,
  format,
  ugcCharacter,
  reasoningModel = DEFAULT_REASONING_MODEL,
  useMotionControl = false,
}: BuildRecreationPlanArgs): Promise<VideoRecreationPlan> {
  requireGeminiKey();
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const sourceDurationSeconds =
    typeof sourceVideo.sourceDurationSeconds === "number" && Number.isFinite(sourceVideo.sourceDurationSeconds)
      ? sourceVideo.sourceDurationSeconds
      : typeof format.sourceDurationSeconds === "number" && Number.isFinite(format.sourceDurationSeconds)
        ? format.sourceDurationSeconds
        : null;

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
- For each segment, provide segment-level script (hook/beats/cta) that covers only that segment's time window.
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
      "timecode": "0:00-0:15",
      "durationSeconds": 15,
      "startFramePrompt": "string",
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
      const segmentBeats = sanitizePlanBeats(segmentScriptRow.beats, Math.max(1, Math.ceil(maxBeats / 2))).map((beat) => ({
        ...beat,
        narration: beat.narration,
        onScreenText: beat.onScreenText,
        editNote: beat.editNote,
      }));
      const segmentScript =
        cleanText(sanitizeString(segmentScriptRow.hook, "")).length > 0 ||
          segmentBeats.length > 0 ||
          cleanText(sanitizeString(segmentScriptRow.cta, "")).length > 0
          ? {
            hook: sanitizeString(segmentScriptRow.hook, ""),
            beats: segmentBeats,
            cta: sanitizeString(segmentScriptRow.cta, ""),
          }
          : undefined;
      const segmentPrompts = sanitizeMultiShotPrompts(seg.multiShotPrompts, 8);

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
          hook: sanitizeString(nextScript.hook, ""),
          beats: sanitizePlanBeats(nextScript.beats, Math.max(1, Math.ceil(maxBeats / 2))).map((beat) => ({
            ...beat,
            narration: beat.narration,
            onScreenText: beat.onScreenText,
            editNote: beat.editNote,
          })),
          cta: sanitizeString(nextScript.cta, ""),
        }
        : undefined,
      multiShotPrompts: mergedPrompts,
    };
  });

  return {
    title: sanitizeString(row.title, `${appName} format recreation plan`),
    contentClassification,
    maxSingleClipDurationSeconds: MAX_SINGLE_VIDEO_CLIP_SECONDS,
    useMotionControl: shouldGenerateShotGroups,
    motionControlSegments:
      shouldGenerateShotGroups && shotGroups.length > 0
        ? shotGroups
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
    higgsfieldPrompts: shotGroups.flatMap((segment) => segment.multiShotPrompts || []).slice(0, 24),
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
