import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  ISLAMIC_MENSTRUATION_SERIES_KNOWLEDGE,
  type MenstruationSeriesTopic,
} from "@/lib/islamic-menstruation-series-knowledge";
import {
  buildVideoScriptIdeationPlan,
  stripMultiShotPromptsFromIdeationPlan,
  type ScriptAgentVideoType,
} from "@/lib/video-agent";
import { DEFAULT_REASONING_MODEL, isReasoningModel } from "@/lib/reasoning-model";

export const runtime = "nodejs";

type CollectionRow = {
  id: string;
  app_name: string | null;
  app_description: string | null;
  app_context?: string | null;
};

type VideoFormatRow = {
  id: string;
  source_count: number | null;
};

type SeriesPlanRow = {
  id: string;
  collection_id: string;
  plan_number: number;
  episode_id: string;
  episode_title: string;
  phase: string;
  target_duration_seconds: number;
  reasoning_model: string | null;
  custom_focus: string | null;
  format_id: string | null;
  source_video_id: string | null;
  recreation_plan_id: string | null;
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

function getTopicById(episodeId: string): MenstruationSeriesTopic | null {
  return ISLAMIC_MENSTRUATION_SERIES_KNOWLEDGE.topics.find((topic) => topic.id === episodeId) || null;
}

function buildEpisodeTopicBrief(topic: MenstruationSeriesTopic): string {
  return [
    `Series episode: ${topic.title}.`,
    `Phase: ${topic.phase}.`,
    `Learning goal: ${topic.learningGoal}.`,
    `Key points: ${topic.keyPoints.join(" ")}.`,
    `Certainty tags to state in script: ${topic.certaintyTags.join(", ")}.`,
    `Source notes: ${topic.sourceNotes.join(" ")}.`,
    "Presentation style: engaging 3D animated explainer with cool graphics, timeline cards, and simple visual metaphors.",
    "Tone: warm teacher, supportive, clear, non-judgmental.",
    "Important: clearly separate consensus from disputed rulings.",
    "Include one practical action and one scholar-consult caveat where ambiguity is high.",
  ].join(" ");
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

export async function GET(request: NextRequest) {
  try {
    const collectionId = asText(request.nextUrl.searchParams.get("collectionId"));
    const limitParam = Number(request.nextUrl.searchParams.get("limit") || "30");
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(200, Math.round(limitParam))) : 30;

    if (!collectionId) {
      return NextResponse.json({
        series: ISLAMIC_MENSTRUATION_SERIES_KNOWLEDGE,
        documentationPath: "docs/islamic-menstruation-series-research.md",
      });
    }

    const result = await supabase
      .from("video_islamic_menstruation_series_plans")
      .select("id, collection_id, plan_number, episode_id, episode_title, phase, target_duration_seconds, reasoning_model, custom_focus, format_id, source_video_id, recreation_plan_id, plan_payload, created_at, updated_at")
      .eq("collection_id", collectionId)
      .order("plan_number", { ascending: false })
      .limit(limit);

    if (result.error) {
      if (isMissingTableError(result.error)) {
        return NextResponse.json({
          series: ISLAMIC_MENSTRUATION_SERIES_KNOWLEDGE,
          documentationPath: "docs/islamic-menstruation-series-research.md",
          savedPlans: [],
          warning: "Table video_islamic_menstruation_series_plans is missing. Run latest Supabase migration.",
        });
      }
      throw result.error;
    }

    const savedPlans = (result.data || []).map((row) => {
      const typed = row as unknown as SeriesPlanRow;
      return {
        id: typed.id,
        planNumber: typed.plan_number,
        episodeId: typed.episode_id,
        episodeTitle: typed.episode_title,
        phase: typed.phase,
        targetDurationSeconds: typed.target_duration_seconds,
        reasoningModel: typed.reasoning_model,
        customFocus: typed.custom_focus,
        formatId: typed.format_id,
        sourceVideoId: typed.source_video_id,
        recreationPlanId: typed.recreation_plan_id,
        createdAt: typed.created_at,
        updatedAt: typed.updated_at,
      };
    });

    return NextResponse.json({
      series: ISLAMIC_MENSTRUATION_SERIES_KNOWLEDGE,
      documentationPath: "docs/islamic-menstruation-series-research.md",
      savedPlans,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load Islamic menstruation series data." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const episodeId = asText(body.episodeId);
    const customFocus = asText(body.customFocus);
    const targetDurationSeconds = asFiniteNumber(body.targetDurationSeconds) ?? 150;
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

    const latestSeriesPlan = await supabase
      .from("video_islamic_menstruation_series_plans")
      .select("plan_number")
      .eq("collection_id", collectionId)
      .order("plan_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestSeriesPlan.error) {
      if (isMissingTableError(latestSeriesPlan.error)) {
        return NextResponse.json(
          { error: "Table video_islamic_menstruation_series_plans is missing. Run latest Supabase migration first." },
          { status: 500 }
        );
      }
      throw latestSeriesPlan.error;
    }

    const fallbackTopic = ISLAMIC_MENSTRUATION_SERIES_KNOWLEDGE.topics[0] || null;
    const selectedTopic = (episodeId ? getTopicById(episodeId) : null) || fallbackTopic;

    if (!selectedTopic) {
      return NextResponse.json({ error: "No series topics are available." }, { status: 500 });
    }

    const appName = (collection.app_name || "Muslimah Pro").trim() || "Muslimah Pro";
    const appContext = (collection.app_description || collection.app_context || "").trim() ||
      "Period and pregnancy tracking app for Muslim women with fiqh-aware worship guidance.";

    const topicBrief = [
      buildEpisodeTopicBrief(selectedTopic),
      customFocus ? `Custom focus from user: ${customFocus}.` : "",
      "Runtime target: about 2 minutes and 30 seconds.",
      "This is a series episode, so end with a one-line teaser for the next lesson.",
    ].filter(Boolean).join(" ");

    const planDraft = await buildVideoScriptIdeationPlan({
      appName,
      appContext,
      topicBrief,
      targetDurationSeconds,
      preferredVideoType: "ai_animation",
      campaignMode: "standard",
      reasoningModel,
    });

    const plan = stripMultiShotPromptsFromIdeationPlan(planDraft);

    const formatSignature = `islamic_series_${selectedTopic.id}_${plan.selectedVideoType}`;
    const generatedSourceUrl = `islamic-series-agent://${collectionId}/${Date.now()}-${randomUUID().slice(0, 8)}`;
    const mappedFormatType = mapScriptAgentVideoTypeToFormatType(plan.selectedVideoType);
    const formatName = `Islamic Series - ${selectedTopic.title} - ${toTitleCase(plan.selectedVideoType)}`;

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
          editing_style: [plan.selectedVideoType.replace(/_/g, " "), "islamic series agent generated"],
          script_scaffold: plan.script.hook,
          higgsfield_prompt_template: plan.motionControlSegments[0]?.veoPrompt || "",
          recreation_checklist: plan.qaChecklist,
          duration_guidance: `${plan.targetDurationSeconds}s target`,
          confidence: 0.9,
          source_count: nextSourceCount,
          latest_source_url: generatedSourceUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("collection_id", collectionId)
        .select("id, source_count")
        .single();

      if (updatedFormat.error || !updatedFormat.data) {
        throw updatedFormat.error || new Error("Failed to update islamic-series format.");
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
          editing_style: [plan.selectedVideoType.replace(/_/g, " "), "islamic series agent generated"],
          script_scaffold: plan.script.hook,
          higgsfield_prompt_template: plan.motionControlSegments[0]?.veoPrompt || "",
          recreation_checklist: plan.qaChecklist,
          duration_guidance: `${plan.targetDurationSeconds}s target`,
          confidence: 0.9,
          source_count: 1,
          latest_source_url: generatedSourceUrl,
        })
        .select("id, source_count")
        .single();

      if (insertedFormat.error || !insertedFormat.data) {
        throw insertedFormat.error || new Error("Failed to create islamic-series format.");
      }
      formatRow = insertedFormat.data as unknown as VideoFormatRow;
    }

    if (!formatRow) {
      throw new Error("Failed to resolve islamic-series format row.");
    }

    const analysisPayload = {
      sourceMetadata: {
        url: generatedSourceUrl,
        platform: "generated",
        title: plan.title,
        description: plan.objective,
        thumbnailUrl: null,
        userNotes: customFocus || null,
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
        editingStyle: [plan.selectedVideoType.replace(/_/g, " "), "islamic series agent generated"],
        scriptScaffold: plan.script.hook,
        higgsfieldPromptTemplate: plan.motionControlSegments[0]?.veoPrompt || "",
        recreationChecklist: plan.qaChecklist,
        durationGuidance: `${plan.targetDurationSeconds}s target`,
        confidence: 0.9,
      },
      matchDecision: {
        reason: "Islamic menstruation series agent generated source",
      },
      reasoningModel,
      analyzedAt: new Date().toISOString(),
      islamicMenstruationSeriesAgent: {
        seriesId: ISLAMIC_MENSTRUATION_SERIES_KNOWLEDGE.seriesId,
        episodeId: selectedTopic.id,
        phase: selectedTopic.phase,
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
        user_notes: customFocus || null,
        analysis_confidence: 0.9,
        analysis_payload: analysisPayload,
      })
      .select("id")
      .single();

    if (insertedVideo.error || !insertedVideo.data) {
      throw insertedVideo.error || new Error("Failed to create islamic-series source video.");
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
          generatedAt: new Date().toISOString(),
          sourceType: "islamic_menstruation_series_agent",
          islamicMenstruationSeriesAgent: {
            seriesId: ISLAMIC_MENSTRUATION_SERIES_KNOWLEDGE.seriesId,
            episodeId: selectedTopic.id,
            phase: selectedTopic.phase,
          },
          plan,
        },
      })
      .select("id")
      .single();

    if (planRecord.error || !planRecord.data) {
      throw planRecord.error || new Error("Failed to save islamic-series recreation plan.");
    }

    const nextPlanNumber = (latestSeriesPlan.data?.plan_number || 0) + 1;

    const insertedSeriesPlan = await supabase
      .from("video_islamic_menstruation_series_plans")
      .insert({
        collection_id: collectionId,
        plan_number: nextPlanNumber,
        episode_id: selectedTopic.id,
        episode_title: selectedTopic.title,
        phase: selectedTopic.phase,
        target_duration_seconds: plan.targetDurationSeconds,
        reasoning_model: reasoningModel,
        custom_focus: customFocus || null,
        format_id: formatRow.id,
        source_video_id: sourceVideoId,
        recreation_plan_id: (planRecord.data as { id: string }).id,
        plan_payload: {
          generatedAt: new Date().toISOString(),
          episode: selectedTopic,
          plan,
        },
      })
      .select("id, plan_number, created_at")
      .single();

    if (insertedSeriesPlan.error || !insertedSeriesPlan.data) {
      throw insertedSeriesPlan.error || new Error("Failed to save islamic-series episode record.");
    }

    return NextResponse.json({
      series: ISLAMIC_MENSTRUATION_SERIES_KNOWLEDGE,
      documentationPath: "docs/islamic-menstruation-series-research.md",
      episode: selectedTopic,
      plan,
      saved: {
        seriesPlanId: (insertedSeriesPlan.data as { id: string }).id,
        planNumber: (insertedSeriesPlan.data as { plan_number: number }).plan_number,
        formatId: formatRow.id,
        sourceVideoId,
        planId: (planRecord.data as { id: string }).id,
        createdAt: (insertedSeriesPlan.data as { created_at: string }).created_at,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate Islamic menstruation series episode." },
      { status: 500 }
    );
  }
}
