import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_REASONING_MODEL,
  isReasoningModel,
  type ReasoningModel,
} from "@/lib/reasoning-model";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isImageGenerationModel,
  type ImageGenerationModel,
} from "@/lib/image-generation-model";
import { generateImage } from "@/lib/gemini-image";

export const runtime = "nodejs";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || "");
const DEFAULT_UGC_IMAGE_MODEL: ImageGenerationModel = "gemini-3-pro-image-preview";

type CollectionRow = {
  id: string;
  app_name: string | null;
  app_description: string | null;
  app_context?: string | null;
};

type VideoUgcCharacterRow = {
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
  is_default: boolean | null;
  created_at: string;
  updated_at: string;
};

type VideoUgcCharacterAngleRow = {
  id: string;
  collection_id: string;
  character_id: string;
  angle_key: string;
  angle_label: string;
  angle_prompt: string;
  image_url: string;
  image_model: string | null;
  created_at: string;
  updated_at: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
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
  return `${message} ${details}`.includes("column") && `${message} ${details}`.includes(columnName.toLowerCase());
}

function cleanText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
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

async function generateCharacterProfile(
  appName: string,
  appContext: string,
  reasoningModel: ReasoningModel
): Promise<{
  characterName: string;
  personaSummary: string;
  visualStyle: string;
  wardrobeNotes: string;
  voiceTone: string;
  promptTemplate: string;
  identityAnchors: string[];
  realismDirectives: string[];
}> {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    throw new Error("GOOGLE_GEMINI_API_KEY is missing.");
  }

  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const prompt = `You are defining one recurring UGC AI character for a Muslim women app brand.

APP:
- Name: ${appName}
- Context: ${appContext || "N/A"}

TASK:
- Create one reusable, brand-safe UGC persona.
- Keep tone practical, warm, and faith-aware.
- Keep styling modest and contemporary.
- Avoid stereotypes.
- The character must feel like a REAL person, not a polished AI model.
- Make the persona visually recognizable with stable unique markers.
- Avoid overly perfect, doll-like, hyper-symmetrical beauty language.

Return strict JSON only:
{
  "characterName": "string",
  "personaSummary": "string",
  "visualStyle": "string",
  "wardrobeNotes": "string",
  "voiceTone": "string",
  "promptTemplate": "single continuity sentence for all Higgsfield prompts",
  "identityAnchors": ["3-5 short distinctive physical/personality markers"],
  "realismDirectives": ["3-5 camera realism constraints"]
}`;

  const result = await model.generateContent(prompt);
  const parsed = parseJsonObject(result.response.text()) || {};

  return {
    characterName: cleanText(parsed.characterName, `${appName} Guide`),
    personaSummary: cleanText(
      parsed.personaSummary,
      "Warm Muslimah lifestyle mentor who shares practical routines with calm confidence."
    ),
    visualStyle: cleanText(
      parsed.visualStyle,
      "Natural soft daylight, clean indoor environment, grounded lifestyle realism."
    ),
    wardrobeNotes: cleanText(
      parsed.wardrobeNotes,
      "Modest contemporary outfit, neutral palette, minimal accessories."
    ),
    voiceTone: cleanText(parsed.voiceTone, "Warm, clear, grounded, reassuring."),
    promptTemplate: cleanText(
      parsed.promptTemplate,
      "Use the same female Muslimah creator identity in every UGC scene: consistent face, modest styling, natural expression, calm confident delivery, realistic movement, and no beauty-filter look."
    ),
    identityAnchors: Array.isArray(parsed.identityAnchors)
      ? parsed.identityAnchors
          .map((item) => cleanText(item))
          .filter(Boolean)
          .slice(0, 5)
      : [
          "Slight asymmetry in smile and brow expression",
          "Subtle natural skin texture with a tiny beauty mark",
          "Soft, grounded eye contact with calm pauses",
        ],
    realismDirectives: Array.isArray(parsed.realismDirectives)
      ? parsed.realismDirectives
          .map((item) => cleanText(item))
          .filter(Boolean)
          .slice(0, 6)
      : [
          "No beauty filter, no airbrushed skin, no CGI sheen",
          "Preserve pores, fine texture, and slight under-eye natural detail",
          "Use documentary smartphone realism and lived-in background",
        ],
  };
}

