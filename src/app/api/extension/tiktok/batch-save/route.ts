import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { extractPlatform } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { extractSocialPost } from "@/lib/social-extractor";
import {
  analyzeTikTokImageRelevance,
  analyzeTikTokVideoRelevance,
  type VertexNicheDecision,
} from "@/lib/vertex-tiktok";
import { isReasoningModel } from "@/lib/reasoning-model";

export const runtime = "nodejs";
const EXTENSION_REASONING_MODEL = "gemini-3.1-flash-lite-preview";

type BatchRequestBody = {
  collectionId?: unknown;
  urls?: unknown;
  sessionId?: unknown;
  confidenceThreshold?: unknown;
  reasoningModel?: unknown;
};

type BatchItemResult = {
  url: string;
  postType: "image_slides" | "short_video" | null;
  status:
    | "saved_image_slides"
    | "saved_short_video"
    | "saved_short_video_intake_started"
    | "skipped_not_relevant"
    | "skipped_duplicate"
    | "failed";
  reason: string;
  confidence: number | null;
  savedPostId: string | null;
  intakeStatus: "started" | "failed" | "not_applicable";
  intakeError: string | null;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toUniqueHttpUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const urls = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));
  return Array.from(new Set(urls));
}

function toConfidenceThreshold(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.6;
  return Math.max(0.1, Math.min(0.95, value));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function isLikelyVideoMediaUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return (
    /\.(mp4|mov|webm|m4v|m3u8)(\?|$)/i.test(normalized) ||
    normalized.includes("mime_type=video") ||
    normalized.includes("/aweme/v1/play") ||
    normalized.includes("/video/tos")
  );
}

function inferPostTypeFromUrl(url: string): "image_slides" | "short_video" {
  const normalized = url.toLowerCase();
  if (normalized.includes("/photo/")) return "image_slides";
  return "short_video";
}

