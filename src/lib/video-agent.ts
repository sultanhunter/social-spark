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
  scene: string;
  prompt: string;
  recommendedModel: string;
  modelReason: string;
  shotDuration: string;
};

export interface VideoRecreationPlan {
  title: string;
  strategy: string;
  objective: string;
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

async function buildVisualEvidence(source: VideoSourceMetadata): Promise<{
  method: AnalysisMethod;
  sourceDurationSeconds: number | null;
  parts: InlineImagePart[];
  sampledFrameSources: string[];
  directMediaUrl: string | null;
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

CREATOR CONSTRAINT:
- Assume there are no real human creators available for collaboration.
- If this format requires on-camera human presence (UGC, testimonial, talking-head, lifestyle human actions), you must use AI influencer shots generated in Higgsfield.
- Keep one consistent influencer persona across scenes (face, age range, modest styling, tone, lighting continuity).
- Do not mention "AI" or "generated" inside the public-facing script unless explicitly needed.

SELECTED FORMAT:
${JSON.stringify(format, null, 2)}

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
- Include Higgsfield prompts that can be copied directly.
- Never celebrate anti-religious behavior. Do not frame skipping prayer, neglecting salah, or distancing from worship as a positive outcome.
- Prefer positive faith framing: celebrate being able to pray, spiritual consistency, barakah-oriented routines, and practical habits that support worship.
- If mentioning difficult phases, keep compassionate tone and guide toward faith-positive actions and recovery, not disengagement.
- Keep this value-first, not ad-first. The video should feel like native educational/lifestyle content.
- Do NOT force app mention in every script. Mention the app only when naturally relevant.
- If app insertion is useful, prefer subtle visual integration (screen recording/screenshot overlay, UI callout, or quick proof moment) instead of hard-selling narration.
- Keep explicit app name mentions to a maximum of 1 in the entire script (hook + beats + CTA).
- CTA must be soft and non-salesy (example style: save/share/follow/use this method), with optional subtle app reference only if it fits context.
- For any app overlay moment, specify placement and intent in editNote (for example: "top-right mini overlay of cycle day screen for 2s").
- Reuse the source transcript style (cadence, phrasing, emotional tone) when drafting narration so output feels native to the original format.
- If human presence is needed, include execution-ready Higgsfield prompts for the AI influencer scenes and include persona continuity instructions.
- Production steps must explicitly describe how to generate and stitch AI influencer shots with app overlays.
- Every Higgsfield scene prompt must include performance instruction:
  - If character speaks on camera, include the exact spoken line in quotes and prefix with "Dialogue:".
  - If character does not speak, explicitly write "No dialogue" and describe facial/body expression intent.
- For every Higgsfield scene, include a recommended Higgsfield model and why it is the best fit for that scene.
- For every Higgsfield scene, include individual shotDuration (for example: "3.5s" or "0:08").
- If source content appears to include a famous public figure, public speech, or recognisable creator persona that should not be rewritten:
  - Set integrationMode to "public_figure_overlay_only".
  - Do NOT rewrite their core spoken lines or impersonate them.
  - Keep original speech/audio moments and only integrate app via subtle overlays/screenshots/screen recordings.
  - Avoid making it look like endorsement by that public figure.
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
  "higgsfieldPrompts": [
    {
      "scene": "string",
      "prompt": "string with Dialogue: \"...\" OR No dialogue: ...",
      "recommendedModel": "string",
      "modelReason": "string",
      "shotDuration": "string"
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
    .map((item) => {
      if (!isRecord(item)) return null;
      return {
        scene: sanitizeString(item.scene, "Scene"),
        prompt: ensureHiggsfieldPromptHasPerformanceInstruction(
          sanitizeString(
            item.prompt,
            "Create a vertical 9:16 AI influencer shot for Muslimah audience: modest outfit, natural expression, soft daylight, realistic movement, clean background, consistent character identity across scenes. No dialogue: character conveys reassurance through calm facial expression and gentle nod."
          )
        ),
        recommendedModel: sanitizeString(
          item.recommendedModel,
          "Higgsfield Realistic Character"
        ),
        modelReason: sanitizeString(
          item.modelReason,
          "Best for natural human motion, consistent face identity, and believable lifestyle scenes."
        ),
        shotDuration: sanitizeString(item.shotDuration, "4s"),
      };
    })
    .filter((item): item is HiggsfieldPrompt => Boolean(item))
    .slice(0, 8);

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
    narration: enforceFaithPositiveFraming(
      limitAppNameMentions(beat.narration, appName, mentionState)
    ),
    onScreenText: enforceFaithPositiveFraming(
      limitAppNameMentions(beat.onScreenText, appName, mentionState)
    ),
    editNote: enforceFaithPositiveFraming(beat.editNote),
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

  return {
    title: sanitizeString(row.title, `${appName} format recreation plan`),
    strategy: (() => {
      const normalized = enforceFaithPositiveFraming(sanitizeString(row.strategy, ""));
      return normalized || "Reuse the selected format skeleton as value-first content, generate any required human scenes with a consistent Higgsfield AI influencer, and add subtle app integration where naturally relevant.";
    })(),
    objective: (() => {
      const normalized = enforceFaithPositiveFraming(sanitizeString(row.objective, ""));
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
      hook: enforceFaithPositiveFraming(adjustedHook),
      beats: adjustedBeatsForMode,
      cta: enforceFaithPositiveFraming(adjustedCta),
    },
    higgsfieldPrompts,
    productionSteps: sanitizeStringArray(row.productionSteps, 12),
    editingTimeline: sanitizeStringArray(row.editingTimeline, 12),
    assetsChecklist: sanitizeStringArray(row.assetsChecklist, 12),
    qaChecklist: sanitizeStringArray(row.qaChecklist, 12),
  };
}
