import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { generateSlideDesignPlans } from "@/lib/gemini";
import type { AdaptationMode, SlideGenerationPlan, UIGenerationMode } from "@/lib/gemini";
import { generateSlideImages } from "@/lib/gemini-image";
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

const APP_BRAND_PRIMARY_COLOR = "#F36F97";
const APP_BRAND_GRADIENT = ["#F36F97", "#EEB4C3", "#F7DFD6"];
const APP_LOGO_PATH = "/Users/sultanibneusman/Desktop/Perri/assets/images/app-logo.png";
const APP_FEATURE_MOCKUP_PATH = path.join(process.cwd(), "public/assets/main_hero.png");

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeMediaUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

function getCollectionAppContext(collection: unknown): string {
  if (typeof collection !== "object" || collection === null) return "";

  const row = collection as Record<string, unknown>;
  const appDescription = asNonEmptyString(row.app_description);
  if (appDescription) return appDescription;

  const appContext = asNonEmptyString(row.app_context);
  if (appContext) return appContext;

  return "";
}

function resolveAppContextMode(script: string, explicitFlag: unknown): boolean {
  if (typeof explicitFlag === "boolean") return explicitFlag;
  return /Adaptation Mode\s*:\s*app_context/i.test(script);
}

function asAdaptationMode(value: unknown): AdaptationMode | null {
  if (value === "app_context" || value === "variant_only") return value;
  return null;
}

function asUIGenerationMode(value: unknown): UIGenerationMode | null {
  if (value === "reference_exact" || value === "ai_creative") return value;
  return null;
}

function deriveSetType(
  versionId: string,
  adaptationMode: AdaptationMode
): "variant_only" | "app_context" | "hook_strategy" {
  if (versionId.includes("hook_strategy")) return "hook_strategy";
  return adaptationMode;
}

function asSetType(value: unknown): "variant_only" | "app_context" | "hook_strategy" | null {
  if (value === "variant_only" || value === "app_context" || value === "hook_strategy") {
    return value;
  }
  return null;
}

interface GenerationVersionInput {
  id: string;
  label: string;
  setType: "variant_only" | "app_context" | "hook_strategy";
  adaptationMode: AdaptationMode;
  usesAppContext: boolean;
  uiGenerationMode: UIGenerationMode;
  followsReferenceLayout: boolean;
  script: string;
  slidePlans: SlideGenerationPlan[];
  recreatedPostId?: string;
}

async function persistRecreatedPost({
  recreatedPostId,
  collectionId,
  postId,
  status,
  script,
  generatedMediaUrls,
  slidePlans,
}: {
  recreatedPostId: string;
  collectionId: string;
  postId: string;
  status: "draft" | "generating" | "completed" | "failed";
  script?: string;
  generatedMediaUrls?: string[];
  slidePlans?: unknown[];
}): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (typeof script === "string") updatePayload.script = script;
  if (Array.isArray(generatedMediaUrls)) updatePayload.generated_media_urls = generatedMediaUrls;
  if (Array.isArray(slidePlans)) updatePayload.slide_plans = slidePlans;

  const { error } = await supabase
    .from("recreated_posts")
    .update(updatePayload)
    .eq("id", recreatedPostId)
    .eq("original_post_id", postId)
    .eq("collection_id", collectionId);

  if (error) throw error;
}

