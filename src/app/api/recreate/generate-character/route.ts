import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/gemini-image";
import { getAssetStylePreset, isAssetStylePresetId } from "@/lib/asset-style";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isImageGenerationModel,
  type ImageGenerationModel,
} from "@/lib/image-generation-model";
import {
  DEFAULT_REASONING_MODEL,
  isReasoningModel,
  type ReasoningModel,
} from "@/lib/reasoning-model";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

type SlidePlan = {
  headline: string;
  supportingText: string;
  figmaInstructions: string[];
  assetPrompts: Array<{
    prompt: string;
    description: string;
  }>;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
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
  return combined.includes("column") && combined.includes(columnName.toLowerCase());
}

async function fetchCollectionRow(collectionId: string): Promise<Record<string, unknown> | null> {
  let collectionResult = await supabase
    .from("collections")
    .select("app_name, app_description, app_context")
    .eq("id", collectionId)
    .maybeSingle();

  if (collectionResult.error && isMissingColumnError(collectionResult.error, "app_context")) {
    collectionResult = await supabase
      .from("collections")
      .select("app_name, app_description")
      .eq("id", collectionId)
      .maybeSingle();
  }

  if (collectionResult.error) throw collectionResult.error;
  return collectionResult.data as Record<string, unknown> | null;
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

function sanitizeSlidePlans(value: unknown): SlidePlan[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): SlidePlan | null => {
      const row = asRecord(item);
      if (!row) return null;

      const headline = typeof row.headline === "string" ? row.headline : "";
      const supportingText = typeof row.supportingText === "string" ? row.supportingText : "";
      const figmaInstructions = Array.isArray(row.figmaInstructions)
        ? row.figmaInstructions.filter((step): step is string => typeof step === "string")
        : [];
      const assetPrompts = Array.isArray(row.assetPrompts)
        ? row.assetPrompts
          .filter((asset): asset is Record<string, unknown> => typeof asset === "object" && asset !== null)
          .map((asset) => ({
            prompt: typeof asset.prompt === "string" ? asset.prompt : "",
            description: typeof asset.description === "string" ? asset.description : "Asset",
          }))
          .filter((asset) => asset.prompt.trim().length > 0)
        : [];

      if (!headline && figmaInstructions.length === 0 && assetPrompts.length === 0) return null;

      return {
        headline,
        supportingText,
        figmaInstructions,
        assetPrompts,
      };
    })
    .filter((plan): plan is SlidePlan => Boolean(plan));
}

function isCharacterAssetPrompt(prompt: string, description: string): boolean {
  const combined = `${prompt} ${description}`.toLowerCase();
  return /(woman|female|girl|lady|muslimah|hijab|character|person|portrait|face|model|mother|child|family|people)/i.test(
    combined
  );
}

type CharacterPromptEntry = {
  slideIndex: number;
  assetIndex: number;
  description: string;
  prompt: string;
};

function extractAssetPrompts(slidePlans: SlidePlan[]): CharacterPromptEntry[] {
  const items: CharacterPromptEntry[] = [];

  for (let slideIndex = 0; slideIndex < slidePlans.length; slideIndex += 1) {
    const plan = slidePlans[slideIndex];
    for (let assetIndex = 0; assetIndex < plan.assetPrompts.length; assetIndex += 1) {
      const asset = plan.assetPrompts[assetIndex];
      items.push({
        slideIndex,
        assetIndex,
        description: asset.description,
        prompt: asset.prompt,
      });
    }
  }

  return items;
}

