import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { uploadToR2 } from "@/lib/r2";

export const runtime = "nodejs";

type PlanRow = {
  id: string;
  collection_id: string;
  format_id: string;
  source_video_id: string;
  plan_payload: Record<string, unknown> | null;
};

type PlanShape = {
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
    throw new Error("Uploaded frame is not a valid image data URL.");
  }

  const mimeType = match[1] || "image/jpeg";
  const base64 = match[2] || "";
  return {
    mimeType,
    buffer: Buffer.from(base64, "base64"),
  };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const videoId = asText(body.videoId);
    const imageDataUrl = asText(body.imageDataUrl);
    const sourceVideoName = cleanText(body.sourceVideoName) || "uploaded-video";
    const sourceDurationSeconds = toFiniteNumber(body.sourceDurationSeconds);
    const sourceSeekTimeSeconds = toFiniteNumber(body.sourceSeekTimeSeconds);
    const segmentIndex = typeof body.segmentIndex === "number" ? Math.floor(body.segmentIndex) : -1;

    if (!collectionId || !videoId) {
      return NextResponse.json({ error: "collectionId and videoId are required." }, { status: 400 });
    }

    if (!imageDataUrl) {
      return NextResponse.json({ error: "imageDataUrl is required." }, { status: 400 });
    }

    if (segmentIndex < 1) {
      return NextResponse.json(
        { error: "segmentIndex must be >= 1 (segment 2 onward)." },
        { status: 400 }
      );
    }

    const latestPlanResult = await supabase
      .from("video_recreation_plans")
      .select("id, collection_id, format_id, source_video_id, plan_payload")
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

    if (!plan || !Array.isArray(plan.motionControlSegments)) {
      return NextResponse.json(
        { error: "Saved recreation plan has no shot groups. Generate plan with shot groups first." },
        { status: 400 }
      );
    }

    if (!plan.motionControlSegments[segmentIndex]) {
      return NextResponse.json(
        { error: "Invalid segment index for this plan." },
        { status: 400 }
      );
    }

    const { buffer, mimeType } = dataUrlToBuffer(imageDataUrl);
    const generatedAt = new Date().toISOString();
    const key = `collections/${collectionId}/video-agent/start-frames/${videoId}/uploaded-${generatedAt.replace(/[:.]/g, "-")}-${randomUUID()}.jpg`;
    const imageUrl = await uploadToR2(key, buffer, mimeType || "image/jpeg");

    const promptNotes = [
      `Start frame extracted from uploaded previous segment generated video (${sourceVideoName}).`,
      sourceDurationSeconds !== null ? `Source duration: ${sourceDurationSeconds.toFixed(2)}s.` : "",
      sourceSeekTimeSeconds !== null ? `Extracted from: ${sourceSeekTimeSeconds.toFixed(2)}s (near end frame).` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const nextStartFrame = {
      imageUrl,
      prompt: promptNotes,
      generatedAt,
      characterId: null,
      imageModel: "uploaded-video-last-frame",
    };

    const updatedSegments = [...plan.motionControlSegments];
    updatedSegments[segmentIndex] = {
      ...updatedSegments[segmentIndex],
      startFrame: nextStartFrame,
    };

    const nextPlan: PlanShape = {
      ...plan,
      motionControlSegments: updatedSegments,
    };

    const nextPayload = {
      ...payload,
      plan: nextPlan,
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
      { error: err instanceof Error ? err.message : "Failed to process uploaded previous segment video." },
      { status: 500 }
    );
  }
}
