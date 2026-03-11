import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  return row.code === "42P01";
}

function asPositiveLimit(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(parsed, 50));
}

export async function GET(request: NextRequest) {
  try {
    const collectionId = request.nextUrl.searchParams.get("collectionId")?.trim();
    const formatId = request.nextUrl.searchParams.get("formatId")?.trim();
    const videoId = request.nextUrl.searchParams.get("videoId")?.trim();
    const limit = asPositiveLimit(request.nextUrl.searchParams.get("limit"), 20);

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    let query = supabase
      .from("video_recreation_plans")
      .select("id, collection_id, format_id, source_video_id, app_name, plan_payload, created_at")
      .eq("collection_id", collectionId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (formatId) {
      query = query.eq("format_id", formatId);
    }

    if (videoId) {
      query = query.eq("source_video_id", videoId);
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json(
          {
            error:
              "Video recreation plans table is missing. Run the video-agent SQL migration first (see supabase-migration.sql).",
          },
          { status: 500 }
        );
      }
      throw error;
    }

    const rows = Array.isArray(data) ? (data as unknown as PlanRow[]) : [];

    const plans = rows
      .map((row) => {
        const payload = row.plan_payload && typeof row.plan_payload === "object"
          ? (row.plan_payload as Record<string, unknown>)
          : null;

        const plan = payload?.plan;
        if (!plan || typeof plan !== "object") return null;

        return {
          id: row.id,
          collection_id: row.collection_id,
          format_id: row.format_id,
          source_video_id: row.source_video_id,
          app_name: row.app_name,
          reasoningModel: typeof payload?.reasoningModel === "string" ? payload.reasoningModel : null,
          generatedAt:
            typeof payload?.generatedAt === "string" && payload.generatedAt.trim()
              ? payload.generatedAt
              : row.created_at,
          created_at: row.created_at,
          plan,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ plans });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load saved recreation plans." },
      { status: 500 }
    );
  }
}
