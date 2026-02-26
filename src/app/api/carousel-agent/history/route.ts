import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asSlideRole(value: unknown):
  | "primary_hook"
  | "secondary_hook"
  | "insight"
  | "action"
  | "proof"
  | "cta" {
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

function asSlideDensity(value: unknown): "dense" | "light" {
  return value === "dense" ? "dense" : "light";
}

function tableMissing(message: string | undefined): boolean {
  const text = (message || "").toLowerCase();
  return text.includes("carousel_agent_generations") || text.includes("carousel_agent_generation_slides");
}

export async function GET(request: NextRequest) {
  try {
    const collectionId = asNonEmptyString(request.nextUrl.searchParams.get("collectionId"));
    if (!collectionId) {
      return NextResponse.json({ error: "Collection ID is required." }, { status: 400 });
    }

    const generationsQuery = await supabase
      .from("carousel_agent_generations")
      .select(
        "id, topic, angle_rationale, caption, cta, hashtags, strategy_checklist, spin_off_angles, reasoning_model, image_model, generated_images, payload, created_at"
      )
      .eq("collection_id", collectionId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (generationsQuery.error) {
      if (tableMissing(generationsQuery.error.message)) {
        return NextResponse.json({ generations: [] });
      }
      throw generationsQuery.error;
    }

    const generationRows = Array.isArray(generationsQuery.data) ? generationsQuery.data : [];
    const generationIds = generationRows
      .map((row) => asNonEmptyString(row.id))
      .filter((value): value is string => Boolean(value));

    let slidesByGenerationId: Record<string, Array<Record<string, unknown>>> = {};

    if (generationIds.length > 0) {
      const slidesQuery = await supabase
        .from("carousel_agent_generation_slides")
        .select(
          "generation_id, slide_number, role, density, overlay_title, overlay_lines, headline, body_bullets, voice_script, hook_purpose, caps_words, visual_direction, image_prompt, alt_text, image_url"
        )
        .in("generation_id", generationIds)
        .order("slide_number", { ascending: true });

      if (slidesQuery.error) {
        if (!tableMissing(slidesQuery.error.message)) {
          throw slidesQuery.error;
        }
      } else {
        const slideRows = Array.isArray(slidesQuery.data) ? slidesQuery.data : [];

        slidesByGenerationId = slideRows.reduce<Record<string, Array<Record<string, unknown>>>>((acc, row) => {
          const generationId = asNonEmptyString(row.generation_id);
          if (!generationId) return acc;
          if (!acc[generationId]) acc[generationId] = [];
          acc[generationId].push(row as Record<string, unknown>);
          return acc;
        }, {});
      }
    }

    const generations = generationRows.map((row) => {
      const generationId = asNonEmptyString(row.id) || "";
      const payload = typeof row.payload === "object" && row.payload !== null
        ? (row.payload as Record<string, unknown>)
        : null;

      const persistedSlides = slidesByGenerationId[generationId] || [];
      const payloadSlides = payload && Array.isArray(payload.slides)
        ? payload.slides.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        : [];

      const slides = (persistedSlides.length > 0 ? persistedSlides : payloadSlides).map((slide, index) => ({
        slideNumber:
          typeof slide.slide_number === "number"
            ? slide.slide_number
            : typeof slide.slideNumber === "number"
              ? slide.slideNumber
              : index + 1,
        role: asSlideRole(slide.role),
        density: asSlideDensity(slide.density),
        overlayTitle: asNonEmptyString(slide.overlay_title) || asNonEmptyString(slide.overlayTitle) || "",
        overlayLines: asStringArray(slide.overlay_lines ?? slide.overlayLines),
        headline: asNonEmptyString(slide.headline) || "",
        bodyBullets: asStringArray(slide.body_bullets ?? slide.bodyBullets),
        voiceScript: asNonEmptyString(slide.voice_script) || asNonEmptyString(slide.voiceScript) || "",
        hookPurpose: asNonEmptyString(slide.hook_purpose) || asNonEmptyString(slide.hookPurpose) || "",
        capsWords: asStringArray(slide.caps_words ?? slide.capsWords),
        visualDirection: asNonEmptyString(slide.visual_direction) || asNonEmptyString(slide.visualDirection) || "",
        imagePrompt: asNonEmptyString(slide.image_prompt) || asNonEmptyString(slide.imagePrompt) || "",
        altText: asNonEmptyString(slide.alt_text) || asNonEmptyString(slide.altText) || "",
        imageUrl: asNonEmptyString(slide.image_url) || asNonEmptyString(slide.imageUrl) || undefined,
      }));

      return {
        generationId,
        createdAt: asNonEmptyString(row.created_at) || new Date().toISOString(),
        model: asNonEmptyString(row.reasoning_model) || "",
        imageModel: asNonEmptyString(row.image_model) || "",
        generatedImages: row.generated_images !== false,
        pack: {
          topic: asNonEmptyString(row.topic) || asNonEmptyString(payload?.topic) || "",
          angleRationale:
            asNonEmptyString(row.angle_rationale) || asNonEmptyString(payload?.angleRationale) || "",
          caption: asNonEmptyString(row.caption) || asNonEmptyString(payload?.caption) || "",
          cta: asNonEmptyString(row.cta) || asNonEmptyString(payload?.cta) || "",
          hashtags: asStringArray(row.hashtags).length > 0 ? asStringArray(row.hashtags) : asStringArray(payload?.hashtags),
          strategyChecklist:
            asStringArray(row.strategy_checklist).length > 0
              ? asStringArray(row.strategy_checklist)
              : asStringArray(payload?.strategyChecklist),
          spinOffAngles:
            asStringArray(row.spin_off_angles).length > 0
              ? asStringArray(row.spin_off_angles)
              : asStringArray(payload?.spinOffAngles),
          slides,
        },
      };
    });

    return NextResponse.json({ generations });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load carousel generation history.",
      },
      { status: 500 }
    );
  }
}
