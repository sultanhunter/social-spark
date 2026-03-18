import { randomUUID } from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { extractVideoFrames, type ExtractedVideoFramesData } from "@/lib/social-extractor";

type VertexPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export interface VertexNicheDecision {
  isRelevant: boolean;
  confidence: number;
  reason: string;
  category: "period_pregnancy" | "islamic_period_pregnancy" | "other";
}

interface VertexCollectionContext {
  appName: string;
  appDescription: string;
  appContext: string;
}

interface AnalyzeImageInput {
  url: string;
  title: string | null;
  description: string | null;
  collection: VertexCollectionContext;
}

interface AnalyzeVideoInput {
  url: string;
  sessionId: string;
  collectionId: string;
  collection: VertexCollectionContext;
}

interface AnalyzeVideoOutput {
  decision: VertexNicheDecision;
  frameData: ExtractedVideoFramesData;
}

const VERTEX_MODEL = "gemini-3.1-flash-lite-preview";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getVertexClient(): GoogleGenerativeAI {
  const key = process.env.VERTEXT_API_KEY || "";

  if (!key) {
    throw new Error("Missing VERTEXT_API_KEY.");
  }

  return new GoogleGenerativeAI(key);
}

function parseJsonFromText(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return null;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      return null;
    } catch {
      return null;
    }
  }
}

function normalizeDecision(parsed: Record<string, unknown> | null): VertexNicheDecision {
  const rawRelevant = parsed?.isRelevant;
  const rawConfidence = parsed?.confidence;
  const rawReason = parsed?.reason;
  const rawCategory = parsed?.category;

  const isRelevant = typeof rawRelevant === "boolean" ? rawRelevant : false;
  const confidence =
    typeof rawConfidence === "number" && !Number.isNaN(rawConfidence)
      ? clamp(rawConfidence, 0, 1)
      : 0.5;
  const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim() : "No reason provided";

  const category: VertexNicheDecision["category"] =
    rawCategory === "period_pregnancy" || rawCategory === "islamic_period_pregnancy"
      ? rawCategory
      : "other";

  return {
    isRelevant,
    confidence,
    reason,
    category,
  };
}

async function callVertexForDecision(prompt: string, extraParts: VertexPart[] = []): Promise<VertexNicheDecision> {
  const client = getVertexClient();
  const model = client.getGenerativeModel({ model: VERTEX_MODEL });

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, ...extraParts],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const text = result.response.text() || "";
  return normalizeDecision(parseJsonFromText(text));
}

function buildBasePrompt(collection: VertexCollectionContext, contentBlock: string): string {
  return `You are classifying whether a TikTok post should be saved for a content research app.

Target app context:
- App name: ${collection.appName}
- App description: ${collection.appDescription}
- App context: ${collection.appContext}

Relevance rule (strict):
- Relevant when content is about periods or pregnancy.
- Relevant when content combines Islamic framing with periods or pregnancy.
- Not relevant for generic Islamic content that does not mention periods/pregnancy.

${contentBlock}

Return JSON only using this exact schema:
{
  "isRelevant": true,
  "confidence": 0.0,
  "reason": "short reason",
  "category": "period_pregnancy" | "islamic_period_pregnancy" | "other"
}`;
}

export async function analyzeTikTokImageRelevance(input: AnalyzeImageInput): Promise<VertexNicheDecision> {
  const prompt = buildBasePrompt(
    input.collection,
    `Post metadata:\n- URL: ${input.url}\n- Title: ${input.title || "N/A"}\n- Description: ${input.description || "N/A"}`
  );

  return callVertexForDecision(prompt);
}

export async function analyzeTikTokVideoRelevance(input: AnalyzeVideoInput): Promise<AnalyzeVideoOutput> {
  const frameData = await extractVideoFrames(input.url, "tiktok", {
    sessionId: input.sessionId || randomUUID().slice(0, 8),
    frameCount: 6,
    frameWidth: 960,
    includeTranscript: true,
    transcriptMaxSeconds: 90,
    collectionId: input.collectionId,
  });

  const transcriptSummary = frameData.transcript.summary || "N/A";
  const transcriptText = frameData.transcript.fullText || "N/A";

  const prompt = buildBasePrompt(
    input.collection,
    `Video metadata:\n- URL: ${input.url}\n- Title: ${frameData.title || "N/A"}\n- Description: ${frameData.description || "N/A"}\n- Transcript summary: ${transcriptSummary}\n- Transcript text: ${transcriptText.slice(0, 6000)}\n- Duration seconds: ${frameData.durationSeconds ?? "unknown"}`
  );

  const frameParts: VertexPart[] = frameData.frames.slice(0, 6).map((frame) => ({
    inlineData: {
      mimeType: frame.mimeType || "image/jpeg",
      data: frame.data,
    },
  }));

  const decision = await callVertexForDecision(prompt, frameParts);

  return {
    decision,
    frameData,
  };
}