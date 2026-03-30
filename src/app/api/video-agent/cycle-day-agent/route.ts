import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  buildCycleDayVideoScriptPlan,
  stripMultiShotPromptsFromIdeationPlan,
  type CycleDayCalendarDay,
  type ScriptAgentVideoType,
  type UGCCharacterProfile,
} from "@/lib/video-agent";
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
  cycle_start_date: string;
  cycle_length_days: number;
  plan_payload: Record<string, unknown> | null;
};

type VideoUgcCharacterRow = {
  id: string;
  character_name: string;
  persona_summary: string;
  visual_style: string;
  wardrobe_notes: string | null;
  voice_tone: string | null;
  prompt_template: string;
  reference_image_url: string | null;
  image_model: string | null;
  character_type?: string | null;
  is_default?: boolean | null;
};

type VideoFormatRow = {
  id: string;
  source_count: number | null;
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

function sanitizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const cleaned = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(cleaned)) return true;
    if (["false", "0", "no", "n"].includes(cleaned)) return false;
  }
  return fallback;
}

function sanitizeInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return fallback;
}

function normalizeCharacterType(value: unknown): "ugc" | "animated" {
  const cleaned = typeof value === "string" ? value.trim().toLowerCase() : "";
  return cleaned === "animated" ? "animated" : "ugc";
}

function resolveCharacterType(row: Pick<VideoUgcCharacterRow, "character_type" | "prompt_template">): "ugc" | "animated" {
  const byColumn = normalizeCharacterType(row.character_type);
  if (byColumn === "animated") return "animated";
  return /CharacterType:\s*animated/i.test(row.prompt_template || "") ? "animated" : "ugc";
}

function mapScriptAgentVideoTypeToFormatType(videoType: ScriptAgentVideoType): "ugc" | "ai_video" | "hybrid" | "editorial" {
  if (videoType === "ugc") return "ugc";
  if (videoType === "ai_animation") return "ai_video";
  if (videoType === "faceless_broll") return "editorial";
  return "hybrid";
}

function toTitleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toIsoDate(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const cleaned = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
    const parsed = new Date(cleaned);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getUTCFullYear();
      const month = `${parsed.getUTCMonth() + 1}`.padStart(2, "0");
      const day = `${parsed.getUTCDate()}`.padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }
  return fallback;
}

