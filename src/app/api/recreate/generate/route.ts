import { NextRequest, NextResponse } from "next/server";
import { detectNicheRelevance, generateImagePrompts } from "@/lib/gemini";
import type { AdaptationMode, SlideGenerationPlan } from "@/lib/gemini";
import { generateSlideImages } from "@/lib/gemini-image";
import { supabase } from "@/lib/supabase";

const APP_BRAND_PRIMARY_COLOR = "#EE6A84";
const APP_LOGO_PATH = "/Users/sultanibneusman/Desktop/Perri/assets/images/app-logo.png";
const APP_FEATURE_MOCKUP_PATH = "/Users/sultanibneusman/Downloads/feature screenshots/main_hero.PNG";

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

interface GenerationVersionInput {
  id: string;
  label: string;
  adaptationMode: AdaptationMode;
  usesAppContext: boolean;
  script: string;
  slidePlans: SlideGenerationPlan[];
}

function sanitizeSlidePlans(rawPlans: unknown): SlideGenerationPlan[] {
  if (!Array.isArray(rawPlans)) return [];

  return rawPlans
    .map((item): SlideGenerationPlan | null => {
      if (typeof item !== "object" || item === null) return null;

      const plan = item as Record<string, unknown>;
      const imagePrompt = typeof plan.imagePrompt === "string" ? plan.imagePrompt.trim() : "";
      const headline = typeof plan.headline === "string" ? plan.headline.trim() : "";
      const supportingText =
        typeof plan.supportingText === "string" ? plan.supportingText.trim() : "";

      const textPlacement =
        typeof plan.textPlacement === "string" && ["top", "center", "bottom"].includes(plan.textPlacement)
          ? (plan.textPlacement as "top" | "center" | "bottom")
          : "top";

      const uiRaw =
        typeof plan.uiInstructions === "object" && plan.uiInstructions !== null
          ? (plan.uiInstructions as Record<string, unknown>)
          : null;

      if (!imagePrompt || !headline || !uiRaw) return null;

      const typography =
        typeof uiRaw.typography === "object" && uiRaw.typography !== null
          ? (uiRaw.typography as Record<string, unknown>)
          : null;

      if (!typography) return null;

      const alignment =
        typeof typography.alignment === "string" && ["left", "center", "right"].includes(typography.alignment)
          ? (typography.alignment as "left" | "center" | "right")
          : "left";

      const composition =
        typeof uiRaw.composition === "object" && uiRaw.composition !== null
          ? (uiRaw.composition as Record<string, unknown>)
          : {};
      const styling =
        typeof uiRaw.styling === "object" && uiRaw.styling !== null
          ? (uiRaw.styling as Record<string, unknown>)
          : {};

      const uiInstructions: SlideGenerationPlan["uiInstructions"] = {
        layoutConcept:
          typeof uiRaw.layoutConcept === "string" ? uiRaw.layoutConcept : "Editorial layout",
        artDirection: typeof uiRaw.artDirection === "string" ? uiRaw.artDirection : "Clean social aesthetic",
        typography: {
          headlineFontFamily:
            typeof typography.headlineFontFamily === "string"
              ? typography.headlineFontFamily
              : "Space Grotesk",
          headlineFontWeight:
            typeof typography.headlineFontWeight === "string" ? typography.headlineFontWeight : "700",
          supportingFontFamily:
            typeof typography.supportingFontFamily === "string"
              ? typography.supportingFontFamily
              : "Inter",
          supportingFontWeight:
            typeof typography.supportingFontWeight === "string"
              ? typography.supportingFontWeight
              : "500",
          alignment,
        },
        composition: {
          textArea: typeof composition.textArea === "string" ? composition.textArea : "Upper third",
          safeMargins: typeof composition.safeMargins === "string" ? composition.safeMargins : "8%",
          elementNotes: Array.isArray(composition.elementNotes)
            ? composition.elementNotes.filter((note): note is string => typeof note === "string")
            : [],
        },
        styling: {
          panelStyle: typeof styling.panelStyle === "string" ? styling.panelStyle : "Soft panel",
          accentStyle: typeof styling.accentStyle === "string" ? styling.accentStyle : "Minimal accent",
          iconStyle: typeof styling.iconStyle === "string" ? styling.iconStyle : "Simple iconography",
        },
      };

      return {
        imagePrompt,
        headline,
        supportingText,
        textPlacement,
        uiInstructions,
      };
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
          adaptationMode,
          usesAppContext: adaptationMode === "app_context",
          script: versionScript,
          slidePlans: sanitizeSlidePlans(item.slidePlans),
        };
      })
      .filter((version): version is GenerationVersionInput => Boolean(version));

    const fallbackVersion: GenerationVersionInput | null = script
      ? {
          id: fallbackMode,
          label: fallbackMode === "app_context" ? "App Context Rewrite" : "Original Topic Variant",
          adaptationMode: fallbackMode,
          usesAppContext: fallbackMode === "app_context",
          script,
          slidePlans: sanitizeSlidePlans(incomingSlidePlans),
        }
      : null;

    const versionsToGenerate = explicitVersions.length > 0
      ? explicitVersions
      : fallbackVersion
        ? [fallbackVersion]
        : [];

    if (versionsToGenerate.length === 0) {
      throw new Error("No valid generation version payload found.");
    }

    let nicheResultPromise: Promise<Awaited<ReturnType<typeof detectNicheRelevance>>> | null = null;
    const getNicheResult = async () => {
      if (!nicheResultPromise) {
        nicheResultPromise = detectNicheRelevance(
          {
            title: null,
            description: null,
            platform,
          },
          appContext,
          appName,
          referenceImageUrls
        );
      }
      return nicheResultPromise;
    };

    const hydratedVersions = await Promise.all(
      versionsToGenerate.map(async (version) => {
        if (version.slidePlans.length > 0) return version;

        const niche = await getNicheResult();
        const slidePlans = await generateImagePrompts(
          version.script,
          appName,
          6,
          platform,
          referenceImageUrls,
          appContext || undefined,
          niche,
          version.adaptationMode
        );

        return {
          ...version,
          slidePlans,
        };
      })
    );

    const generationId = `${recreatedPostId || "run"}-${Date.now()}`;

    // Step 2: Generate all image variants
    const versionResults = await Promise.all(
      hydratedVersions.map(async (version) => {
        const images = await generateSlideImages(version.slidePlans, {
          collectionId,
          postId,
          platform,
          generationId,
          versionId: version.id,
          brandAssets: version.usesAppContext
            ? {
                appName,
                primaryColorHex: APP_BRAND_PRIMARY_COLOR,
                logoImagePath: APP_LOGO_PATH,
                featureMockupPath: APP_FEATURE_MOCKUP_PATH,
              }
            : undefined,
        });

        return {
          id: version.id,
          label: version.label,
          adaptationMode: version.adaptationMode,
          usesAppContext: version.usesAppContext,
          script: version.script,
          plans: version.slidePlans,
          images,
        };
      })
    );

    const primaryResult = versionResults[0];
    const images = primaryResult.images;

    // Step 3: Persist this recreation session
    if (recreatedPostId) {
      const { error: updateError } = await supabase
        .from("recreated_posts")
        .update({
          script: primaryResult.script,
          generated_media_urls: images,
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", recreatedPostId)
        .eq("original_post_id", postId)
        .eq("collection_id", collectionId);

      if (updateError) {
        console.error("Failed to update recreated post:", updateError);
      }
    } else {
      const { error: insertError } = await supabase
        .from("recreated_posts")
        .insert({
          original_post_id: postId,
          collection_id: collectionId,
          script: primaryResult.script,
          generated_media_urls: images,
          status: "completed",
        });

      if (insertError) {
        console.error("Failed to insert recreated post:", insertError);
      }
    }

    return NextResponse.json({
      images,
      plans: primaryResult.plans,
      primaryVersionId: primaryResult.id,
      versionResults,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate images" },
      { status: 500 }
    );
  }
}
