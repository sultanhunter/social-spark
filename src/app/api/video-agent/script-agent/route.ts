import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  buildVideoScriptIdeationPlan,
  stripMultiShotPromptsFromIdeationPlan,
  type ScriptAgentCampaignMode,
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
  is_default?: boolean | null;
};

type VideoFormatRow = {
  id: string;
  collection_id: string;
  format_name: string;
  format_type: string;
  format_signature: string;
  summary: string;
  why_it_works: string[] | null;
  hook_patterns: string[] | null;
  shot_pattern: string[] | null;
  editing_style: string[] | null;
  script_scaffold: string | null;
  higgsfield_prompt_template: string | null;
  recreation_checklist: string[] | null;
  duration_guidance: string | null;
  confidence: number | null;
  source_count: number | null;
  latest_source_url: string | null;
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

function normalizeVideoType(value: unknown): ScriptAgentVideoType | "auto" {
  if (typeof value !== "string") return "auto";
  const cleaned = value.trim().toLowerCase();
  if (cleaned === "ugc") return "ugc";
  if (cleaned === "ai_animation" || cleaned === "animation" || cleaned === "ai-animation") return "ai_animation";
  if (cleaned === "faceless_broll" || cleaned === "faceless" || cleaned === "broll" || cleaned === "b-roll") {
    return "faceless_broll";
  }
  if (cleaned === "hybrid") return "hybrid";
  return "auto";
}

function normalizeCampaignMode(value: unknown): ScriptAgentCampaignMode {
  if (typeof value !== "string") return "standard";
  const cleaned = value.trim().toLowerCase();
  if (cleaned === "widget_reaction_ugc" || cleaned === "widget-reaction-ugc") {
    return "widget_reaction_ugc";
  }
  if (
    cleaned === "widget_shock_hook_ugc" ||
    cleaned === "widget-shock-hook-ugc" ||
    cleaned === "shock_widget_reaction_ugc" ||
    cleaned === "shock-widget-reaction-ugc"
  ) {
    return "widget_shock_hook_ugc";
  }
  if (
    cleaned === "widget_late_period_reaction_hook_ugc" ||
    cleaned === "widget-late-period-reaction-hook-ugc" ||
    cleaned === "late_period_reaction_hook_ugc" ||
    cleaned === "late-period-reaction-hook-ugc" ||
    cleaned === "late_period_reaction_ugc" ||
    cleaned === "late-period-reaction-ugc"
  ) {
    return "widget_late_period_reaction_hook_ugc";
  }
  if (
    cleaned === "ai_objects_educational_explainer" ||
    cleaned === "ai-objects-educational-explainer" ||
    cleaned === "ai_objects_explainer" ||
    cleaned === "ai-objects-explainer" ||
    cleaned === "cute_ai_objects_explainer" ||
    cleaned === "cute-ai-objects-explainer"
  ) {
    return "ai_objects_educational_explainer";
  }
  if (
    cleaned === "daily_ugc_quran_journey" ||
    cleaned === "daily-ugc-quran-journey" ||
    cleaned === "daily_ugc_quran" ||
    cleaned === "daily-ugc-quran"
  ) {
    return "daily_ugc_quran_journey";
  }
  return "standard";
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
    const topicBrief = asText(body.topicBrief);
    const preferredVideoType = normalizeVideoType(body.preferredVideoType);
    const campaignMode = normalizeCampaignMode(body.campaignMode);
    const selectedCharacterId = asText(body.characterId);
    const targetDurationSeconds = asFiniteNumber(body.targetDurationSeconds);
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

    let ugcCharacter: UGCCharacterProfile | null = null;
    const campaignNeedsUgcCharacter =
      campaignMode === "widget_reaction_ugc" ||
      campaignMode === "widget_shock_hook_ugc" ||
      campaignMode === "widget_late_period_reaction_hook_ugc" ||
      campaignMode === "daily_ugc_quran_journey";
    const shouldResolveCharacter =
      Boolean(selectedCharacterId) ||
      preferredVideoType === "ugc" ||
      preferredVideoType === "hybrid" ||
      campaignNeedsUgcCharacter;

    if (shouldResolveCharacter) {
      const fullSelect =
        "id, character_name, persona_summary, visual_style, wardrobe_notes, voice_tone, prompt_template, reference_image_url, image_model, is_default";

      let characterResult = selectedCharacterId
        ? await supabase
          .from("video_ugc_characters")
          .select(fullSelect)
          .eq("collection_id", collectionId)
          .eq("id", selectedCharacterId)
          .maybeSingle()
        : await supabase
          .from("video_ugc_characters")
          .select(fullSelect)
          .eq("collection_id", collectionId)
          .eq("is_default", true)
          .maybeSingle();

      if (characterResult.error && isMissingColumnError(characterResult.error, "is_default")) {
        characterResult = selectedCharacterId
          ? await supabase
            .from("video_ugc_characters")
            .select("id, character_name, persona_summary, visual_style, wardrobe_notes, voice_tone, prompt_template, reference_image_url, image_model")
            .eq("collection_id", collectionId)
            .eq("id", selectedCharacterId)
            .maybeSingle()
          : await supabase
            .from("video_ugc_characters")
            .select("id, character_name, persona_summary, visual_style, wardrobe_notes, voice_tone, prompt_template, reference_image_url, image_model")
            .eq("collection_id", collectionId)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
      }

      if (selectedCharacterId && !characterResult.data) {
        return NextResponse.json(
          { error: "Selected character not found for this collection." },
          { status: 404 }
        );
      }

      if (characterResult.data) {
        ugcCharacter = toUgcCharacterProfile(characterResult.data as unknown as VideoUgcCharacterRow);
      }
    }

    const appName = (collection.app_name || "Muslimah Pro").trim() || "Muslimah Pro";
    const appContext = (collection.app_description || collection.app_context || "").trim();

    const planDraft = await buildVideoScriptIdeationPlan({
      appName,
      appContext,
      topicBrief,
      targetDurationSeconds: targetDurationSeconds ?? 75,
      preferredVideoType,
      campaignMode,
      ugcCharacter,
      reasoningModel,
    });
    const plan = stripMultiShotPromptsFromIdeationPlan(planDraft);

    const formatSignature = `script_agent_${plan.campaignMode}_${plan.topicCategory}_${plan.selectedVideoType}`;
    const generatedSourceUrl = `script-agent://${collectionId}/${Date.now()}-${randomUUID().slice(0, 8)}`;
    const mappedFormatType = mapScriptAgentVideoTypeToFormatType(plan.selectedVideoType);
    const formatName = `Script Agent - ${toTitleCase(plan.campaignMode)} - ${toTitleCase(plan.topicCategory)} - ${toTitleCase(plan.selectedVideoType)}`;

    let formatRow: VideoFormatRow | null = null;

    const existingFormat = await supabase
      .from("video_formats")
      .select("*")
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
          editing_style: [plan.selectedVideoType.replace(/_/g, " "), "script agent generated"],
          script_scaffold: plan.script.hook,
          higgsfield_prompt_template: plan.motionControlSegments[0]?.veoPrompt || "",
          recreation_checklist: plan.qaChecklist,
          duration_guidance: `${plan.targetDurationSeconds}s target`,
          confidence: 0.84,
          source_count: nextSourceCount,
          latest_source_url: generatedSourceUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("collection_id", collectionId)
        .select("*")
        .single();

      if (updatedFormat.error || !updatedFormat.data) {
        throw updatedFormat.error || new Error("Failed to update script-agent format.");
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
          editing_style: [plan.selectedVideoType.replace(/_/g, " "), "script agent generated"],
          script_scaffold: plan.script.hook,
          higgsfield_prompt_template: plan.motionControlSegments[0]?.veoPrompt || "",
          recreation_checklist: plan.qaChecklist,
          duration_guidance: `${plan.targetDurationSeconds}s target`,
          confidence: 0.84,
          source_count: 1,
          latest_source_url: generatedSourceUrl,
        })
        .select("*")
        .single();

      if (insertedFormat.error || !insertedFormat.data) {
        throw insertedFormat.error || new Error("Failed to create script-agent format.");
      }
      formatRow = insertedFormat.data as unknown as VideoFormatRow;
    }

    if (!formatRow) {
      throw new Error("Failed to resolve script-agent format row.");
    }

    const analysisPayload = {
      sourceMetadata: {
        url: generatedSourceUrl,
        platform: "generated",
        title: plan.title,
        description: plan.objective,
        thumbnailUrl: null,
        userNotes: topicBrief || null,
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
        editingStyle: [plan.selectedVideoType.replace(/_/g, " "), "script agent generated"],
        scriptScaffold: plan.script.hook,
        higgsfieldPromptTemplate: plan.motionControlSegments[0]?.veoPrompt || "",
        recreationChecklist: plan.qaChecklist,
        durationGuidance: `${plan.targetDurationSeconds}s target`,
        confidence: 0.84,
      },
      matchDecision: {
        reason: "Script-agent generated source",
      },
      reasoningModel,
      analyzedAt: new Date().toISOString(),
      scriptAgent: {
        topicBrief,
        campaignMode: plan.campaignMode,
        topicCategory: plan.topicCategory,
        selectedVideoType: plan.selectedVideoType,
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
        user_notes: topicBrief || null,
        analysis_confidence: 0.84,
        analysis_payload: analysisPayload,
      })
      .select("id")
      .single();

    if (insertedVideo.error || !insertedVideo.data) {
      throw insertedVideo.error || new Error("Failed to create script-agent source video.");
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
          sourceType: "script_agent",
          plan,
        },
      })
      .select("id")
      .single();

    if (planRecord.error || !planRecord.data) {
      throw planRecord.error || new Error("Failed to save script-agent plan.");
    }

    return NextResponse.json({
      plan,
      meta: {
        topicBrief,
        preferredVideoType,
        campaignMode,
        targetDurationSeconds: targetDurationSeconds ?? 75,
        reasoningModel,
        ugcCharacterId: ugcCharacter?.id || null,
      },
      saved: {
        formatId: formatRow.id,
        sourceVideoId,
        planId: (planRecord.data as { id: string }).id,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate script-agent plan." },
      { status: 500 }
    );
  }
}
