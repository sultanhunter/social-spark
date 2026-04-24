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

type CharacterPromptEntry = {
  linearAssetIndex: number;
  slideIndex: number;
  assetIndexInSlide: number;
  description: string;
  prompt: string;
};

type CharacterDraft = {
  roleKey: string;
  gender: "male" | "female";
  characterName: string;
  personaSummary: string;
  visualStyle: string;
  wardrobeNotes: string;
  voiceTone: string;
  promptTemplate: string;
  identityAnchors: string[];
  assetIndexes: number[];
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

function asIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const list: number[] = [];
  for (const item of value) {
    if (typeof item === "number" && Number.isInteger(item) && item >= 0) {
      list.push(item);
    }
  }
  return Array.from(new Set(list));
}

function sanitizeRoleKey(value: unknown, fallback: string): string {
  const raw = cleanText(value, fallback).toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function normalizeGender(value: unknown): "male" | "female" {
  if (typeof value !== "string") return "female";
  const normalized = value.trim().toLowerCase();
  if (normalized === "male" || normalized === "man" || normalized === "boy") return "male";
  return "female";
}

function inferGenderFromPromptText(text: string): "male" | "female" {
  const normalized = text.toLowerCase();
  if (/(man|male|boy|father|husband|brother|uncle|imam|beard|bearded)/i.test(normalized)) {
    return "male";
  }
  return "female";
}

function applyGenderAppearanceRules(
  draft: CharacterDraft,
  sourcePrompts: CharacterPromptEntry[]
): CharacterDraft {
  const promptText = sourcePrompts.map((entry) => entry.prompt).join(" ");
  const inferredGender = inferGenderFromPromptText(promptText);
  const gender = draft.gender || inferredGender;

  if (gender === "male") {
    return {
      ...draft,
      gender,
      wardrobeNotes: `${draft.wardrobeNotes} Ensure masculine presentation with a clearly visible, natural beard in every appearance.`.trim(),
      promptTemplate: `${draft.promptTemplate} Always keep this character male-presenting with a clearly visible natural beard in every assigned asset.`.trim(),
    };
  }

  return {
    ...draft,
    gender: "female",
    wardrobeNotes: `${draft.wardrobeNotes} Always wear a loose hijab and loose, modest, non-tight, non-revealing clothing.`.trim(),
    promptTemplate: `${draft.promptTemplate} Always keep this character female-presenting with a loose hijab and loose, modest, non-tight, non-revealing clothing in every assigned asset.`.trim(),
  };
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
  return /(woman|female|girl|lady|muslimah|hijab|character|person|portrait|face|model|mother|father|child|kid|family|people|couple)/i.test(
    combined
  );
}

function extractAssetPrompts(slidePlans: SlidePlan[]): CharacterPromptEntry[] {
  const items: CharacterPromptEntry[] = [];
  let linearAssetIndex = 0;

  for (let slideIndex = 0; slideIndex < slidePlans.length; slideIndex += 1) {
    const plan = slidePlans[slideIndex];
    for (let assetIndexInSlide = 0; assetIndexInSlide < plan.assetPrompts.length; assetIndexInSlide += 1) {
      const asset = plan.assetPrompts[assetIndexInSlide];
      items.push({
        linearAssetIndex,
        slideIndex,
        assetIndexInSlide,
        description: asset.description,
        prompt: asset.prompt,
      });
      linearAssetIndex += 1;
    }
  }

  return items;
}

function fallbackDraftForPrompts(appName: string, promptEntries: CharacterPromptEntry[]): CharacterDraft {
  const inferredGender = inferGenderFromPromptText(promptEntries.map((entry) => entry.prompt).join(" "));
  return {
    roleKey: "primary",
    gender: inferredGender,
    characterName: `${appName} Lead Character`,
    personaSummary: "Warm Muslimah lead with practical, nurturing tone and grounded presence.",
    visualStyle: "Consistent portrait realism with stable facial structure and modest styling.",
    wardrobeNotes: "Modest outfit with long sleeves to wrists; consistent hijab styling when applicable.",
    voiceTone: "Warm, clear, calm, reassuring.",
    promptTemplate:
      "Use the same recurring Muslimah character identity across all assigned assets: consistent face, age range, skin tone, modest styling, and natural expression.",
    identityAnchors: [
      "Consistent face proportions and eye shape",
      "Stable modest wardrobe silhouette",
      "Calm nurturing expression style",
    ],
    assetIndexes: promptEntries.map((entry) => entry.linearAssetIndex),
  };
}

async function generateCharacterDraftsFromPrompts({
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
}): Promise<CharacterDraft[]> {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    throw new Error("GOOGLE_GEMINI_API_KEY is missing.");
  }

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const promptList = promptEntries
    .slice(0, 80)
    .map(
      (item) =>
        `AssetIndex ${item.linearAssetIndex} | Slide ${item.slideIndex + 1} Asset ${item.assetIndexInSlide + 1} | ${
          item.description || "Asset"
        }: ${item.prompt}`
    )
    .join("\n");

  const instruction = `You are extracting recurring visual characters from asset prompts for consistent image generation.

APP:
- Name: ${appName}
- Context: ${appContext || "N/A"}

STYLE HINT:
${styleHint || "N/A"}

ASSET PROMPTS:
${promptList}

Task:
- Identify ALL distinct recurring human characters required by these prompts.
- Create one stable character profile per distinct character.
- Assign each character to the linear AssetIndex values where that character should appear.
- If a prompt has no person, do not include that index.
- Keep names and identities practical and consistent.
- Hard rule: male characters must always have a clearly visible natural beard.
- Hard rule: female characters must always wear loose hijab and loose, modest, non-tight, non-revealing clothing.

Return strict JSON only in this shape:
{
  "characters": [
    {
      "roleKey": "short_stable_key",
      "gender": "male or female",
      "characterName": "string",
      "personaSummary": "string",
      "visualStyle": "string",
      "wardrobeNotes": "string",
      "voiceTone": "string",
      "promptTemplate": "single continuity sentence",
      "identityAnchors": ["3-6 concise anchors"],
      "assetIndexes": [0, 1]
    }
  ]
}`;

  const response = await model.generateContent(instruction);
  const parsed = parseJsonObject(response.response.text()) || {};
  const rawCharacters = Array.isArray(parsed.characters) ? parsed.characters : [];

  const maxAssetIndex = promptEntries.reduce(
    (max, item) => (item.linearAssetIndex > max ? item.linearAssetIndex : max),
    -1
  );

  const drafts: CharacterDraft[] = rawCharacters
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item, index) => {
      const characterName = cleanText(item.characterName, `${appName} Character ${index + 1}`);
      const roleKey = sanitizeRoleKey(item.roleKey, `character_${index + 1}`);
      const gender = normalizeGender(item.gender);
      const identityAnchors = Array.isArray(item.identityAnchors)
        ? item.identityAnchors
          .map((anchor) => cleanText(anchor))
          .filter(Boolean)
          .slice(0, 6)
        : [];
      const assetIndexes = asIntegerArray(item.assetIndexes).filter((value) => value >= 0 && value <= maxAssetIndex);

      return {
        roleKey,
        gender,
        characterName,
        personaSummary: cleanText(
          item.personaSummary,
          "Warm Muslimah character with grounded and practical presence."
        ),
        visualStyle: cleanText(item.visualStyle, "Consistent portrait realism with stable identity markers."),
        wardrobeNotes: cleanText(
          item.wardrobeNotes,
          "Modest outfit with long sleeves to wrists and consistent styling cues."
        ),
        voiceTone: cleanText(item.voiceTone, "Warm, clear, calm, reassuring."),
        promptTemplate: cleanText(
          item.promptTemplate,
          "Use this same recurring character identity across assigned assets with stable facial and wardrobe continuity."
        ),
        identityAnchors:
          identityAnchors.length > 0
            ? identityAnchors
            : [
                "Consistent face proportions and eye shape",
                "Stable modest wardrobe silhouette",
                "Calm, natural expression profile",
              ],
        assetIndexes,
      };
    })
    .filter((draft) => draft.assetIndexes.length > 0);

  if (drafts.length === 0) {
    return [applyGenderAppearanceRules(fallbackDraftForPrompts(appName, promptEntries), promptEntries)];
  }

  return drafts.map((draft) => {
    const promptSubset = promptEntries.filter((entry) => draft.assetIndexes.includes(entry.linearAssetIndex));
    return applyGenderAppearanceRules(draft, promptSubset);
  });
}

