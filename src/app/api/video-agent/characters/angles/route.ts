import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateImage } from "@/lib/gemini-image";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isImageGenerationModel,
} from "@/lib/image-generation-model";

export const runtime = "nodejs";
export const maxDuration = 300;

type CharacterRow = {
  id: string;
  collection_id: string;
  character_name: string;
  persona_summary: string;
  visual_style: string;
  wardrobe_notes: string | null;
  voice_tone: string | null;
  prompt_template: string;
  reference_image_url: string | null;
  image_model: string | null;
};

const ANGLES: Array<{ key: string; label: string; direction: string }> = [
  { key: "front_closeup", label: "Front Close-up", direction: "front-facing close-up portrait with direct eye contact" },
  { key: "three_quarter_left", label: "3/4 Left", direction: "three-quarter left angle, natural shoulder turn" },
  { key: "three_quarter_right", label: "3/4 Right", direction: "three-quarter right angle, natural shoulder turn" },
  { key: "side_profile", label: "Side Profile", direction: "clean side profile with natural expression" },
  { key: "waist_up_talking", label: "Waist-up Talking", direction: "waist-up conversational framing with light hand gesture" },
];

function asPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const cleaned = value.trim().toLowerCase();
    if (cleaned === "true") return true;
    if (cleaned === "false") return false;
  }
  return fallback;
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  return row.code === "42P01";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const characterId = asText(body.characterId);
    const replaceExisting = asBoolean(body.replaceExisting, true);
    const angleCount = asPositiveInt(body.angleCount, 3, 1, ANGLES.length);
    const imageModel = isImageGenerationModel(body.imageGenerationModel)
      ? body.imageGenerationModel
      : DEFAULT_IMAGE_GENERATION_MODEL;

    if (!collectionId || !characterId) {
      return NextResponse.json(
        { error: "collectionId and characterId are required." },
        { status: 400 }
      );
    }

    const { data: characterData, error: characterError } = await supabase
      .from("video_ugc_characters")
      .select("id, collection_id, character_name, persona_summary, visual_style, wardrobe_notes, voice_tone, prompt_template, reference_image_url, image_model")
      .eq("id", characterId)
      .eq("collection_id", collectionId)
      .single();

    if (characterError || !characterData) {
      return NextResponse.json({ error: "Character not found." }, { status: 404 });
    }

    const character = characterData as unknown as CharacterRow;

    if (replaceExisting) {
      const { error: deleteError } = await supabase
        .from("video_ugc_character_angles")
        .delete()
        .eq("collection_id", collectionId)
        .eq("character_id", characterId);

      if (deleteError && !isMissingTableError(deleteError)) {
        throw deleteError;
      }
    }

    const angleRows: Array<Record<string, unknown>> = [];
    const warnings: string[] = [];
    const selectedAngles = ANGLES.slice(0, angleCount);

    for (const angle of selectedAngles) {
      const anglePrompt = [
        `Create a photorealistic character reference image for ${character.character_name}.`,
        `Angle requirement: ${angle.direction}.`,
        `Character lock: ${character.prompt_template}.`,
        `Persona: ${character.persona_summary}.`,
        `Visual style: ${character.visual_style}.`,
        `Wardrobe: ${character.wardrobe_notes || "Modest contemporary neutral styling"}.`,
        "Modesty requirement: if arms are visible, both arms must be fully covered to the wrists with long sleeves.",
        "Keep facial identity consistent with reference image while changing only camera angle.",
        "Documentary realism, natural skin texture, minor imperfections, avoid beauty filter.",
        "NEGATIVE: plastic skin, hyper-symmetry, uncanny perfection, CGI sheen.",
      ].join(" ");

      try {
        const imageUrl = await generateImage(anglePrompt, {
          collectionId,
          platform: "instagram",
          imageModel,
          referenceImageUrls: character.reference_image_url ? [character.reference_image_url] : [],
          uiGenerationMode: "reference_exact",
        });

        angleRows.push({
          collection_id: collectionId,
          character_id: characterId,
          angle_key: angle.key,
          angle_label: angle.label,
          angle_prompt: anglePrompt,
          image_url: imageUrl,
          image_model: imageModel,
          updated_at: new Date().toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown image generation error";
        warnings.push(`${angle.label}: ${message}`);
      }
    }

    if (angleRows.length === 0) {
      return NextResponse.json(
        {
          error: "Failed to generate character angles.",
          details: warnings,
        },
        { status: 500 }
      );
    }

    const { data: inserted, error: insertError } = await supabase
      .from("video_ugc_character_angles")
      .insert(angleRows)
      .select("*");

    if (insertError) {
      if (isMissingTableError(insertError)) {
        return NextResponse.json(
          {
            error:
              "UGC character angles table is missing. Run the latest supabase-migration.sql first.",
          },
          { status: 500 }
        );
      }
      throw insertError;
    }

    return NextResponse.json({
      angles: inserted || [],
      warnings,
      generatedCount: angleRows.length,
      requestedCount: selectedAngles.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate character angles." },
      { status: 500 }
    );
  }
}
