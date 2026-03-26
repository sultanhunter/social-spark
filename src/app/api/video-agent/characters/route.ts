import { NextRequest, NextResponse } from "next/server";
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

type GeminiInlineImagePart = {
  inlineData: {
    data: string;
    mimeType: string;
  };
};

export const runtime = "nodejs";
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
  character_type?: string | null;
  is_default?: boolean | null;
  created_at?: string;
  updated_at?: string;
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

function normalizeCharacterType(value: unknown): "ugc" | "animated" {
  if (typeof value !== "string") return "ugc";
  const cleaned = value.trim().toLowerCase();
  if (cleaned === "animated" || cleaned === "animation" || cleaned === "ai_animation") {
    return "animated";
  }
  return "ugc";
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

function stripCharacterTypeMarker(value: string): string {
  return value.replace(/\s*CharacterType:\s*(ugc|animated)\.?/gi, "").replace(/\s+/g, " ").trim();
}

function withCharacterTypeMarker(promptTemplate: string, characterType: "ugc" | "animated"): string {
  const stripped = stripCharacterTypeMarker(promptTemplate);
  return `${stripped} CharacterType: ${characterType}.`.trim();
}

function inferCharacterTypeFromTemplate(promptTemplate: string): "ugc" | "animated" {
  const match = promptTemplate.match(/CharacterType:\s*(ugc|animated)/i);
  return match && match[1].toLowerCase() === "animated" ? "animated" : "ugc";
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    const message = typeof row.message === "string" ? row.message : "";
    const details = typeof row.details === "string" ? row.details : "";
    const combined = `${message}${details ? ` ${details}` : ""}`.trim();
    if (combined) return combined;
  }
  return fallback;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function loadRemoteImagePart(url: string): Promise<GeminiInlineImagePart | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!mimeType.startsWith("image/")) return null;

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    return {
      inlineData: {
        data: imageBuffer.toString("base64"),
        mimeType,
      },
    };
  } catch {
    return null;
  }
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
  referenceImageUrl: string | null,
  preferredCharacterName: string | null,
  characterType: "ugc" | "animated",
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

  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || "");
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const referenceImagePart = referenceImageUrl ? await loadRemoteImagePart(referenceImageUrl) : null;

  const prompt = `You are defining one recurring UGC AI character for a Muslim women app brand.

APP:
- Name: ${appName}
- Context: ${appContext || "N/A"}

${referenceImagePart ? "REFERENCE IMAGE: Provided. Use it as identity/style anchor for this character." : "REFERENCE IMAGE: Not provided."}
${preferredCharacterName ? `PREFERRED CHARACTER NAME: ${preferredCharacterName}` : ""}

TASK:
- Create one reusable, brand-safe UGC persona.
- Keep tone practical, warm, and faith-aware.
- Keep styling modest and contemporary.
- Avoid stereotypes.
- The character must align with type: ${characterType}.
- If type is ugc: must feel like a REAL person, not a polished AI model.
- If type is animated: must be a stylized CGI animation character suitable for 3D/2.5D animation workflows, not photoreal live-action.
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

  const result = await model.generateContent(
    referenceImagePart ? [{ text: prompt }, referenceImagePart] : prompt
  );
  const parsed = parseJsonObject(result.response.text()) || {};

  return {
    characterName:
      cleanText(preferredCharacterName, "") || cleanText(parsed.characterName, `${appName} Guide`),
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
      characterType === "animated"
        ? "Use the same Muslimah animated character identity in every scene: consistent face silhouette, stylized 3D CGI texture language, modest styling, expressive but natural animation timing, and stable color palette."
        : "Use the same female Muslimah creator identity in every UGC scene: consistent face, modest styling, natural expression, calm confident delivery, realistic movement, and no beauty-filter look."
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
  const characterType = row.character_type
    ? normalizeCharacterType(row.character_type)
    : inferCharacterTypeFromTemplate(row.prompt_template || "");

  return {
    id: row.id,
    collectionId: row.collection_id,
    characterName: row.character_name,
    personaSummary: row.persona_summary,
    visualStyle: row.visual_style,
    wardrobeNotes: row.wardrobe_notes,
    voiceTone: row.voice_tone,
    promptTemplate: stripCharacterTypeMarker(row.prompt_template || ""),
    characterType,
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
    createdAt: row.created_at || new Date(0).toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date(0).toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const collectionId = request.nextUrl.searchParams.get("collectionId")?.trim();
    const includeAngles = request.nextUrl.searchParams.get("includeAngles") === "true";
    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    const primaryQuery = await supabase
      .from("video_ugc_characters")
      .select(
        "id, collection_id, character_name, persona_summary, visual_style, wardrobe_notes, voice_tone, prompt_template, reference_image_url, image_model, character_type, is_default, created_at, updated_at"
      )
      .eq("collection_id", collectionId)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });

    let data: unknown = primaryQuery.data;
    let error = primaryQuery.error;

    if (
      error &&
      (
        isMissingColumnError(error, "is_default") ||
        isMissingColumnError(error, "updated_at") ||
        isMissingColumnError(error, "created_at") ||
        isMissingColumnError(error, "character_type")
      )
    ) {
      const fallbackQuery = await supabase
        .from("video_ugc_characters")
        .select(
          "id, collection_id, character_name, persona_summary, visual_style, wardrobe_notes, voice_tone, prompt_template, reference_image_url, image_model"
        )
        .eq("collection_id", collectionId);

      data = fallbackQuery.data;
      error = fallbackQuery.error;
    }

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

    const angles: VideoUgcCharacterAngleRow[] = [];
    if (includeAngles) {
      const { data: angleData, error: angleError } = await supabase
        .from("video_ugc_character_angles")
        .select(
          "id, collection_id, character_id, angle_key, angle_label, angle_prompt, image_url, image_model, created_at, updated_at"
        )
        .eq("collection_id", collectionId)
        .order("created_at", { ascending: false });

      if (angleError && !isMissingTableError(angleError)) {
        throw angleError;
      }

      if (Array.isArray(angleData)) {
        angles.push(...(angleData as unknown as VideoUgcCharacterAngleRow[]));
      }
    }
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
      { error: toErrorMessage(err, "Failed to load UGC characters.") },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const setAsDefault = asBoolean(body.setAsDefault, true);
    const preferredCharacterName = asText(body.characterName) || null;
    const providedReferenceImageUrl = asText(body.referenceImageUrl) || null;
    const characterType = normalizeCharacterType(body.characterType);
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;
    const imageModel = isImageGenerationModel(body.imageGenerationModel)
      ? body.imageGenerationModel
      : DEFAULT_UGC_IMAGE_MODEL || DEFAULT_IMAGE_GENERATION_MODEL;

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    if (providedReferenceImageUrl && !isHttpUrl(providedReferenceImageUrl)) {
      return NextResponse.json({ error: "referenceImageUrl must be a valid http(s) URL." }, { status: 400 });
    }

    const collection = await fetchCollectionRow(collectionId);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found." }, { status: 404 });
    }

    const appName = (collection.app_name || "Muslimah Pro").trim() || "Muslimah Pro";
    const appContext = (collection.app_description || collection.app_context || "").trim();
    const profile = await generateCharacterProfile(
      appName,
      appContext,
      providedReferenceImageUrl,
      preferredCharacterName,
      characterType,
      reasoningModel
    );

    const referenceImageUrl = providedReferenceImageUrl
      ? providedReferenceImageUrl
      : await (async () => {
        const { generateImage } = await import("@/lib/gemini-image");
        const imagePrompt = [
          characterType === "animated"
            ? `Create a high-quality stylized CGI animated character reference image for a recurring persona named ${profile.characterName}.`
            : `Create a high-quality photorealistic portrait reference image for a recurring UGC creator persona named ${profile.characterName}.`,
          profile.promptTemplate,
          `Persona: ${profile.personaSummary}.`,
          `Visual style: ${profile.visualStyle}.`,
          `Wardrobe: ${profile.wardrobeNotes}.`,
          `Identity anchors: ${profile.identityAnchors.join("; ")}.`,
          `Realism directives: ${profile.realismDirectives.join("; ")}.`,
          characterType === "animated"
            ? "Vertical 9:16, upper-body framing, stylized CGI animation look, clean shading, expressive but grounded facial design, animation-ready character sheet quality, no text overlay."
            : "Vertical 9:16, upper-body framing, natural lighting, documentary smartphone realism, lived-in authentic background, realistic skin texture with pores and minor imperfections, slight facial asymmetry, flyaway hair strands, no text overlay.",
          characterType === "animated"
            ? "NEGATIVE: photoreal pores, uncanny realism, noisy texture flicker, plastic toy look, overexposed HDR skin."
            : "NEGATIVE: plastic skin, porcelain face, hyper-symmetry, uncanny eyes, glossy CGI skin, beauty filter, fashion-magazine retouch.",
        ].join(" ");

        return generateImage(imagePrompt, {
          collectionId,
          platform: "instagram",
          imageModel,
        });
      })();

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

    const baseInsertPayload = {
      collection_id: collectionId,
      character_name: profile.characterName,
      persona_summary: profile.personaSummary,
      visual_style: profile.visualStyle,
      wardrobe_notes: profile.wardrobeNotes,
      voice_tone: profile.voiceTone,
      prompt_template: withCharacterTypeMarker(
        `${profile.promptTemplate} Identity anchors: ${profile.identityAnchors.join("; ")}. Realism directives: ${profile.realismDirectives.join("; ")}.`,
        characterType
      ),
      reference_image_url: referenceImageUrl,
      image_model: imageModel,
      is_default: setAsDefault,
    };

    let inserted: unknown = null;
    let insertError: unknown = null;

    const insertWithType = await supabase
      .from("video_ugc_characters")
      .insert({
        ...baseInsertPayload,
        character_type: characterType,
      })
      .select("*")
      .single();

    inserted = insertWithType.data;
    insertError = insertWithType.error;

    if (insertError && isMissingColumnError(insertError, "character_type")) {
      const fallbackInsert = await supabase
        .from("video_ugc_characters")
        .insert(baseInsertPayload)
        .select("*")
        .single();
      inserted = fallbackInsert.data;
      insertError = fallbackInsert.error;
    }

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
      character: toCharacterResponse(inserted as VideoUgcCharacterRow),
      imageModel,
      reasoningModel,
    });
  } catch (err) {
    return NextResponse.json(
      { error: toErrorMessage(err, "Failed to create UGC character.") },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const characterId = asText(body.characterId);

    if (!collectionId || !characterId) {
      return NextResponse.json({ error: "collectionId and characterId are required." }, { status: 400 });
    }

    const existing = await supabase
      .from("video_ugc_characters")
      .select("id")
      .eq("collection_id", collectionId)
      .eq("id", characterId)
      .single();

    if (existing.error || !existing.data) {
      return NextResponse.json({ error: "Character not found." }, { status: 404 });
    }

    const deleteAngles = await supabase
      .from("video_ugc_character_angles")
      .delete()
      .eq("collection_id", collectionId)
      .eq("character_id", characterId);

    if (deleteAngles.error && !isMissingTableError(deleteAngles.error)) {
      throw deleteAngles.error;
    }

    const deleteCharacter = await supabase
      .from("video_ugc_characters")
      .delete()
      .eq("collection_id", collectionId)
      .eq("id", characterId);

    if (deleteCharacter.error) {
      throw deleteCharacter.error;
    }

    const existingDefault = await supabase
      .from("video_ugc_characters")
      .select("id")
      .eq("collection_id", collectionId)
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();

    if (existingDefault.error && !isMissingColumnError(existingDefault.error, "is_default")) {
      throw existingDefault.error;
    }

    if (!existingDefault.data) {
      const firstRemaining = await supabase
        .from("video_ugc_characters")
        .select("id")
        .eq("collection_id", collectionId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!firstRemaining.error && firstRemaining.data) {
        await supabase
          .from("video_ugc_characters")
          .update({ is_default: true, updated_at: new Date().toISOString() })
          .eq("collection_id", collectionId)
          .eq("id", (firstRemaining.data as { id: string }).id);
      }
    }

    return NextResponse.json({ deletedCharacterId: characterId });
  } catch (err) {
    return NextResponse.json(
      { error: toErrorMessage(err, "Failed to delete character.") },
      { status: 500 }
    );
  }
}