function toCharacterResponse(row: VideoUgcCharacterRow, angles: VideoUgcCharacterAngleRow[] = []) {
  return {
    id: row.id,
    collectionId: row.collection_id,
    characterName: row.character_name,
    personaSummary: row.persona_summary,
    visualStyle: row.visual_style,
    wardrobeNotes: row.wardrobe_notes,
    voiceTone: row.voice_tone,
    promptTemplate: row.prompt_template,
    referenceImageUrl: row.reference_image_url,
    imageModel: row.image_model,
    isDefault: Boolean(row.is_default),
    angles: angles.map((angle) => ({
      id: angle.id,
      angleKey: angle.angle_key,
      angleLabel: angle.angle_label,
      anglePrompt: angle.angle_prompt,
      imageUrl: angle.image_url,
      imageModel: angle.image_model,
      createdAt: angle.created_at,
      updatedAt: angle.updated_at,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const collectionId = request.nextUrl.searchParams.get("collectionId")?.trim();
    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    let queryResult = await supabase
      .from("video_ugc_characters")
      .select("*")
      .eq("collection_id", collectionId)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });

    if (queryResult.error && isMissingColumnError(queryResult.error, "is_default")) {
      queryResult = await supabase
        .from("video_ugc_characters")
        .select("*")
        .eq("collection_id", collectionId)
        .order("updated_at", { ascending: false });
    }

    const { data, error } = queryResult;

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json(
          {
            error:
              "UGC characters table is missing. Run the video-agent SQL migration first (see supabase-migration.sql).",
          },
          { status: 500 }
        );
      }
      throw error;
    }

    const rows = Array.isArray(data) ? (data as unknown as VideoUgcCharacterRow[]) : [];

    const { data: angleData, error: angleError } = await supabase
      .from("video_ugc_character_angles")
      .select("*")
      .eq("collection_id", collectionId)
      .order("created_at", { ascending: false });

    if (angleError && !isMissingTableError(angleError)) {
      throw angleError;
    }

    const angles = Array.isArray(angleData) ? (angleData as unknown as VideoUgcCharacterAngleRow[]) : [];
    const anglesByCharacter = new Map<string, VideoUgcCharacterAngleRow[]>();

    for (const angle of angles) {
      if (!anglesByCharacter.has(angle.character_id)) {
        anglesByCharacter.set(angle.character_id, []);
      }
      anglesByCharacter.get(angle.character_id)?.push(angle);
    }

    return NextResponse.json({
      characters: rows.map((row) => toCharacterResponse(row, anglesByCharacter.get(row.id) || [])),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load UGC characters." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const setAsDefault = asBoolean(body.setAsDefault, true);
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;
    const imageModel = isImageGenerationModel(body.imageGenerationModel)
      ? body.imageGenerationModel
      : DEFAULT_UGC_IMAGE_MODEL || DEFAULT_IMAGE_GENERATION_MODEL;

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    const collection = await fetchCollectionRow(collectionId);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found." }, { status: 404 });
    }

    const appName = (collection.app_name || "Muslimah Pro").trim() || "Muslimah Pro";
    const appContext = (collection.app_description || collection.app_context || "").trim();
    const profile = await generateCharacterProfile(appName, appContext, reasoningModel);

    const imagePrompt = [
      `Create a high-quality photorealistic portrait reference image for a recurring UGC creator persona named ${profile.characterName}.`,
      profile.promptTemplate,
      `Persona: ${profile.personaSummary}.`,
      `Visual style: ${profile.visualStyle}.`,
      `Wardrobe: ${profile.wardrobeNotes}.`,
      `Identity anchors: ${profile.identityAnchors.join("; ")}.`,
      `Realism directives: ${profile.realismDirectives.join("; ")}.`,
      "Vertical 9:16, upper-body framing, natural lighting, documentary smartphone realism, lived-in authentic background, realistic skin texture with pores and minor imperfections, slight facial asymmetry, flyaway hair strands, no text overlay.",
      "NEGATIVE: plastic skin, porcelain face, hyper-symmetry, uncanny eyes, glossy CGI skin, beauty filter, fashion-magazine retouch.",
    ].join(" ");

    const referenceImageUrl = await generateImage(imagePrompt, {
      collectionId,
      platform: "instagram",
      imageModel,
    });

    if (setAsDefault) {
      const { error: resetError } = await supabase
        .from("video_ugc_characters")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq("collection_id", collectionId);

      if (resetError && isMissingColumnError(resetError, "is_default")) {
        return NextResponse.json(
          {
            error:
              "UGC characters table needs latest migration (missing is_default). Run supabase-migration.sql and try again.",
          },
          { status: 500 }
        );
      }

      if (resetError && !isMissingTableError(resetError)) {
        throw resetError;
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from("video_ugc_characters")
      .insert({
        collection_id: collectionId,
        character_name: profile.characterName,
        persona_summary: profile.personaSummary,
        visual_style: profile.visualStyle,
        wardrobe_notes: profile.wardrobeNotes,
        voice_tone: profile.voiceTone,
        prompt_template: `${profile.promptTemplate} Identity anchors: ${profile.identityAnchors.join("; ")}. Realism directives: ${profile.realismDirectives.join("; ")}.`,
        reference_image_url: referenceImageUrl,
        image_model: imageModel,
        is_default: setAsDefault,
      })
      .select("*")
      .single();

    if (insertError) {
      if (isMissingColumnError(insertError, "is_default")) {
        return NextResponse.json(
          {
            error:
              "UGC characters table needs latest migration (missing is_default). Run supabase-migration.sql and try again.",
          },
          { status: 500 }
        );
      }

      if (isMissingTableError(insertError)) {
        return NextResponse.json(
          {
            error:
              "UGC characters table is missing. Run the video-agent SQL migration first (see supabase-migration.sql).",
          },
          { status: 500 }
        );
      }
      throw insertError;
    }

    return NextResponse.json({
      character: toCharacterResponse(inserted as unknown as VideoUgcCharacterRow),
      imageModel,
      reasoningModel,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create UGC character." },
      { status: 500 }
    );
  }
}