async function generateCharacterFromPrompts({
  appName,
  appContext,
  styleHint,
  promptEntries,
  reasoningModel,
}: {
  appName: string;
  appContext: string;
  styleHint: string;
  promptEntries: CharacterPromptEntry[];
  reasoningModel: ReasoningModel;
}): Promise<{
  characterName: string;
  personaSummary: string;
  visualStyle: string;
  wardrobeNotes: string;
  voiceTone: string;
  promptTemplate: string;
  identityAnchors: string[];
}> {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    throw new Error("GOOGLE_GEMINI_API_KEY is missing.");
  }

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: reasoningModel });
  const promptList = promptEntries
    .slice(0, 40)
    .map((item) =>
      `Slide ${item.slideIndex + 1}, Asset ${item.assetIndex + 1} (${item.description || "Asset"}): ${item.prompt}`
    )
    .join("\n");

  const instruction = `You are extracting one recurring main character profile from social-slide asset prompts.

APP:
- Name: ${appName}
- Context: ${appContext || "N/A"}

STYLE HINT:
${styleHint || "N/A"}

ASSET PROMPTS:
${promptList}

Goal:
- Infer ONE main recurring character identity to keep visual consistency across assets.
- Prioritize Muslimah/modest representation if present in prompts.
- If assets include both mother and child, choose the PRIMARY recurring person as main character and mention others in persona summary only.
- Keep output useful for character-lock image generation.

Return strict JSON only:
{
  "characterName": "string",
  "personaSummary": "string",
  "visualStyle": "string",
  "wardrobeNotes": "string",
  "voiceTone": "string",
  "promptTemplate": "single continuity sentence",
  "identityAnchors": ["3-6 concise anchors"]
}`;

  const response = await model.generateContent(instruction);
  const parsed = parseJsonObject(response.response.text()) || {};

  return {
    characterName: cleanText(parsed.characterName, `${appName} Lead Character`),
    personaSummary: cleanText(
      parsed.personaSummary,
      "Warm Muslimah guide character with grounded, practical, nurturing presence."
    ),
    visualStyle: cleanText(
      parsed.visualStyle,
      "Natural cinematic portrait style with consistent facial structure and modest presentation."
    ),
    wardrobeNotes: cleanText(
      parsed.wardrobeNotes,
      "Modest outfit with long sleeves to wrists, clean fabric textures, and consistent hijab styling when applicable."
    ),
    voiceTone: cleanText(parsed.voiceTone, "Warm, clear, calm, reassuring."),
    promptTemplate: cleanText(
      parsed.promptTemplate,
      "Use the same recurring Muslimah character identity across all scenes: consistent face, age range, skin tone, modest styling, and natural expression." 
    ),
    identityAnchors: Array.isArray(parsed.identityAnchors)
      ? parsed.identityAnchors
        .map((item) => cleanText(item))
        .filter(Boolean)
        .slice(0, 6)
      : [
          "Consistent face proportions and eye shape",
          "Stable modest wardrobe silhouette",
          "Calm, nurturing expression style",
        ],
  };
}

