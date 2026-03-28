import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { buildCycleDayCalendarPlan } from "@/lib/video-agent";
import { DEFAULT_REASONING_MODEL, isReasoningModel } from "@/lib/reasoning-model";

export const runtime = "nodejs";

type CollectionRow = {
  id: string;
  app_name: string | null;
  app_description: string | null;
  app_context?: string | null;
};

type CycleDayPlanRow = {
  id: string;
  collection_id: string;
  plan_number: number;
  app_name: string;
  cycle_start_date: string;
  cycle_length_days: number;
  plan_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  return row.code === "42P01";
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const message = typeof row.message === "string" ? row.message.toLowerCase() : "";
  const details = typeof row.details === "string" ? row.details.toLowerCase() : "";
  const combined = `${message} ${details}`;
  return combined.includes(columnName.toLowerCase()) && combined.includes("column");
}

async function fetchCollectionRow(collectionId: string): Promise<CollectionRow | null> {
  const primary = await supabase
    .from("collections")
    .select("id, app_name, app_description, app_context")
    .eq("id", collectionId)
    .single();

  if (!primary.error && primary.data) {
    return primary.data as CollectionRow;
  }

  if (primary.error && isMissingColumnError(primary.error, "app_context")) {
    const fallback = await supabase
      .from("collections")
      .select("id, app_name, app_description")
      .eq("id", collectionId)
      .single();

    if (!fallback.error && fallback.data) {
      return fallback.data as CollectionRow;
    }
  }

  return null;
}

function readPlanDays(payload: Record<string, unknown> | null): Array<Record<string, unknown>> {
  if (!payload || !isRecord(payload)) return [];
  const nested = isRecord(payload.plan) ? payload.plan : payload;
  const days = Array.isArray(nested.days) ? nested.days : [];
  return days.filter((day): day is Record<string, unknown> => isRecord(day));
}

export async function GET(request: NextRequest) {
  try {
    const collectionId = asText(request.nextUrl.searchParams.get("collectionId"));
    const limitParam = Number(request.nextUrl.searchParams.get("limit") || "15");
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(100, Math.round(limitParam)))
      : 15;

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    const result = await supabase
      .from("video_cycle_day_plans")
      .select("id, collection_id, plan_number, app_name, cycle_start_date, cycle_length_days, plan_payload, created_at, updated_at")
      .eq("collection_id", collectionId)
      .order("plan_number", { ascending: false })
      .limit(limit);

    if (result.error) {
      if (isMissingTableError(result.error)) {
        return NextResponse.json({
          plans: [],
          warning: "Table video_cycle_day_plans is missing. Run the latest Supabase migration.",
        });
      }
      throw result.error;
    }

    const plans = (result.data || []).map((row) => {
      const typed = row as unknown as CycleDayPlanRow;
      const payload = isRecord(typed.plan_payload) ? typed.plan_payload : null;
      const planBody = payload && isRecord(payload.plan) ? payload.plan : payload;
      const days = readPlanDays(payload);

      return {
        id: typed.id,
        planNumber: typed.plan_number,
        appName: typed.app_name,
        cycleStartDate: typed.cycle_start_date,
        cycleLengthDays: typed.cycle_length_days,
        title: isRecord(planBody) ? asText(planBody.title) : "",
        overview: isRecord(planBody) ? asText(planBody.overview) : "",
        openingTemplate: isRecord(planBody) ? asText(planBody.openingTemplate) : "",
        quranOutroTemplate: isRecord(planBody) ? asText(planBody.quranOutroTemplate) : "",
        days: days.map((day) => ({
          dayNumber: typeof day.dayNumber === "number" ? day.dayNumber : Number(day.dayNumber) || 0,
          calendarDate: asText(day.calendarDate),
          cycleDay: typeof day.cycleDay === "number" ? day.cycleDay : Number(day.cycleDay) || 0,
          isPeriodDay: Boolean(day.isPeriodDay),
          isPurityAchieved: Boolean(day.isPurityAchieved),
          isIstihada: Boolean(day.isIstihada),
          worshipStatus: asText(day.worshipStatus),
          quranReference: isRecord(day.quran) ? asText(day.quran.reference) : "",
        })),
        createdAt: typed.created_at,
        updatedAt: typed.updated_at,
      };
    });

    return NextResponse.json({ plans });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load cycle-day plans." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const cycleStartDate = asText(body.cycleStartDate);
    const cycleLengthDays = asFiniteNumber(body.cycleLengthDays);
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    const collection = await fetchCollectionRow(collectionId);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found." }, { status: 404 });
    }

    const latestPlan = await supabase
      .from("video_cycle_day_plans")
      .select("plan_number")
      .eq("collection_id", collectionId)
      .order("plan_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestPlan.error) {
      if (isMissingTableError(latestPlan.error)) {
        return NextResponse.json(
          { error: "Table video_cycle_day_plans is missing. Run the latest Supabase migration first." },
          { status: 500 }
        );
      }
      throw latestPlan.error;
    }

    const nextPlanNumber = (latestPlan.data?.plan_number || 0) + 1;
    const appName = (collection.app_name || "Muslimah Pro").trim() || "Muslimah Pro";
    const appContext = (collection.app_description || collection.app_context || "").trim();

    const plan = await buildCycleDayCalendarPlan({
      appName,
      appContext,
      planNumber: nextPlanNumber,
      cycleStartDate: cycleStartDate || undefined,
      cycleLengthDays: cycleLengthDays ?? undefined,
      reasoningModel,
    });

    const inserted = await supabase
      .from("video_cycle_day_plans")
      .insert({
        collection_id: collectionId,
        plan_number: plan.planNumber,
        app_name: appName,
        cycle_start_date: plan.cycleStartDate,
        cycle_length_days: plan.cycleLengthDays,
        plan_payload: {
          generatedAt: new Date().toISOString(),
          reasoningModel,
          plan,
        },
      })
      .select("id, created_at")
      .single();

    if (inserted.error || !inserted.data) {
      throw inserted.error || new Error("Failed to save cycle-day plan.");
    }

    return NextResponse.json({
      plan,
      saved: {
        id: (inserted.data as { id: string }).id,
        createdAt: (inserted.data as { created_at: string }).created_at,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate cycle-day plan." },
      { status: 500 }
    );
  }
}
