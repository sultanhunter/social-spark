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

type HiggsfieldPrompt = {
  shotId: string;
  generationType: "base_ai_video" | "ugc_video" | "ai_broll" | "product_ui_overlay" | "transition_fx";
  scene: string;
  prompt: string;
  recommendedModel: string;
  modelReason: string;
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
  startFrame?: VideoStartFrame;
}

export interface VideoRecreationPlan {
  title: string;
  strategy: string;
  objective: string;
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
  seedanceSinglePrompt: {
    model: string;
    prompt: string;
    targetDuration: string;
  };
  higgsfieldPrompts: HiggsfieldPrompt[];
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

function enforceFaithPositiveFraming(text: string): string {
  let output = cleanText(text);
  if (!output) return output;

  const replacements: Array<[RegExp, string]> = [
    [/\b(can(?:'|’)t|cannot|unable to|not able to)\s+(pray|make salah|pray on time)\b/gi, "able to pray consistently"],
    [/\b(skip(?:ping)?|miss(?:ing)?)\s+(prayer|salah)\b/gi, "maintain prayer consistency"],
    [/\bno prayer\b/gi, "consistent prayer"],
    [/\bwithout prayer\b/gi, "with prayer consistency"],
    [/\b(celebrate|love|enjoy)\s+(not praying|skipping prayer|missing salah)\b/gi, "celebrate being able to pray and stay spiritually grounded"],
  ];

  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }

  return output;
}

function enforcePrayerStruggleTone(text: string): string {
  let output = cleanText(text);
  if (!output) return output;

  const hasPrayerStruggleSignal =
    /\b(can(?:'|’)t|cannot|unable to|not able to|struggling to|miss(?:ed|ing)?|skip(?:ped|ping)?)\s+(pray|make salah|prayer|salah)\b/i.test(
      output
    ) || /\b(not praying|missing salah|skipping prayer)\b/i.test(output);

  if (!hasPrayerStruggleSignal) return output;

  const emotionalReplacements: Array<[RegExp, string]> = [
    [/\blooks\s+relieved\b/gi, "looks concerned"],
    [/\bfeel(?:s)?\s+relieved\b/gi, "feels concerned"],
    [/\brelieved\b/gi, "concerned"],
    [/\bhappy\b/gi, "concerned"],
    [/\bexcited\b/gi, "concerned"],
    [/\bjoyful\b/gi, "reflective"],
    [/\bcelebrat(?:e|es|ing|ed)\b/gi, "seeks improvement"],
  ];

  for (const [pattern, replacement] of emotionalReplacements) {
    output = output.replace(pattern, replacement);
  }

  return cleanText(output);
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

function sanitizeHiggsfieldGenerationType(value: unknown): HiggsfieldPrompt["generationType"] {
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
    "Import all generated Kling MultiShot clips, app screen recordings, source overlays, SFX, and music into organized keyword collections.",
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

function ensureSeedanceQualityDirectives(prompt: string): string {
  const cleaned = cleanText(prompt);
  if (!cleaned) return cleaned;

  const needsArtifactsDirective = !/no\s+ai\s+artifacts/i.test(cleaned);
  const needsCutsDirective = !/no\s+(hard\s+)?cuts?/i.test(cleaned);
  const needsFlickerDirective = !/no\s+flicker/i.test(cleaned);

  const directives: string[] = [];
  if (needsArtifactsDirective) directives.push("No AI artifacts");
  if (needsCutsDirective) directives.push("no hard cuts");
  if (needsFlickerDirective) directives.push("no flicker");

  if (directives.length === 0) return cleaned;
  return `${cleaned}. ${directives.join(", ")}, maintain temporal consistency and natural motion continuity.`;
}

function needsAppScreenReplacementCue(
  generationType: HiggsfieldPrompt["generationType"],
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

function buildSeedanceFallbackPrompt(args: {
  appName: string;
  format: VideoFormatAnalysis;
  sourceVideo: BuildRecreationPlanArgs["sourceVideo"];
  hook: string;
  beats: PlanBeat[];
  ugcCharacter?: UGCCharacterProfile | null;
  targetDuration: string;
}): string {
  const { appName, format, sourceVideo, hook, beats, ugcCharacter, targetDuration } = args;
  const beatSummary = beats
    .slice(0, 5)
    .map((beat, index) => `Beat ${index + 1}: ${cleanText(beat.visual || beat.narration || "")}`)
    .filter(Boolean)
    .join(" | ");

  const characterLine =
    format.formatType === "ugc" && ugcCharacter
      ? `Character lock: ${ugcCharacter.characterName}, consistent identity, modest styling, natural expression.`
      : "No mandatory recurring character lock unless script requires a person.";

  return ensureSeedanceQualityDirectives(
    [
      `Seedance 1.5 Pro single-video prompt for a ${targetDuration} vertical 9:16 short.`,
      `Concept: ${hook || format.summary || sourceVideo.title || "Value-first lifestyle guidance"}.`,
      `Tone: realistic, cinematic UGC pacing, faith-aware and respectful for Muslim women audience.`,
      `Structure: ${beatSummary || "Clear hook, practical middle section, soft CTA ending"}.`,
      `Context: ${sourceVideo.description || sourceVideo.userNotes || "N/A"}.`,
      characterLine,
      `Subtle app integration for ${appName} only where naturally relevant.`,
      `Any visible phone/app showcase moment must use a pure chroma green screen (#00FF00) for post screen replacement; no baked UI.`,
      `During any phone/app showcase moment, camera must stay static and locked off (tripod look): no pan, tilt, zoom, dolly, or handheld movement.`,
      `Natural camera motion, coherent lighting continuity, realistic skin/fabric textures, smooth scene transitions.`,
      `No logos/watermarks, no visual glitches, no jumpy frame interpolation, no abrupt transitions.`,
    ].join(" ")
  );
}

function toCharacterLockToken(characterName: string): string {
  const cleaned = characterName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return cleaned || "character";
}

function promptNeedsCharacterLock(prompt: string, generationType: HiggsfieldPrompt["generationType"]): boolean {
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

  const prompt = `You are a senior short-form video strategist.

Goal:
Create a full recreation plan for the app below using this selected source format.

APP:
- Name: ${appName}
- Context: ${appContext || "N/A"}

TOOLS AVAILABLE:
- Kling MultiShot for AI video generation (shot-based workflow)
- Professional video editing tools

CREATOR CONSTRAINT:
- Assume there are no real human creators available for collaboration.
- If this format requires on-camera human presence (UGC, testimonial, talking-head, lifestyle human actions), you must use AI influencer shots generated in Higgsfield.
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
- Source Duration: ${sourceDurationHint(sourceVideo.sourceDurationSeconds)}

RESPONSE RULES:
- Build for Muslim women audience and keep tone faith-aware, practical, and respectful.
- Keep output execution-ready, not high-level fluff.
- Match the source video length by default (target within +/-10% of source duration when source duration is available).
- Use enough timing beats to cover the full source-matched duration (not compressed short-form unless source itself is short).
- Include Kling MultiShot prompts that can be copied directly.
- Never celebrate anti-religious behavior. Do not frame skipping prayer, neglecting salah, or distancing from worship as a positive outcome.
- Prefer positive faith framing: celebrate being able to pray, spiritual consistency, barakah-oriented routines, and practical habits that support worship.
- If mentioning difficult phases, keep compassionate tone and guide toward faith-positive actions and recovery, not disengagement.
- If the narrative includes being unable to pray, missing salah, or spiritual inconsistency, depict it as concern/struggle/recovery — never as relief, celebration, or comedic victory.
- Keep this value-first, not ad-first. The video should feel like native educational/lifestyle content.
- Do NOT force app mention in every script. Mention the app only when naturally relevant.
- If app insertion is useful, prefer subtle visual integration (screen recording/screenshot overlay, UI callout, or quick proof moment) instead of hard-selling narration.
- Keep explicit app name mentions to a maximum of 1 in the entire script (hook + beats + CTA).
- CTA must be soft and non-salesy (example style: save/share/follow/use this method), with optional subtle app reference only if it fits context.
- For any app overlay moment, specify placement and intent in editNote (for example: "top-right mini overlay of cycle day screen for 2s").
- Reuse the source transcript style (cadence, phrasing, emotional tone) when drafting narration so output feels native to the original format.
- Preserve the source opening mechanic in the first 1-2 beats (for example reaction face + hook text + reveal order) instead of converting to generic ad structure.
- If source has little/no spoken audio, keep the adaptation text-led and visual-led: prioritize hook text + reactions + app screen flow, avoid forcing voiceover-heavy scripting.
- When transcript is sparse, rely heavily on hookPatterns, shotPattern, onScreenTextPatterns, visualSignals, and user notes from SELECTED FORMAT.
- Include a socialCaption block with a platform-ready post caption and 3-8 relevant hashtags.
- If human presence is needed, include execution-ready Kling MultiShot prompts for AI influencer scenes and include persona continuity instructions.
- Production steps must explicitly describe how to generate and stitch Kling shots with app overlays.
- Add a dedicated finalCutProSteps list with explicit, ordered Final Cut Pro execution steps from project setup to export.
- Also provide one single consolidated Seedance 1.5 Pro prompt for full-video generation (seedanceSinglePrompt).
- Seedance prompt must be optimized for Seedance 1.5 Pro with smooth temporal continuity and explicit anti-artifact directives (no AI artifacts, no flicker, no hard cuts, no broken anatomy).
- Every Kling shot prompt must include performance instruction:
  - If character speaks on camera, include the exact spoken line in quotes and prefix with "Dialogue:".
  - If character does not speak, explicitly write "No dialogue" and describe facial/body expression intent.
- For every Kling shot, include a recommended Kling model and why it is the best fit for that shot.
- For every Kling shot, include individual shotDuration (for example: "3.5s" or "0:08").
- For every Kling shot, include generationType from: base_ai_video | ugc_video | ai_broll | product_ui_overlay | transition_fx.
- For every Kling shot, include shotId in strict sequence format: shot1, shot2, shot3, ...
- Each prompt field must be 77 words maximum (hard limit).
- Prompts are for video generation, not still photos. Do not use wording like "photo", "portrait photo", "still image", or "snapshot".
- For any app showcase / phone UI shot, force a keyable phone screen: pure chroma green (#00FF00), no UI/text baked in, minimal glare/reflections.
- For any app showcase / phone UI shot, enforce static camera only: locked-off/tripod framing, no pan/tilt/zoom/dolly/handheld movement.
- Ensure prompts are ready for shot-based generation and continuity in Kling MultiShot.
- Ensure Kling prompts cover required generation types for this concept (at minimum base_ai_video + ai_broll, and ugc_video whenever human talking-head presence is required).
- Keep the prompt field clean scene direction only. Do NOT include model, reason, or duration text inside prompt; use the dedicated fields.
- For ugc format, include a Character Lock continuity directive in each scene using the provided UGC character profile.
- If source content appears to include a famous public figure, public speech, or recognisable creator persona that should not be rewritten:
  - Set integrationMode to "public_figure_overlay_only".
  - Do NOT rewrite their core spoken lines or impersonate them.
  - Keep original speech/audio moments and only integrate app via subtle overlays/screenshots/screen recordings.
  - Avoid making it look like endorsement by that public figure.
${useMotionControl ? `
KLING MOTION CONTROL 3.0 CONSTRAINTS:
- You must generate motionControlSegments because Kling 3.0 has a strict 30-second duration limit.
- If the total video is longer than 30 seconds, split it into roughly equal logical segments (max 30s each).
- For each segment, provide a startFramePrompt describing the exact visual of the very first frame of that segment (including character identity, clothing, setting, and exact framing).
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
  "seedanceSinglePrompt": {
    "model": "Seedance 1.5 Pro",
    "prompt": "string",
    "targetDuration": "string"
  },
${useMotionControl ? `  "motionControlSegments": [
    {
      "segmentId": 1,
      "timecode": "0:00-0:30",
      "durationSeconds": 30,
      "startFramePrompt": "string"
    }
  ],` : ""}
  "higgsfieldPrompts": [
    {
      "shotId": "shot1",
      "generationType": "base_ai_video|ugc_video|ai_broll|product_ui_overlay|transition_fx",
      "scene": "string",
      "prompt": "string with Dialogue: \"...\" OR No dialogue: ...",
      "recommendedModel": "string",
      "modelReason": "string",
      "shotDuration": "string"
    }
  ],
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
  const seedanceRow = isRecord(row.seedanceSinglePrompt) ? row.seedanceSinglePrompt : {};
  const maxBeats =
    typeof sourceVideo.sourceDurationSeconds === "number" && Number.isFinite(sourceVideo.sourceDurationSeconds)
      ? clamp(Math.round(sourceVideo.sourceDurationSeconds / 4), 6, 24)
      : 12;

  const beatsRaw = Array.isArray(scriptRow.beats) ? scriptRow.beats : [];
  const beats: PlanBeat[] = beatsRaw
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

  const promptsRaw = Array.isArray(row.higgsfieldPrompts) ? row.higgsfieldPrompts : [];
  const higgsfieldPrompts: HiggsfieldPrompt[] = promptsRaw
    .map((item, index) => {
      if (!isRecord(item)) return null;
      const generationType = sanitizeHiggsfieldGenerationType(item.generationType);
      const scene = sanitizeString(item.scene, "Scene");
      const basePrompt = sanitizeString(
        item.prompt,
        "Create a vertical 9:16 AI influencer shot for Muslimah audience: modest outfit, natural expression, soft daylight, realistic movement, clean background, consistent character identity across scenes. No dialogue: character conveys reassurance through calm facial expression and gentle nod."
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
        recommendedModel: sanitizeString(
          item.recommendedModel,
          "Kling 1.6 Pro"
        ),
        modelReason: sanitizeString(
          item.modelReason,
          "Strong for cinematic realism, coherent motion, and shot-to-shot continuity in MultiShot workflows."
        ),
        shotDuration: sanitizeString(item.shotDuration, "4s"),
      };
    })
    .filter((item): item is HiggsfieldPrompt => Boolean(item))
    .slice(0, 8);

  const ugcLockedPrompts =
    format.formatType === "ugc" && ugcCharacter
      ? higgsfieldPrompts.map((item) => ({
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
      : higgsfieldPrompts;

  const faithAdjustedPrompts = ugcLockedPrompts.map((item) => ({
    ...item,
    prompt: enforceKlingPromptWordLimit(
      enforcePrayerStruggleTone(enforceFaithPositiveFraming(item.prompt)),
      77
    ),
  }));

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
  const adjustedBeats = beats.map((beat) => ({
    ...beat,
    narration: enforcePrayerStruggleTone(
      enforceFaithPositiveFraming(limitAppNameMentions(beat.narration, appName, mentionState))
    ),
    onScreenText: enforcePrayerStruggleTone(
      enforceFaithPositiveFraming(limitAppNameMentions(beat.onScreenText, appName, mentionState))
    ),
    editNote: enforcePrayerStruggleTone(enforceFaithPositiveFraming(beat.editNote)),
  }));
  const adjustedCta = limitAppNameMentions(
    sanitizeString(scriptRow.cta, "Save this and try the routine today; use your tracker to stay consistent."),
    appName,
    mentionState
  );

  const targetDurationForSeedance = sanitizeString(
    seedanceRow.targetDuration,
    sanitizeString(deliverableSpecRow.duration, sourceMatchedDurationFallback(sourceVideo.sourceDurationSeconds))
  );
  const seedancePrompt = ensureSeedanceQualityDirectives(
    sanitizeString(
      seedanceRow.prompt,
      buildSeedanceFallbackPrompt({
        appName,
        format,
        sourceVideo,
        hook: sanitizeString(scriptRow.hook, ""),
        beats,
        ugcCharacter,
        targetDuration: targetDurationForSeedance,
      })
    )
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
  const motionControlSegments: MotionControlSegment[] = motionControlSegmentsRaw
    .map((seg, index) => {
      if (!isRecord(seg)) return null;
      return {
        segmentId: typeof seg.segmentId === "number" ? seg.segmentId : index + 1,
        timecode: sanitizeString(seg.timecode, "0:00-0:30"),
        durationSeconds: sanitizeNumber(seg.durationSeconds, 30),
        startFramePrompt: enforcePrayerStruggleTone(
          enforceFaithPositiveFraming(sanitizeString(seg.startFramePrompt, ""))
        ),
      };
    })
    .filter((seg): seg is MotionControlSegment => Boolean(seg));

  return {
    title: sanitizeString(row.title, `${appName} format recreation plan`),
    useMotionControl,
    motionControlSegments: useMotionControl && motionControlSegments.length > 0 ? motionControlSegments : undefined,
    strategy: (() => {
      const normalized = enforcePrayerStruggleTone(
        enforceFaithPositiveFraming(sanitizeString(row.strategy, ""))
      );
      return normalized || "Reuse the selected format skeleton as value-first content, generate any required human scenes with a consistent Higgsfield AI influencer, and add subtle app integration where naturally relevant.";
    })(),
    objective: (() => {
      const normalized = enforcePrayerStruggleTone(
        enforceFaithPositiveFraming(sanitizeString(row.objective, ""))
      );
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
        sourceMatchedDurationFallback(sourceVideo.sourceDurationSeconds)
      ),
      aspectRatio: sanitizeString(deliverableSpecRow.aspectRatio, "9:16"),
      platforms: sanitizeStringArray(deliverableSpecRow.platforms, 4),
      voiceStyle: sanitizeString(deliverableSpecRow.voiceStyle, "Warm, direct, practical"),
    },
    script: {
      hook: enforcePrayerStruggleTone(enforceFaithPositiveFraming(adjustedHook)),
      beats: sourceAlignedBeatsWithOpeningHint,
      cta: enforcePrayerStruggleTone(enforceFaithPositiveFraming(adjustedCta)),
    },
    socialCaption: {
      caption: enforcePrayerStruggleTone(enforceFaithPositiveFraming(socialCaption)),
      hashtags:
        socialHashtags.length > 0
          ? socialHashtags
          : ["#MuslimahLifestyle", "#FaithBasedHabits", "#ProductiveRoutine"],
    },
    seedanceSinglePrompt: {
      model: sanitizeString(seedanceRow.model, "Seedance 1.5 Pro"),
      prompt: seedancePrompt,
      targetDuration: targetDurationForSeedance,
    },
    higgsfieldPrompts: faithAdjustedPrompts,
    finalCutProSteps:
      finalCutProSteps.length > 0
        ? finalCutProSteps
        : buildFinalCutProFallbackSteps(sourceVideo.sourceDurationSeconds),
    productionSteps: sanitizeStringArray(row.productionSteps, 12),
    editingTimeline: sanitizeStringArray(row.editingTimeline, 12),
    assetsChecklist: sanitizeStringArray(row.assetsChecklist, 12),
    qaChecklist: sanitizeStringArray(row.qaChecklist, 12),
  };
}