async function postJson(
  url: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    json: parsed,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BatchRequestBody;
    const collectionId = asText(body.collectionId);
    const urls = toUniqueHttpUrls(body.urls).slice(0, 20);
    const sessionId = asText(body.sessionId) || randomUUID().slice(0, 8);
    const confidenceThreshold = toConfidenceThreshold(body.confidenceThreshold);
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : EXTENSION_REASONING_MODEL;

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    if (urls.length === 0) {
      return NextResponse.json({ error: "urls[] is required." }, { status: 400 });
    }

    const { data: collection, error: collectionError } = await supabase
      .from("collections")
      .select("id, app_name, app_description, app_context")
      .eq("id", collectionId)
      .single();

    if (collectionError || !collection) {
      return NextResponse.json({ error: "Collection not found." }, { status: 404 });
    }

    const origin = request.nextUrl.origin;
    const saveUrl = `${origin}/api/posts/save`;
    const intakeUrl = `${origin}/api/video-agent/intake`;
    const results: BatchItemResult[] = [];

    for (const url of urls) {
      const platform = extractPlatform(url);

      if (platform !== "tiktok") {
        results.push({
          url,
          postType: null,
          status: "failed",
          reason: "Only TikTok URLs are supported in this endpoint.",
          confidence: null,
          savedPostId: null,
          intakeStatus: "not_applicable",
          intakeError: null,
        });
        continue;
      }

      const { data: duplicates, error: duplicateError } = await supabase
        .from("saved_posts")
        .select("id")
        .eq("collection_id", collectionId)
        .eq("original_url", url)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!duplicateError && Array.isArray(duplicates) && duplicates.length > 0) {
        results.push({
          url,
          postType: null,
          status: "skipped_duplicate",
          reason: "Post already saved in this collection.",
          confidence: null,
          savedPostId: duplicates[0].id as string,
          intakeStatus: "not_applicable",
          intakeError: null,
        });
        continue;
      }

      try {
        let postType: "image_slides" | "short_video" = inferPostTypeFromUrl(url);
        let decision: VertexNicheDecision;
        let extractedTitle: string | null = null;
        let extractedDescription: string | null = null;
        let videoSummary: string | null = null;

        try {
          const extracted = await extractSocialPost(url, "tiktok", sessionId, "any");
          extractedTitle = extracted.title;
          extractedDescription = extracted.description;
          if (Array.isArray(extracted.mediaUrls) && extracted.mediaUrls.some(isLikelyVideoMediaUrl)) {
            postType = "short_video";
          } else if (Array.isArray(extracted.mediaUrls) && extracted.mediaUrls.length > 0) {
            postType = "image_slides";
          }
        } catch {
          // If extractor preflight fails we still attempt save and let existing save endpoint handle retries.
        }

        if (postType === "short_video") {
          const videoAnalysis = await analyzeTikTokVideoRelevance({
            url,
            sessionId,
            collectionId,
            collection: {
              appName: collection.app_name,
              appDescription: collection.app_description || "",
              appContext: collection.app_context || "",
            },
          });
          decision = videoAnalysis.decision;
          videoSummary = videoAnalysis.frameData.transcript.summary || null;
          extractedTitle = extractedTitle || videoAnalysis.frameData.title;
          extractedDescription = extractedDescription || videoAnalysis.frameData.description;
        } else {
          decision = await analyzeTikTokImageRelevance({
            url,
            title: extractedTitle,
            description: extractedDescription,
            collection: {
              appName: collection.app_name,
              appDescription: collection.app_description || "",
              appContext: collection.app_context || "",
            },
          });
        }

        if (!decision.isRelevant || decision.confidence < confidenceThreshold) {
          results.push({
            url,
            postType,
            status: "skipped_not_relevant",
            reason: decision.reason,
            confidence: decision.confidence,
            savedPostId: null,
            intakeStatus: "not_applicable",
            intakeError: null,
          });
          continue;
        }

        const saveResponse = await postJson(saveUrl, {
          url,
          collectionId,
          postType,
          title: extractedTitle,
          description: extractedDescription,
        });

        if (!saveResponse.ok || !saveResponse.json || typeof saveResponse.json !== "object") {
          results.push({
            url,
            postType,
            status: "failed",
            reason: `Save failed (${saveResponse.status}).`,
            confidence: decision.confidence,
            savedPostId: null,
            intakeStatus: "not_applicable",
            intakeError: null,
          });
          continue;
        }

        const savedPost = saveResponse.json as Record<string, unknown>;
        const savedPostId = typeof savedPost.id === "string" ? savedPost.id : null;

        let status: BatchItemResult["status"] =
          postType === "short_video" ? "saved_short_video" : "saved_image_slides";
        let intakeStatus: BatchItemResult["intakeStatus"] = "not_applicable";
        let intakeError: string | null = null;

        if (postType === "short_video") {
          const intakeResponse = await postJson(intakeUrl, {
            collectionId,
            url,
            userNotes:
              `Imported via Chrome extension session ${sessionId}. ` +
              `Vertex relevance: ${decision.reason}. ` +
              `Transcript summary: ${videoSummary || "N/A"}`,
            reasoningModel,
          });

          if (intakeResponse.ok) {
            status = "saved_short_video_intake_started";
            intakeStatus = "started";
          } else {
            intakeStatus = "failed";
            intakeError = `Video intake failed (${intakeResponse.status}).`;
          }
        }

        results.push({
          url,
          postType,
          status,
          reason: decision.reason,
          confidence: decision.confidence,
          savedPostId,
          intakeStatus,
          intakeError,
        });
      } catch (error) {
        results.push({
          url,
          postType: null,
          status: "failed",
          reason: getErrorMessage(error),
          confidence: null,
          savedPostId: null,
          intakeStatus: "not_applicable",
          intakeError: null,
        });
      }
    }

    const summary = {
      received: urls.length,
      savedImageSlides: results.filter((item) => item.status === "saved_image_slides").length,
      savedShortVideos: results.filter((item) => item.status === "saved_short_video").length,
      savedShortVideosWithIntake: results.filter(
        (item) => item.status === "saved_short_video_intake_started"
      ).length,
      skippedNotRelevant: results.filter((item) => item.status === "skipped_not_relevant").length,
      skippedDuplicate: results.filter((item) => item.status === "skipped_duplicate").length,
      failed: results.filter((item) => item.status === "failed").length,
      confidenceThreshold,
      sessionId,
    };

    return NextResponse.json({ summary, results }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}