function sanitizeSlidePlans(rawPlans: unknown): SlideGenerationPlan[] {
  if (!Array.isArray(rawPlans)) return [];

  return rawPlans
    .map((item): SlideGenerationPlan | null => {
      if (typeof item !== "object" || item === null) return null;

      const plan = item as Record<string, unknown>;
      const headline = typeof plan.headline === "string" ? plan.headline.trim() : "";
      const supportingText = typeof plan.supportingText === "string" ? plan.supportingText.trim() : "";

      const figmaInstructions = Array.isArray(plan.figmaInstructions)
        ? plan.figmaInstructions.filter(
          (step: unknown): step is string => typeof step === "string" && (step as string).trim().length > 0
        )
        : [];

      const assetPrompts = Array.isArray(plan.assetPrompts)
        ? plan.assetPrompts
          .filter((a: unknown): a is Record<string, unknown> => typeof a === "object" && a !== null)
          .map((a: Record<string, unknown>) => ({
            prompt: typeof a.prompt === "string" ? a.prompt : "",
            description: typeof a.description === "string" ? a.description : "Asset",
          }))
          .filter((a: { prompt: string }) => a.prompt.length > 0)
        : [];

      if (!headline && figmaInstructions.length === 0) return null;

      return { headline, supportingText, figmaInstructions, assetPrompts };
    })
    .filter((plan): plan is SlideGenerationPlan => Boolean(plan))
    .slice(0, 10);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const script = asNonEmptyString(body.script);
    const incomingSlidePlans = body.slidePlans;
    const incomingVersions = Array.isArray(body.versions)
      ? body.versions.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      : [];
    const collectionId = asNonEmptyString(body.collectionId);
    const postId = asNonEmptyString(body.postId);
    const appName = asNonEmptyString(body.appName);
    const recreatedPostId = asNonEmptyString(body.recreatedPostId);
    const imageGenerationModel = isImageGenerationModel(body.imageGenerationModel)
      ? body.imageGenerationModel
      : DEFAULT_IMAGE_GENERATION_MODEL;
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;

    const fallbackMode: AdaptationMode = resolveAppContextMode(script ?? "", body.isAppNicheRelevant)
      ? "app_context"
      : "variant_only";

    if (!collectionId || !postId || !appName) {
      return NextResponse.json(
        { error: "Collection ID, post ID, and app name are required" },
        { status: 400 }
      );
    }

    if (!script && incomingVersions.length === 0) {
      return NextResponse.json(
        { error: "Script or versions payload is required" },
        { status: 400 }
      );
    }

    const { data: originalPost, error: postError } = await supabase
      .from("saved_posts")
      .select("platform, media_urls, thumbnail_url")
      .eq("id", postId)
      .eq("collection_id", collectionId)
      .single();

    const { data: collection, error: collectionError } = await supabase
      .from("collections")
      .select("*")
      .eq("id", collectionId)
      .single();

    if (postError || collectionError) {
      throw new Error("Could not determine platform for aspect ratio settings");
    }

    const platform = asNonEmptyString(originalPost?.platform) || "unknown";
    const appContext = getCollectionAppContext(collection);
    const thumbnailUrl = asNonEmptyString(originalPost?.thumbnail_url);
    const referenceImageUrls = [
      ...normalizeMediaUrls(originalPost?.media_urls),
      ...(thumbnailUrl ? [thumbnailUrl] : []),
    ].slice(0, 8);

    const explicitVersions = incomingVersions
      .map((item, index): GenerationVersionInput | null => {
        const versionScript = asNonEmptyString(item.script);
        if (!versionScript) return null;

        const adaptationMode =
          asAdaptationMode(item.adaptationMode) ||
          (resolveAppContextMode(versionScript, item.usesAppContext) ? "app_context" : "variant_only");

        return {
          id: asNonEmptyString(item.id) || `version-${index + 1}`,
          label:
            asNonEmptyString(item.label) ||
            (adaptationMode === "app_context" ? "App Context Rewrite" : "Original Topic Variant"),
          setType:
            asSetType(item.setType) ||
            deriveSetType(asNonEmptyString(item.id) || `version-${index + 1}`, adaptationMode),
          adaptationMode,
          usesAppContext: adaptationMode === "app_context",
          uiGenerationMode: asUIGenerationMode(item.uiGenerationMode) || "ai_creative",
          followsReferenceLayout: asUIGenerationMode(item.uiGenerationMode) === "reference_exact",
          script: versionScript,
          slidePlans: sanitizeSlidePlans(item.slidePlans),
          recreatedPostId: asNonEmptyString(item.recreatedPostId) || undefined,
        };
      })
      .filter((version): version is GenerationVersionInput => Boolean(version));

    const fallbackVersion: GenerationVersionInput | null = script
      ? {
        id: fallbackMode,
        label: fallbackMode === "app_context" ? "App Context Rewrite" : "Original Topic Variant",
        setType: deriveSetType(fallbackMode, fallbackMode),
        adaptationMode: fallbackMode,
        usesAppContext: fallbackMode === "app_context",
        uiGenerationMode: "ai_creative",
        followsReferenceLayout: false,
        script,
        slidePlans: sanitizeSlidePlans(incomingSlidePlans),
        recreatedPostId: recreatedPostId || undefined,
      }
      : null;

    const rawVersionsToGenerate = explicitVersions.length > 0
      ? explicitVersions
      : fallbackVersion
        ? [fallbackVersion]
        : [];

    const versionsToGenerate =
      recreatedPostId && rawVersionsToGenerate.length > 0 && !rawVersionsToGenerate.some((v) => v.recreatedPostId)
        ? rawVersionsToGenerate.map((version, index) =>
          index === 0
            ? {
              ...version,
              recreatedPostId,
            }
            : version
        )
        : rawVersionsToGenerate;

    if (versionsToGenerate.length === 0) {
      throw new Error("No valid generation version payload found.");
    }

    // If slide plans are missing, generate them using the new per-slide approach
    const hydratedVersions = await Promise.all(
      versionsToGenerate.map(async (version) => {
        if (version.slidePlans.length > 0) {
          return version;
        }

        const slidePlans = await generateSlideDesignPlans(
          referenceImageUrls,
          version.script,
          platform,
          APP_BRAND_PRIMARY_COLOR,
          APP_BRAND_GRADIENT,
          appName,
          reasoningModel
        );

        return {
          ...version,
          slidePlans,
        };
      })
    );

    const versionsWithRows = await Promise.all(
      hydratedVersions.map(async (version) => {
        if (version.recreatedPostId) return version;

        const draftPayload: Record<string, unknown> = {
          original_post_id: postId,
          collection_id: collectionId,
          script: version.script,
          slide_plans: version.slidePlans,
          generated_media_urls: [],
          generation_state: {
            setType: version.setType,
            adaptationMode: version.adaptationMode,
            versionLabel: version.label,
          },
          status: "draft",
        };

        let { data: inserted, error: insertError } = await supabase
          .from("recreated_posts")
          .insert(draftPayload)
          .select("id")
          .single();

        if (insertError && /generation_state/i.test(insertError.message || "")) {
          const fallbackPayload = { ...draftPayload };
          delete fallbackPayload.generation_state;

          const fallbackInsert = await supabase
            .from("recreated_posts")
            .insert(fallbackPayload)
            .select("id")
            .single();

          inserted = fallbackInsert.data;
          insertError = fallbackInsert.error;
        }

        if (insertError) throw insertError;
        if (!inserted) throw new Error("Failed to create recreated post row");

        return {
          ...version,
          recreatedPostId: inserted.id,
        };
      })
    );

    const generationId = `${recreatedPostId || "run"}-${Date.now()}`;

    // Generate images from asset prompts and persist incrementally
    const versionExecution = await Promise.all(
      versionsWithRows.map(async (version) => {
        const rowId = version.recreatedPostId;
        if (!rowId) {
          return {
            success: false as const,
            versionId: version.id,
            label: version.label,
            error: "Missing recreated post row id for generation.",
          };
        }

        try {
          await persistRecreatedPost({
            recreatedPostId: rowId,
            collectionId,
            postId,
            status: "generating",
            script: version.script,
            slidePlans: version.slidePlans,
            generatedMediaUrls: [],
          });

          const partialImages: string[] = [];

          const images = await generateSlideImages(version.slidePlans, {
            collectionId,
            postId,
            platform,
            generationId,
            versionId: version.id,
            imageModel: imageGenerationModel,
            onSlideComplete: async ({ slideIndex, imageUrl }) => {
              partialImages[slideIndex] = imageUrl;
              const generatedMediaUrls = partialImages.filter(
                (item): item is string => typeof item === "string" && item.trim().length > 0
              );

              try {
                await persistRecreatedPost({
                  recreatedPostId: rowId,
                  collectionId,
                  postId,
                  status: "generating",
                  generatedMediaUrls,
                });
              } catch (persistError) {
                console.error("[recreate/generate] failed to persist partial images", {
                  recreatedPostId: rowId,
                  versionId: version.id,
                  slideIndex,
                  error: persistError instanceof Error ? persistError.message : String(persistError),
                });
              }
            },
            uiGenerationMode: version.uiGenerationMode,
            referenceImageUrls,
            brandAssets: {
              appName,
              primaryColorHex: APP_BRAND_PRIMARY_COLOR,
              gradientHexColors: APP_BRAND_GRADIENT,
              logoImagePath: APP_LOGO_PATH,
              featureMockupPath: APP_FEATURE_MOCKUP_PATH,
            },
          });

          await persistRecreatedPost({
            recreatedPostId: rowId,
            collectionId,
            postId,
            status: "completed",
            script: version.script,
            generatedMediaUrls: images,
            slidePlans: version.slidePlans,
          });

          return {
            success: true as const,
            result: {
              id: version.id,
              label: version.label,
              adaptationMode: version.adaptationMode,
              usesAppContext: version.usesAppContext,
              uiGenerationMode: version.uiGenerationMode,
              followsReferenceLayout: version.followsReferenceLayout,
              script: version.script,
              plans: version.slidePlans,
              images,
              recreatedPostId: rowId,
            },
          };
        } catch (versionError) {
          await persistRecreatedPost({
            recreatedPostId: rowId,
            collectionId,
            postId,
            status: "failed",
            script: version.script,
            slidePlans: version.slidePlans,
          });

          return {
            success: false as const,
            versionId: version.id,
            label: version.label,
            recreatedPostId: rowId,
            error:
              versionError instanceof Error
                ? versionError.message
                : "Image generation pipeline failed.",
          };
        }
      })
    );

    const persistedVersionResults = versionExecution
      .filter((entry): entry is Extract<(typeof versionExecution)[number], { success: true }> => entry.success)
      .map((entry) => entry.result);

    const failedVersions = versionExecution
      .filter((entry): entry is Extract<(typeof versionExecution)[number], { success: false }> => !entry.success)
      .map((entry) => ({
        versionId: entry.versionId,
        label: entry.label,
        recreatedPostId: "recreatedPostId" in entry ? entry.recreatedPostId || null : null,
        error: entry.error,
      }));

    if (persistedVersionResults.length === 0) {
      throw new Error(
        failedVersions[0]?.error || "All version image pipelines failed before producing any output."
      );
    }

    const firstRequestedVersionId = versionsWithRows[0]?.id;
    const persistedPrimaryResult =
      persistedVersionResults.find((result) => result.id === firstRequestedVersionId) ||
      persistedVersionResults[0];

    return NextResponse.json({
      images: persistedPrimaryResult.images,
      plans: persistedPrimaryResult.plans,
      primaryVersionId: persistedPrimaryResult.id,
      recreatedPostId: persistedPrimaryResult.recreatedPostId || null,
      imageGenerationModel,
      reasoningModel,
      versionResults: persistedVersionResults,
      failedVersions,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate images" },
      { status: 500 }
    );
  }
}
