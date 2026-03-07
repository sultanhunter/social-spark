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
}

export interface VideoFormatAnalysis {
  formatName: string;
  formatType: NormalizedFormatType;
  formatSignature: string;
  analysisMethod: AnalysisMethod;
  sampledFrameCount: number;
  sampledFrameSources: string[];
  directMediaUrl: string | null;
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
  scene: string;
  prompt: string;
};

export interface VideoRecreationPlan {
  title: string;
  strategy: string;
  objective: string;
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
  higgsfieldPrompts: HiggsfieldPrompt[];
  productionSteps: string[];
  editingTimeline: string[];
  assetsChecklist: string[];
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

function sanitizeNumber(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return value;
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

async function buildVisualEvidence(source: VideoSourceMetadata): Promise<{
  method: AnalysisMethod;
  parts: InlineImagePart[];
  sampledFrameSources: string[];
  directMediaUrl: string | null;
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

  return {
    method: "frame_aware",
    parts: frameParts,
    sampledFrameSources: ["remote_extractor_frames"],
    directMediaUrl: frameExtraction.videoUrl,
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
  reasoningModel: ReasoningModel = DEFAULT_REASONING_MODEL
): Promise<VideoFormatAnalysis> {
  requireGeminiKey();
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const visualEvidence = await buildVisualEvidence(source);

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

OUTPUT RULES:
- Return strict JSON only.
- formatType must be one of: ugc, ai_video, hybrid, editorial.
- formatSignature must be stable across similar videos, lowercase snake_case, 3-6 words.
- Focus on structure and repeatable production system (hook type, shot style, edit rhythm), not topic specifics.
- Extract visible text overlays from attached frames when possible.

JSON SHAPE:
{
  "formatName": "string",
  "formatType": "ugc|ai_video|hybrid|editorial",
  "formatSignature": "string",
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
    sampledFrameCount: visualEvidence.parts.length,
    sampledFrameSources: visualEvidence.sampledFrameSources,
    directMediaUrl: visualEvidence.directMediaUrl,
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
  };
  format: VideoFormatAnalysis;
  reasoningModel?: ReasoningModel;
}

export async function buildVideoRecreationPlan({
  appName,
  appContext,
  sourceVideo,
  format,
  reasoningModel = DEFAULT_REASONING_MODEL,
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
- Higgsfield subscription for generation
- Professional video editing tools

SELECTED FORMAT:
${JSON.stringify(format, null, 2)}

REFERENCE VIDEO:
- URL: ${sourceVideo.sourceUrl}
- Platform: ${sourceVideo.platform}
- Title: ${sourceVideo.title || "N/A"}
- Description: ${sourceVideo.description || "N/A"}
- Notes: ${sourceVideo.userNotes || "N/A"}

RESPONSE RULES:
- Build for Muslim women audience and keep tone faith-aware, practical, and respectful.
- Keep output execution-ready, not high-level fluff.
- Use clear timing beats for 15-35 second vertical video.
- Include Higgsfield prompts that can be copied directly.
- Return strict JSON only.

JSON SHAPE:
{
  "title": "string",
  "strategy": "string",
  "objective": "string",
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
  "higgsfieldPrompts": [
    {
      "scene": "string",
      "prompt": "string"
    }
  ],
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
    .slice(0, 8);

  const promptsRaw = Array.isArray(row.higgsfieldPrompts) ? row.higgsfieldPrompts : [];
  const higgsfieldPrompts: HiggsfieldPrompt[] = promptsRaw
    .map((item) => {
      if (!isRecord(item)) return null;
      return {
        scene: sanitizeString(item.scene, "Scene"),
        prompt: sanitizeString(item.prompt, "Create a vertical 9:16 shot aligned with the selected format."),
      };
    })
    .filter((item): item is HiggsfieldPrompt => Boolean(item))
    .slice(0, 8);

  return {
    title: sanitizeString(row.title, `${appName} format recreation plan`),
    strategy: sanitizeString(row.strategy, "Reuse the selected format skeleton while adapting the message for the app audience."),
    objective: sanitizeString(row.objective, "Create a high-retention short video and convert viewers into app intent."),
    deliverableSpec: {
      duration: sanitizeString(deliverableSpecRow.duration, "20-30 seconds"),
      aspectRatio: sanitizeString(deliverableSpecRow.aspectRatio, "9:16"),
      platforms: sanitizeStringArray(deliverableSpecRow.platforms, 4),
      voiceStyle: sanitizeString(deliverableSpecRow.voiceStyle, "Warm, direct, practical"),
    },
    script: {
      hook: sanitizeString(scriptRow.hook, "Start with a direct pain-point hook in first 2 seconds."),
      beats,
      cta: sanitizeString(scriptRow.cta, "Invite viewers to open the app for the full guided experience."),
    },
    higgsfieldPrompts,
    productionSteps: sanitizeStringArray(row.productionSteps, 12),
    editingTimeline: sanitizeStringArray(row.editingTimeline, 12),
    assetsChecklist: sanitizeStringArray(row.assetsChecklist, 12),
    qaChecklist: sanitizeStringArray(row.qaChecklist, 12),
  };
}