function toCycleDayCalendarDay(dayRow: unknown, dayNumber: number, fallbackDate: string): CycleDayCalendarDay {
  const row = isRecord(dayRow) ? dayRow : {};
  const quran = isRecord(row.quran) ? row.quran : {};
  const dailyStory = isRecord(row.dailyStory) ? row.dailyStory : {};
  const plannedActions = Array.isArray(row.plannedActions)
    ? row.plannedActions.filter((item): item is string => typeof item === "string")
    : [];
  const appHooks = Array.isArray(row.appHooks)
    ? row.appHooks.filter((item): item is string => typeof item === "string")
    : [];

  return {
    dayNumber: Math.max(1, sanitizeInteger(row.dayNumber, dayNumber)),
    calendarDate: toIsoDate(row.calendarDate, fallbackDate),
    cycleDay: Math.max(1, sanitizeInteger(row.cycleDay, dayNumber)),
    isPeriodDay: sanitizeBoolean(row.isPeriodDay, dayNumber <= 6),
    isPurityAchieved: sanitizeBoolean(row.isPurityAchieved, dayNumber >= 7),
    isIstihada: sanitizeBoolean(row.isIstihada, false),
    worshipStatus: asText(row.worshipStatus) || "Prayer and Quran status available in app.",
    quran: {
      surahName: asText(quran.surahName) || "Al-Baqarah",
      verseStart: Math.max(1, sanitizeInteger(quran.verseStart, 1)),
      verseEnd: Math.max(1, sanitizeInteger(quran.verseEnd, 5)),
      reference: asText(quran.reference) || "Surah Al-Baqarah 1-5",
      verseMeaningSummary: asText(quran.verseMeaningSummary) || "Quick meaning summary: these verses call believers to patience, trust in Allah, and steady faith in hardship.",
      revelationContext: asText(quran.revelationContext) || "Mention revelation context and setting.",
      relatedHadith: asText(quran.relatedHadith) || "",
      scholarlyInterpretation: asText(quran.scholarlyInterpretation) || "Include one concise trusted tafsir interpretation.",
      keyTakeaway: asText(quran.keyTakeaway) || "One practical takeaway for daily practice.",
    },
    dailyStory: {
      morning: asText(dailyStory.morning) || "Morning routine with app check-in.",
      quranJourney: asText(dailyStory.quranJourney) || "Quran reading progress update.",
      chores: asText(dailyStory.chores) || "Routine chores and responsibilities.",
      lunch: asText(dailyStory.lunch) || "Lunch and hydration update.",
      salah: asText(dailyStory.salah) || "Salah check-ins according to app status.",
      evening: asText(dailyStory.evening) || "Evening reflection and prep for tomorrow.",
    },
    plannedActions: plannedActions.length > 0 ? plannedActions : ["Morning app check", "Quran reading", "Daily chores", "Evening reflection"],
    appHooks: appHooks.length > 0 ? appHooks : [
      "Show app status before prayer decision moments.",
      "Show app Quran tracker before reading segment.",
    ],
  };
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

function toUgcCharacterProfile(row: VideoUgcCharacterRow): UGCCharacterProfile {
  return {
    id: row.id,
    characterName: row.character_name,
    personaSummary: row.persona_summary,
    visualStyle: row.visual_style,
    wardrobeNotes: row.wardrobe_notes || "",
    voiceTone: row.voice_tone || "",
    promptTemplate: row.prompt_template,
    referenceImageUrl: row.reference_image_url,
    imageModel: row.image_model,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const selectedCyclePlanId = asText(body.cyclePlanId);
    const selectedCharacterId = asText(body.characterId);
    const cycleDayNumberRaw = asFiniteNumber(body.cycleDayNumber);
    const targetDurationSeconds = asFiniteNumber(body.targetDurationSeconds);
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    const cycleDayNumber = cycleDayNumberRaw ? Math.max(1, Math.round(cycleDayNumberRaw)) : null;
    if (!cycleDayNumber) {
      return NextResponse.json({ error: "cycleDayNumber is required." }, { status: 400 });
    }

    const collection = await fetchCollectionRow(collectionId);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found." }, { status: 404 });
    }

    const cyclePlanQuery = selectedCyclePlanId
      ? supabase
        .from("video_cycle_day_plans")
        .select("id, collection_id, plan_number, cycle_start_date, cycle_length_days, plan_payload")
        .eq("collection_id", collectionId)
        .eq("id", selectedCyclePlanId)
        .maybeSingle()
      : supabase
        .from("video_cycle_day_plans")
        .select("id, collection_id, plan_number, cycle_start_date, cycle_length_days, plan_payload")
        .eq("collection_id", collectionId)
        .order("plan_number", { ascending: false })
        .limit(1)
        .maybeSingle();

    const cyclePlanResult = await cyclePlanQuery;
    if (cyclePlanResult.error) {
      if (isMissingTableError(cyclePlanResult.error)) {
        return NextResponse.json(
          { error: "Table video_cycle_day_plans is missing. Generate and migrate cycle plans first." },
          { status: 500 }
        );
      }
      throw cyclePlanResult.error;
    }

    if (!cyclePlanResult.data) {
      return NextResponse.json({ error: "Cycle-day plan not found for this collection." }, { status: 404 });
    }

    const cyclePlan = cyclePlanResult.data as unknown as CycleDayPlanRow;
    const payload = isRecord(cyclePlan.plan_payload) ? cyclePlan.plan_payload : {};
    const nestedPlan = isRecord(payload.plan) ? payload.plan : payload;
    const days = Array.isArray(nestedPlan.days) ? nestedPlan.days : [];
    const dayRow = days.find((item) => {
      if (!isRecord(item)) return false;
      const day = sanitizeInteger(item.dayNumber, 0);
      return day === cycleDayNumber;
    });

    if (!dayRow) {
      return NextResponse.json(
        { error: `Cycle day ${cycleDayNumber} was not found in plan ${cyclePlan.plan_number}.` },
        { status: 404 }
      );
    }

    const fallbackDate = cyclePlan.cycle_start_date || new Date().toISOString().slice(0, 10);
    const cycleDayData = toCycleDayCalendarDay(dayRow, cycleDayNumber, fallbackDate);

    let ugcCharacter: UGCCharacterProfile | null = null;
    const fullSelect =
      "id, character_name, persona_summary, visual_style, wardrobe_notes, voice_tone, prompt_template, reference_image_url, image_model, character_type, is_default";
    const fallbackSelect =
      "id, character_name, persona_summary, visual_style, wardrobe_notes, voice_tone, prompt_template, reference_image_url, image_model";

    let selectedCharacterRow: VideoUgcCharacterRow | null = null;

    if (selectedCharacterId) {
      let byId = await supabase
        .from("video_ugc_characters")
        .select(fullSelect)
        .eq("collection_id", collectionId)
        .eq("id", selectedCharacterId)
        .maybeSingle();

      if (byId.error && (isMissingColumnError(byId.error, "character_type") || isMissingColumnError(byId.error, "is_default"))) {
        byId = await supabase
          .from("video_ugc_characters")
          .select(fallbackSelect)
          .eq("collection_id", collectionId)
          .eq("id", selectedCharacterId)
          .maybeSingle();
      }

      if (!byId.data) {
        return NextResponse.json({ error: "Selected character not found for this collection." }, { status: 404 });
      }

      const row = byId.data as unknown as VideoUgcCharacterRow;
      if (resolveCharacterType(row) !== "animated") {
        return NextResponse.json(
          { error: "Cycle Day Agent requires an animated character. Please select a 3D animated character." },
          { status: 400 }
        );
      }

      selectedCharacterRow = row;
    } else {
      let animatedDefault = await supabase
        .from("video_ugc_characters")
        .select(fullSelect)
        .eq("collection_id", collectionId)
        .eq("character_type", "animated")
        .eq("is_default", true)
        .maybeSingle();

      if (animatedDefault.error && (isMissingColumnError(animatedDefault.error, "character_type") || isMissingColumnError(animatedDefault.error, "is_default"))) {
        animatedDefault = await supabase
          .from("video_ugc_characters")
          .select(fallbackSelect)
          .eq("collection_id", collectionId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
      }

      if (animatedDefault.data) {
        const row = animatedDefault.data as unknown as VideoUgcCharacterRow;
        if (resolveCharacterType(row) === "animated") {
          selectedCharacterRow = row;
        }
      }

      if (!selectedCharacterRow) {
        let firstAnimated = await supabase
          .from("video_ugc_characters")
          .select(fullSelect)
          .eq("collection_id", collectionId)
          .eq("character_type", "animated")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (firstAnimated.error && isMissingColumnError(firstAnimated.error, "character_type")) {
          firstAnimated = await supabase
            .from("video_ugc_characters")
            .select(fallbackSelect)
            .eq("collection_id", collectionId)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
        }

        if (firstAnimated.data) {
          const row = firstAnimated.data as unknown as VideoUgcCharacterRow;
          if (resolveCharacterType(row) === "animated") {
            selectedCharacterRow = row;
          }
        }
      }

      if (!selectedCharacterRow) {
        return NextResponse.json(
          { error: "No animated character found for this collection. Create a 3D animated character first." },
          { status: 400 }
        );
      }
    }

    ugcCharacter = toUgcCharacterProfile(selectedCharacterRow);

    const appName = (collection.app_name || "Muslimah Pro").trim() || "Muslimah Pro";
    const appContext = (collection.app_description || collection.app_context || "").trim();

    const planDraft = await buildCycleDayVideoScriptPlan({
      appName,
      appContext,
      cyclePlanNumber: cyclePlan.plan_number,
      cycleDayData,
      targetDurationSeconds,
      ugcCharacter,
      reasoningModel,
    });
    const plan = stripMultiShotPromptsFromIdeationPlan(planDraft);

    const formatSignature = `cycle_day_agent_plan_${cyclePlan.plan_number}_day_${cycleDayData.dayNumber}_${plan.selectedVideoType}`;
    const generatedSourceUrl = `cycle-day-agent://${collectionId}/${Date.now()}-${randomUUID().slice(0, 8)}`;
    const mappedFormatType = mapScriptAgentVideoTypeToFormatType(plan.selectedVideoType);
    const formatName = `Cycle Day Agent - Plan ${cyclePlan.plan_number} Day ${cycleDayData.dayNumber} - ${toTitleCase(plan.selectedVideoType)}`;

    let formatRow: VideoFormatRow | null = null;

    const existingFormat = await supabase
      .from("video_formats")
      .select("id, source_count")
      .eq("collection_id", collectionId)
      .eq("format_signature", formatSignature)
      .maybeSingle();

    if (existingFormat.error && !isMissingTableError(existingFormat.error)) {
      throw existingFormat.error;
    }

    if (existingFormat.data) {
      const row = existingFormat.data as unknown as VideoFormatRow;
      const nextSourceCount = (typeof row.source_count === "number" ? row.source_count : 0) + 1;

      const updatedFormat = await supabase
        .from("video_formats")
        .update({
          format_name: formatName,
          format_type: mappedFormatType,
          summary: plan.objective,
          why_it_works: [plan.videoTypeReason, plan.appHookStrategy],
          hook_patterns: [plan.script.hook],
          shot_pattern: plan.motionControlSegments.slice(0, 8).map((segment) => segment.startFramePrompt),
          editing_style: [plan.selectedVideoType.replace(/_/g, " "), "cycle day agent generated"],
          script_scaffold: plan.script.hook,
          higgsfield_prompt_template: plan.motionControlSegments[0]?.veoPrompt || "",
          recreation_checklist: plan.qaChecklist,
          duration_guidance: `${plan.targetDurationSeconds}s target`,
          confidence: 0.86,
          source_count: nextSourceCount,
          latest_source_url: generatedSourceUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("collection_id", collectionId)
        .select("id, source_count")
        .single();

      if (updatedFormat.error || !updatedFormat.data) {
        throw updatedFormat.error || new Error("Failed to update cycle-day format.");
      }

      formatRow = updatedFormat.data as unknown as VideoFormatRow;
    } else {
      const insertedFormat = await supabase
        .from("video_formats")
        .insert({
          collection_id: collectionId,
          format_name: formatName,
          format_type: mappedFormatType,
          format_signature: formatSignature,
          summary: plan.objective,
          why_it_works: [plan.videoTypeReason, plan.appHookStrategy],
          hook_patterns: [plan.script.hook],
          shot_pattern: plan.motionControlSegments.slice(0, 8).map((segment) => segment.startFramePrompt),
          editing_style: [plan.selectedVideoType.replace(/_/g, " "), "cycle day agent generated"],
          script_scaffold: plan.script.hook,
          higgsfield_prompt_template: plan.motionControlSegments[0]?.veoPrompt || "",
          recreation_checklist: plan.qaChecklist,
          duration_guidance: `${plan.targetDurationSeconds}s target`,
          confidence: 0.86,
          source_count: 1,
          latest_source_url: generatedSourceUrl,
        })
        .select("id, source_count")
        .single();

      if (insertedFormat.error || !insertedFormat.data) {
        throw insertedFormat.error || new Error("Failed to create cycle-day format.");
      }

      formatRow = insertedFormat.data as unknown as VideoFormatRow;
    }

    if (!formatRow) {
      throw new Error("Failed to resolve cycle-day format row.");
    }

    const analysisPayload = {
      sourceMetadata: {
        url: generatedSourceUrl,
        platform: "generated",
        title: plan.title,
        description: plan.objective,
        thumbnailUrl: null,
        userNotes: `Cycle plan ${cyclePlan.plan_number}, day ${cycleDayData.dayNumber}`,
        transcriptSummary: null,
        transcriptText: null,
        sourceDurationSeconds: plan.targetDurationSeconds,
      },
      formatAnalysis: {
        formatName,
        formatType: mappedFormatType,
        formatSignature,
        analysisMethod: "frame_aware",
        sourceDurationSeconds: plan.targetDurationSeconds,
        sampledFrameCount: 0,
        sampledFrameSources: [],
        directMediaUrl: null,
        r2VideoUrl: null,
        transcriptAvailable: false,
        transcriptSummary: "",
        transcriptText: "",
        transcriptHighlights: [],
        visualSignals: plan.motionControlSegments.slice(0, 8).map((segment) => segment.startFramePrompt),
        onScreenTextPatterns: [],
        summary: plan.objective,
        whyItWorks: [plan.videoTypeReason, plan.appHookStrategy],
        hookPatterns: [plan.script.hook],
        shotPattern: plan.motionControlSegments.slice(0, 8).map((segment) => segment.timecode),
        editingStyle: [plan.selectedVideoType.replace(/_/g, " "), "cycle day agent generated"],
        scriptScaffold: plan.script.hook,
        higgsfieldPromptTemplate: plan.motionControlSegments[0]?.veoPrompt || "",
        recreationChecklist: plan.qaChecklist,
        durationGuidance: `${plan.targetDurationSeconds}s target`,
        confidence: 0.86,
      },
      matchDecision: {
        reason: "Cycle-day agent generated source",
      },
      reasoningModel,
      analyzedAt: new Date().toISOString(),
      cycleDayAgent: {
        cyclePlanId: cyclePlan.id,
        cyclePlanNumber: cyclePlan.plan_number,
        cycleDayNumber: cycleDayData.dayNumber,
        cycleDay: cycleDayData,
      },
    };

    const insertedVideo = await supabase
      .from("video_format_videos")
      .insert({
        collection_id: collectionId,
        format_id: formatRow.id,
        source_url: generatedSourceUrl,
        platform: "generated",
        title: plan.title,
        description: plan.objective,
        thumbnail_url: null,
        user_notes: `Cycle plan ${cyclePlan.plan_number}, day ${cycleDayData.dayNumber}`,
        analysis_confidence: 0.86,
        analysis_payload: analysisPayload,
      })
      .select("id")
      .single();

    if (insertedVideo.error || !insertedVideo.data) {
      throw insertedVideo.error || new Error("Failed to create cycle-day source video.");
    }

    const sourceVideoId = (insertedVideo.data as { id: string }).id;

    const planRecord = await supabase
      .from("video_recreation_plans")
      .insert({
        collection_id: collectionId,
        format_id: formatRow.id,
        source_video_id: sourceVideoId,
        app_name: appName,
        plan_payload: {
          reasoningModel,
          ugcCharacterId: ugcCharacter?.id || null,
          generatedAt: new Date().toISOString(),
          sourceType: "cycle_day_agent",
          cycleDayAgent: {
            cyclePlanId: cyclePlan.id,
            cyclePlanNumber: cyclePlan.plan_number,
            cycleDayNumber: cycleDayData.dayNumber,
          },
          plan,
        },
      })
      .select("id")
      .single();

    if (planRecord.error || !planRecord.data) {
      throw planRecord.error || new Error("Failed to save cycle-day script plan.");
    }

    return NextResponse.json({
      plan,
      cycleContext: {
        cyclePlanId: cyclePlan.id,
        cyclePlanNumber: cyclePlan.plan_number,
        cycleDayNumber: cycleDayData.dayNumber,
      },
      saved: {
        formatId: formatRow.id,
        sourceVideoId,
        planId: (planRecord.data as { id: string }).id,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate cycle-day script plan." },
      { status: 500 }
    );
  }
}