async function insertCharacterRow({
  collectionId,
  character,
  referenceImageUrl,
  imageModel,
}: {
  collectionId: string;
  character: CharacterDraft;
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
    prompt_template: `${character.promptTemplate} Identity anchors: ${character.identityAnchors.join(
      "; "
    )}. CharacterRole: ${character.roleKey}. CharacterGender: ${character.gender}. CharacterType: ugc.`,
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
      return NextResponse.json({ error: "No asset prompts found in this saved post." }, { status: 400 });
    }

    const characterAssetPrompts = allAssetPrompts.filter((entry) =>
      isCharacterAssetPrompt(entry.prompt, entry.description)
    );

    if (characterAssetPrompts.length === 0) {
      return NextResponse.json(
        { error: "No character-related asset prompts found for this saved post." },
        { status: 400 }
      );
    }

    const previousGenerationState = asRecord(recreatedResult.data.generation_state) || {};
    const styleId = isAssetStylePresetId(previousGenerationState.assetStyleId)
      ? previousGenerationState.assetStyleId
      : null;
    const stylePreset = styleId ? getAssetStylePreset(styleId) : null;
    const styleHint = stylePreset?.stylePrompt || "";

    const appName = asText(collection.app_name) || "Muslimah Pro";
    const appContext = asText(collection.app_description) || asText(collection.app_context);

    const characterDrafts = await generateCharacterDraftsFromPrompts({
      appName,
      appContext,
      styleHint,
      promptEntries: characterAssetPrompts,
      reasoningModel,
    });

    const createdCharacters: Array<{
      id: string;
      roleKey: string;
      gender: "male" | "female";
      characterName: string;
      promptTemplate: string;
      referenceImageUrl: string;
      assetIndexes: number[];
    }> = [];

    const assetCharacterAssignments: Record<string, string> = {};
    const assetCharacterRoles: Record<string, string> = {};

    for (let i = 0; i < characterDrafts.length; i += 1) {
      const draft = characterDrafts[i];
      const portraitPrompt = [
        `Create one clean character reference portrait for ${draft.characterName}.`,
        draft.promptTemplate,
        draft.gender === "male"
          ? "Mandatory appearance rule: clearly visible natural beard in this character portrait."
          : "Mandatory appearance rule: loose hijab and loose, modest, non-tight, non-revealing clothing.",
        `Persona: ${draft.personaSummary}.`,
        `Visual style: ${draft.visualStyle}.`,
        `Wardrobe: ${draft.wardrobeNotes}.`,
        `Identity anchors: ${draft.identityAnchors.join("; ")}.`,
        styleHint ? `Match style: ${styleHint}.` : "",
        "Framing: upper body portrait, centered, uncluttered background, no text overlays.",
      ]
        .filter(Boolean)
        .join(" ");

      const referenceImageUrl = await generateImage(portraitPrompt, {
        collectionId,
        postId,
        index: i,
        platform: asText(postResult.data.platform) || "instagram",
        generationId: `saved-post-characters-${recreatedPostId}-${Date.now()}-${i}`,
        versionId: `recreated-${recreatedPostId}`,
        forceCarouselAspect: postResult.data.post_type === "image_slides",
        imageModel: imageGenerationModel,
      });

      const insertedCharacter = await insertCharacterRow({
        collectionId,
        character: draft,
        referenceImageUrl,
        imageModel: imageGenerationModel,
      });

      const characterId = asText(insertedCharacter.id);
      if (!characterId) {
        throw new Error(`Character ${draft.characterName} was created but no ID was returned.`);
      }

      createdCharacters.push({
        id: characterId,
        roleKey: draft.roleKey,
        gender: draft.gender,
        characterName: draft.characterName,
        promptTemplate: draft.promptTemplate,
        referenceImageUrl,
        assetIndexes: draft.assetIndexes,
      });

      for (const assetIndex of draft.assetIndexes) {
        const key = String(assetIndex);
        if (!assetCharacterAssignments[key]) {
          assetCharacterAssignments[key] = characterId;
          assetCharacterRoles[key] = draft.roleKey;
        }
      }
    }

    const primaryCharacter = createdCharacters[0] || null;
    const generationStateUpdate = {
      ...previousGenerationState,
      characterId: primaryCharacter?.id || null,
      characterIds: createdCharacters.map((item) => item.id),
      characterGenderById: Object.fromEntries(createdCharacters.map((item) => [item.id, item.gender])),
      characterName: primaryCharacter?.characterName || null,
      characterReferenceImageUrl: primaryCharacter?.referenceImageUrl || null,
      characterGeneratedAt: new Date().toISOString(),
      charactersGeneratedCount: createdCharacters.length,
      characterMapByAssetIndex: assetCharacterAssignments,
      characterRoleByAssetIndex: assetCharacterRoles,
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
      characters: createdCharacters,
      assetCharacterAssignments,
      characterPromptCount: characterAssetPrompts.length,
      imageGenerationModel,
      reasoningModel,
      generationState: generationStateUpdate,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate saved-post characters." },
      { status: 500 }
    );
  }
}
