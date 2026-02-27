import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_PINTEREST_IMAGE_MODEL,
  generatePinterestPinPack,
} from "@/lib/pinterest-agent";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isImageGenerationModel,
} from "@/lib/image-generation-model";
import {
  DEFAULT_REASONING_MODEL,
  isReasoningModel,
} from "@/lib/reasoning-model";
import { supabase } from "@/lib/supabase";

export const maxDuration = 240;

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getCollectionAppContext(collection: unknown): string {
  if (typeof collection !== "object" || collection === null) return "";
  const row = collection as Record<string, unknown>;

  return (
    asNonEmptyString(row.app_description) ||
    asNonEmptyString(row.app_context) ||
    "A modern app helping users with practical, save-worthy routines and visual guides."
  );
}

async function persistPinterestPinGeneration({
  collectionId,
  focus,
  reasoningModel,
  imageGenerationModel,
  pack,
}: {
  collectionId: string;
  focus: string;
  reasoningModel: string;
  imageGenerationModel: string;
  pack: Awaited<ReturnType<typeof generatePinterestPinPack>>;
}): Promise<string> {
  const { data: generationRow, error: generationError } = await supabase
    .from("pinterest_agent_generations")
    .insert({
      collection_id: collectionId,
      focus: focus || null,
      topic: pack.topic,
      angle_rationale: pack.angleRationale,
      style_theme: pack.styleTheme,
      style_direction: pack.styleDirection,
      script: pack.script,
      image_prompt: pack.imagePrompt,
      alt_text: pack.altText,
      image_url: pack.imageUrl || null,
      reasoning_model: reasoningModel,
      image_model: imageGenerationModel,
      status: "completed",
      payload: pack,
    })
    .select("id")
    .single();

  if (generationError || !generationRow?.id) {
    const message = generationError?.message || "Failed to save Pinterest generation.";
    if (message.toLowerCase().includes("pinterest_agent_generations")) {
      throw new Error(
        "Missing pinterest_agent_generations table. Run the Pinterest agent schema SQL first."
      );
    }
    throw new Error(message);
  }

  return generationRow.id;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asNonEmptyString(body.collectionId);
    const focus = asNonEmptyString(body.focus) || "";
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;
    const imageGenerationModel = isImageGenerationModel(body.imageGenerationModel)
      ? body.imageGenerationModel
      : DEFAULT_PINTEREST_IMAGE_MODEL || DEFAULT_IMAGE_GENERATION_MODEL;

    if (!collectionId) {
      return NextResponse.json({ error: "Collection ID is required." }, { status: 400 });
    }

    const { data: collection, error: collectionError } = await supabase
      .from("collections")
      .select("*")
      .eq("id", collectionId)
      .single();

    if (collectionError || !collection) {
      return NextResponse.json({ error: "Collection not found." }, { status: 404 });
    }

    const appName = asNonEmptyString(collection.app_name) || "SocialSpark App";
    const appContext = getCollectionAppContext(collection);

    const pack = await generatePinterestPinPack({
      appName,
      appContext,
      focus,
      reasoningModel,
    });

    const generationId = await persistPinterestPinGeneration({
      collectionId,
      focus,
      reasoningModel,
      imageGenerationModel,
      pack,
    });

    return NextResponse.json({
      generationId,
      model: reasoningModel,
      imageModel: imageGenerationModel,
      generatedImage: Boolean(pack.imageUrl),
      imageUrl: pack.imageUrl || null,
      pack,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate Pinterest script and image prompt.",
      },
      { status: 500 }
    );
  }
}
