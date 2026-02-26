import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_CAROUSEL_IMAGE_MODEL,
  generateCarouselPack,
} from "@/lib/carousel-agent";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isImageGenerationModel,
} from "@/lib/image-generation-model";
import {
  DEFAULT_REASONING_MODEL,
  isReasoningModel,
} from "@/lib/reasoning-model";
import { supabase } from "@/lib/supabase";

export const maxDuration = 300;

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getCollectionAppContext(collection: unknown): string {
  if (typeof collection !== "object" || collection === null) return "";
  const row = collection as Record<string, unknown>;

  return (
    asNonEmptyString(row.app_description) ||
    asNonEmptyString(row.app_context) ||
    "Muslimah Pro supports Muslim women with faith-centered guidance, period tracking, and pregnancy wellness tools."
  );
}

function toTextArray(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function persistCarouselPack({
  collectionId,
  focus,
  reasoningModel,
  imageGenerationModel,
  generatedImages,
  pack,
}: {
  collectionId: string;
  focus: string;
  reasoningModel: string;
  imageGenerationModel: string;
  generatedImages: boolean;
  pack: Awaited<ReturnType<typeof generateCarouselPack>>;
}): Promise<string> {
  const { data: generationRow, error: generationError } = await supabase
    .from("carousel_agent_generations")
    .insert({
      collection_id: collectionId,
      focus: focus || null,
      topic: pack.topic,
      angle_rationale: pack.angleRationale,
      caption: pack.caption,
      cta: pack.cta,
      hashtags: toTextArray(pack.hashtags),
      strategy_checklist: toTextArray(pack.strategyChecklist),
      spin_off_angles: toTextArray(pack.spinOffAngles),
      reasoning_model: reasoningModel,
      image_model: imageGenerationModel,
      generated_images: generatedImages,
      status: "completed",
      payload: pack,
    })
    .select("id")
    .single();

  if (generationError || !generationRow?.id) {
    const message = generationError?.message || "Failed to save carousel generation.";
    if (message.toLowerCase().includes("carousel_agent_generations")) {
      throw new Error(
        "Missing carousel_agent_generations table. Run the new SQL schema for carousel agent persistence first."
      );
    }
    throw new Error(message);
  }

  const slideRows = pack.slides.map((slide) => ({
    generation_id: generationRow.id,
    collection_id: collectionId,
    slide_number: slide.slideNumber,
    role: slide.role,
    density: slide.density,
    overlay_title: slide.overlayTitle,
    overlay_lines: toTextArray(slide.overlayLines),
    headline: slide.headline,
    body_bullets: toTextArray(slide.bodyBullets),
    voice_script: slide.voiceScript,
    hook_purpose: slide.hookPurpose,
    caps_words: toTextArray(slide.capsWords),
    visual_direction: slide.visualDirection,
    image_prompt: slide.imagePrompt,
    alt_text: slide.altText,
    image_url: slide.imageUrl || null,
  }));

  const { error: slidesError } = await supabase
    .from("carousel_agent_generation_slides")
    .insert(slideRows);

  if (slidesError) {
    const message = slidesError.message || "Failed to save carousel slides.";
    if (message.toLowerCase().includes("carousel_agent_generation_slides")) {
      throw new Error(
        "Missing carousel_agent_generation_slides table. Run the new SQL schema for carousel agent persistence first."
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
      : DEFAULT_CAROUSEL_IMAGE_MODEL || DEFAULT_IMAGE_GENERATION_MODEL;
    const shouldGenerateImages = false;

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

    const appName = asNonEmptyString(collection.app_name) || "Muslimah Pro";
    const appContext = getCollectionAppContext(collection);

    const pack = await generateCarouselPack({
      appName,
      appContext,
      focus,
      reasoningModel,
    });

    const finalPack = pack;

    const generationId = await persistCarouselPack({
      collectionId,
      focus,
      reasoningModel,
      imageGenerationModel,
      generatedImages: shouldGenerateImages,
      pack: finalPack,
    });

    return NextResponse.json({
      generationId,
      model: reasoningModel,
      imageModel: imageGenerationModel,
      generatedImages: shouldGenerateImages,
      pack: finalPack,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate carousel strategy, script, and prompts.",
      },
      { status: 500 }
    );
  }
}
