import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  buildVideoScriptIdeationPlan,
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

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
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
    const selectedCharacterId = asText(body.characterId);
    const targetDurationSeconds = asFiniteNumber(body.targetDurationSeconds);
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    if (!topicBrief) {
      return NextResponse.json({ error: "topicBrief is required." }, { status: 400 });
    }

    const collection = await fetchCollectionRow(collectionId);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found." }, { status: 404 });
    }

    let ugcCharacter: UGCCharacterProfile | null = null;
    const shouldResolveCharacter =
      Boolean(selectedCharacterId) || preferredVideoType === "ugc" || preferredVideoType === "hybrid";

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

    const plan = await buildVideoScriptIdeationPlan({
      appName,
      appContext,
      topicBrief,
      targetDurationSeconds: targetDurationSeconds ?? 75,
      preferredVideoType,
      ugcCharacter,
      reasoningModel,
    });

    return NextResponse.json({
      plan,
      meta: {
        topicBrief,
        preferredVideoType,
        targetDurationSeconds: targetDurationSeconds ?? 75,
        reasoningModel,
        ugcCharacterId: ugcCharacter?.id || null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate script-agent plan." },
      { status: 500 }
    );
  }
}
