import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_CAROUSEL_IMAGE_MODEL,
  type CarouselSlide,
  generateSingleCarouselSlideImage,
} from "@/lib/carousel-agent";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isImageGenerationModel,
} from "@/lib/image-generation-model";
import { supabase } from "@/lib/supabase";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function asSlideRole(value: unknown): CarouselSlide["role"] {
  if (
    value === "primary_hook" ||
    value === "secondary_hook" ||
    value === "insight" ||
    value === "action" ||
    value === "proof" ||
    value === "cta"
  ) {
    return value;
  }
  return "insight";
}

function asSlideDensity(value: unknown): CarouselSlide["density"] {
  return value === "dense" ? "dense" : "light";
}

function toCarouselSlide(slide: Record<string, unknown>, fallbackSlideNumber: number): CarouselSlide {
  const slideNumber =
    typeof slide.slide_number === "number"
      ? slide.slide_number
      : typeof slide.slideNumber === "number"
        ? slide.slideNumber
        : fallbackSlideNumber;

  return {
    slideNumber,
    role: asSlideRole(slide.role),
    density: asSlideDensity(slide.density),
    overlayTitle:
      asNonEmptyString(slide.overlay_title) || asNonEmptyString(slide.overlayTitle) || `Slide ${slideNumber}`,
    overlayLines: asStringArray(slide.overlay_lines ?? slide.overlayLines),
    headline: asNonEmptyString(slide.headline) || `Slide ${slideNumber}`,
    bodyBullets: asStringArray(slide.body_bullets ?? slide.bodyBullets),
    voiceScript: asNonEmptyString(slide.voice_script) || asNonEmptyString(slide.voiceScript) || "",
    hookPurpose: asNonEmptyString(slide.hook_purpose) || asNonEmptyString(slide.hookPurpose) || "",
    capsWords: asStringArray(slide.caps_words ?? slide.capsWords),
    visualDirection:
      asNonEmptyString(slide.visual_direction) || asNonEmptyString(slide.visualDirection) || "Clean editorial layout",
    imagePrompt:
      asNonEmptyString(slide.image_prompt) ||
      asNonEmptyString(slide.imagePrompt) ||
      "Premium editorial carousel background",
    altText: asNonEmptyString(slide.alt_text) || asNonEmptyString(slide.altText) || `Slide ${slideNumber}`,
    imageUrl: asNonEmptyString(slide.image_url) || asNonEmptyString(slide.imageUrl) || undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asNonEmptyString(body.collectionId);
    const generationId = asNonEmptyString(body.generationId);
    const slideNumber = asPositiveInteger(body.slideNumber);
    const imageModel = isImageGenerationModel(body.imageGenerationModel)
      ? body.imageGenerationModel
      : DEFAULT_CAROUSEL_IMAGE_MODEL || DEFAULT_IMAGE_GENERATION_MODEL;

    if (!collectionId || !generationId || !slideNumber) {
      return NextResponse.json(
        { error: "Collection ID, generation ID, and slide number are required." },
        { status: 400 }
      );
    }

    const generationQuery = await supabase
      .from("carousel_agent_generations")
      .select("id, collection_id, topic, payload")
      .eq("id", generationId)
      .eq("collection_id", collectionId)
      .single();

    if (generationQuery.error || !generationQuery.data) {
      return NextResponse.json({ error: "Saved carousel generation not found." }, { status: 404 });
    }

    const generationRow = generationQuery.data as Record<string, unknown>;
    const topic = asNonEmptyString(generationRow.topic) || "Carousel";

    const slidesQuery = await supabase
      .from("carousel_agent_generation_slides")
      .select(
        "slide_number, role, density, overlay_title, overlay_lines, headline, body_bullets, voice_script, hook_purpose, caps_words, visual_direction, image_prompt, alt_text, image_url"
      )
      .eq("generation_id", generationId)
      .eq("collection_id", collectionId)
      .order("slide_number", { ascending: true });

    const slideRows = Array.isArray(slidesQuery.data)
      ? (slidesQuery.data as Array<Record<string, unknown>>)
      : [];

    const payload =
      typeof generationRow.payload === "object" && generationRow.payload !== null
        ? (generationRow.payload as Record<string, unknown>)
        : null;
    const payloadSlides = payload && Array.isArray(payload.slides)
      ? payload.slides.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      : [];

    const sourceSlides = slideRows.length > 0 ? slideRows : payloadSlides;
    const totalSlides = sourceSlides.length;

    if (totalSlides === 0) {
      return NextResponse.json({ error: "No slides found for this generation." }, { status: 400 });
    }

    const selectedRawSlide = sourceSlides.find((slide) => {
      const rowSlideNumber =
        typeof slide.slide_number === "number"
          ? slide.slide_number
          : typeof slide.slideNumber === "number"
            ? slide.slideNumber
            : null;
      return rowSlideNumber === slideNumber;
    });

    if (!selectedRawSlide) {
      return NextResponse.json({ error: "Slide not found in this generation." }, { status: 404 });
    }

    const selectedSlide = toCarouselSlide(selectedRawSlide, slideNumber);

    const imageUrl = await generateSingleCarouselSlideImage({
      collectionId,
      generationId,
      topic,
      totalSlides,
      slide: selectedSlide,
      imageModel,
    });

    const { error: updateSlideError } = await supabase
      .from("carousel_agent_generation_slides")
      .update({ image_url: imageUrl })
      .eq("generation_id", generationId)
      .eq("collection_id", collectionId)
      .eq("slide_number", slideNumber);

    if (updateSlideError) {
      throw updateSlideError;
    }

    const nextPayload = payload
      ? {
        ...payload,
        slides: sourceSlides.map((slide) => {
          const currentSlideNumber =
            typeof slide.slide_number === "number"
              ? slide.slide_number
              : typeof slide.slideNumber === "number"
                ? slide.slideNumber
                : null;

          if (currentSlideNumber !== slideNumber) return slide;
          return {
            ...slide,
            imageUrl,
            image_url: imageUrl,
          };
        }),
      }
      : null;

    const { error: updateGenerationError } = await supabase
      .from("carousel_agent_generations")
      .update({
        generated_images: true,
        payload: nextPayload || generationRow.payload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", generationId)
      .eq("collection_id", collectionId);

    if (updateGenerationError) throw updateGenerationError;

    return NextResponse.json({
      generationId,
      slideNumber,
      imageModel,
      imageUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate carousel image for this slide.",
      },
      { status: 500 }
    );
  }
}