async function insertCharacterRow({
  collectionId,
  character,
  referenceImageUrl,
  imageModel,
}: {
  collectionId: string;
  character: {
    characterName: string;
    personaSummary: string;
    visualStyle: string;
    wardrobeNotes: string;
    voiceTone: string;
    promptTemplate: string;
    identityAnchors: string[];
  };
  referenceImageUrl: string;
  imageModel: ImageGenerationModel;
}): Promise<Record<string, unknown>> {
  const basePayload: Record<string, unknown> = {
    collection_id: collectionId,
    character_name: character.characterName,
    persona_summary: character.personaSummary,
    visual_style: character.visualStyle,
    wardrobe_notes: character.wardrobeNotes,
    voice_tone: character.voiceTone,
    prompt_template: `${character.promptTemplate} Identity anchors: ${character.identityAnchors.join("; ")}. CharacterType: ugc.`,
    reference_image_url: referenceImageUrl,
    image_model: imageModel,
  };

  const candidatePayloads: Record<string, unknown>[] = [
    {
      ...basePayload,
      character_type: "ugc",
      is_default: false,
    },
    {
      ...basePayload,
      is_default: false,
    },
    basePayload,
  ];

  let lastError: unknown = null;
  for (const payload of candidatePayloads) {
    const insertResult = await supabase
      .from("video_ugc_characters")
      .insert(payload)
      .select("*")
      .single();

    if (!insertResult.error && insertResult.data) {
      return insertResult.data as Record<string, unknown>;
    }

    lastError = insertResult.error;

    if (
      !isMissingColumnError(insertResult.error, "character_type") &&
      !isMissingColumnError(insertResult.error, "is_default")
    ) {
      break;
    }
  }

  if (isMissingTableError(lastError)) {
    throw new Error(
      "UGC characters table is missing. Run the video-agent SQL migration first (see supabase-migration.sql)."
    );
  }

  throw lastError;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const postId = asText(body.postId);
    const recreatedPostId = asText(body.recreatedPostId);
    const reasoningModel: ReasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;
    const imageGenerationModel: ImageGenerationModel = isImageGenerationModel(body.imageGenerationModel)
      ? body.imageGenerationModel
      : DEFAULT_IMAGE_GENERATION_MODEL;

    if (!collectionId || !postId || !recreatedPostId) {
      return NextResponse.json(
        { error: "collectionId, postId, and recreatedPostId are required." },
        { status: 400 }
      );
    }

    const [collection, postResult, recreatedResult] = await Promise.all([
      fetchCollectionRow(collectionId),
      supabase
        .from("saved_posts")
        .select("platform, post_type")
        .eq("id", postId)
        .eq("collection_id", collectionId)
        .maybeSingle(),
      supabase
        .from("recreated_posts")
        .select("id, slide_plans, generation_state")
        .eq("id", recreatedPostId)
        .eq("collection_id", collectionId)
        .eq("original_post_id", postId)
        .maybeSingle(),
    ]);

    if (postResult.error) throw postResult.error;
    if (recreatedResult.error) throw recreatedResult.error;

    if (!collection || !postResult.data || !recreatedResult.data) {
      return NextResponse.json({ error: "Saved post context not found." }, { status: 404 });
    }

    const slidePlans = sanitizeSlidePlans(recreatedResult.data.slide_plans);
    if (slidePlans.length === 0) {
      return NextResponse.json(
        { error: "No slide plans found. Generate script/images first for this saved post." },
        { status: 400 }
      );
    }

    const allAssetPrompts = extractAssetPrompts(slidePlans);
    if (allAssetPrompts.length === 0) {
      return NextResponse.json(
        { error: "No asset prompts found in this saved post." },
        { status: 400 }
      );
    }

    const characterAssetPrompts = allAssetPrompts.filter((entry) =>
      isCharacterAssetPrompt(entry.prompt, entry.description)
    );
    const effectivePrompts = characterAssetPrompts.length > 0 ? characterAssetPrompts : allAssetPrompts;

    const previousGenerationState = asRecord(recreatedResult.data.generation_state) || {};
    const styleId = isAssetStylePresetId(previousGenerationState.assetStyleId)
      ? previousGenerationState.assetStyleId
      : null;
    const stylePreset = styleId ? getAssetStylePreset(styleId) : null;
    const styleHint = stylePreset?.stylePrompt || "";

    const appName = asText(collection.app_name) || "Muslimah Pro";
    const appContext = asText(collection.app_description) || asText(collection.app_context);
    const generatedCharacter = await generateCharacterFromPrompts({
      appName,
      appContext,
      styleHint,
      promptEntries: effectivePrompts,
      reasoningModel,
    });

    const portraitPrompt = [
      `Create one clean character reference portrait for ${generatedCharacter.characterName}.`,
      generatedCharacter.promptTemplate,
      `Persona: ${generatedCharacter.personaSummary}.`,
      `Visual style: ${generatedCharacter.visualStyle}.`,
      `Wardrobe: ${generatedCharacter.wardrobeNotes}.`,
      `Identity anchors: ${generatedCharacter.identityAnchors.join("; ")}.`,
      styleHint ? `Match style: ${styleHint}.` : "",
      "Framing: upper body portrait, centered, uncluttered background, no text overlays.",
    ]
      .filter(Boolean)
      .join(" ");

    const referenceImageUrl = await generateImage(portraitPrompt, {
      collectionId,
      postId,
      index: 0,
      platform: asText(postResult.data.platform) || "instagram",
      generationId: `saved-post-character-${recreatedPostId}-${Date.now()}`,
      versionId: `recreated-${recreatedPostId}`,
      forceCarouselAspect: postResult.data.post_type === "image_slides",
      imageModel: imageGenerationModel,
    });

    const insertedCharacter = await insertCharacterRow({
      collectionId,
      character: generatedCharacter,
      referenceImageUrl,
      imageModel: imageGenerationModel,
    });

    const characterId = asText(insertedCharacter.id);
    if (!characterId) {
      throw new Error("Character created but ID was not returned.");
    }

    const generationStateUpdate = {
      ...previousGenerationState,
      characterId,
      characterName: generatedCharacter.characterName,
      characterReferenceImageUrl: referenceImageUrl,
      characterGeneratedAt: new Date().toISOString(),
    };

    const updatePayload: Record<string, unknown> = {
      generation_state: generationStateUpdate,
      updated_at: new Date().toISOString(),
    };

    let { error: updateError } = await supabase
      .from("recreated_posts")
      .update(updatePayload)
      .eq("id", recreatedPostId)
      .eq("collection_id", collectionId)
      .eq("original_post_id", postId);

    if (updateError && /generation_state/i.test(updateError.message || "")) {
      const fallbackUpdate = await supabase
        .from("recreated_posts")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", recreatedPostId)
        .eq("collection_id", collectionId)
        .eq("original_post_id", postId);
      updateError = fallbackUpdate.error;
    }

    if (updateError) throw updateError;

    return NextResponse.json({
      recreatedPostId,
      character: {
        id: characterId,
        characterName: generatedCharacter.characterName,
        promptTemplate: generatedCharacter.promptTemplate,
        referenceImageUrl,
      },
      characterPromptCount: effectivePrompts.length,
      usedCharacterPromptsOnly: characterAssetPrompts.length > 0,
      imageGenerationModel,
      reasoningModel,
      generationState: generationStateUpdate,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate saved-post character." },
      { status: 500 }
    );
  }
}
