import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  detectNicheRelevance,
  extractSlideTexts,
  generatePostScript,
  generateSlideDesignPlans,
  type AdaptationMode,
  type SlideGenerationPlan,
  type UIGenerationMode,
} from "@/lib/gemini";
import {
  DEFAULT_REASONING_MODEL,
  isReasoningModel,
} from "@/lib/reasoning-model";

const APP_BRAND_PRIMARY_COLOR = "#F36F97";
const APP_BRAND_GRADIENT = ["#F36F97", "#EEB4C3", "#F7DFD6"];

interface ScriptVersion {
  id: string;
  label: string;
  adaptationMode: AdaptationMode;
  usesAppContext: boolean;
  uiGenerationMode: UIGenerationMode;
  followsReferenceLayout: boolean;
  script: string;
  slidePlans: SlideGenerationPlan[];
  recreatedPostId?: string;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getCollectionAppContext(collection: unknown): string {
  if (typeof collection !== "object" || collection === null) return "";
  const row = collection as Record<string, unknown>;
  return asNonEmptyString(row.app_description) || asNonEmptyString(row.app_context) || "";
}

function normalizeUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === "string" && url.length > 0);
}

function buildVersionLabel(adaptationMode: AdaptationMode): string {
  return adaptationMode === "app_context" ? "App Context" : "Original Topic";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const postId = asNonEmptyString(body.postId);
    const collectionId = asNonEmptyString(body.collectionId);
    const referenceImageUrls = body.referenceImageUrls;
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;

    if (!postId || !collectionId) {
      return NextResponse.json(
        { error: "Post ID and collection ID are required" },
        { status: 400 }
      );
    }

    // Fetch post and collection
    const [postResult, collectionResult] = await Promise.all([
      supabase.from("saved_posts").select("*").eq("id", postId).single(),
      supabase.from("collections").select("*").eq("id", collectionId).single(),
    ]);

    if (postResult.error) throw new Error("Post not found");
    if (collectionResult.error) throw new Error("Collection not found");

    const post = postResult.data;
    const collection = collectionResult.data;

    const appName = asNonEmptyString(collection?.app_name);
    const appContext = getCollectionAppContext(collection);

    if (!appName) {
      return NextResponse.json(
        { error: "Collection is missing an app name." },
        { status: 400 }
      );
    }

    if (!appContext) {
      return NextResponse.json(
        {
          error: "Please provide an app description so the AI can understand your app context.",
        },
        { status: 400 }
      );
    }

    const availableImageUrls = [
      ...(Array.isArray(post.media_urls) ? post.media_urls : []),
      ...(post.thumbnail_url ? [post.thumbnail_url] : []),
    ];

    const selectedReferenceImageUrls = Array.isArray(referenceImageUrls)
      ? Array.from(
        new Set(
          normalizeUrls(referenceImageUrls)
            .filter((url) => availableImageUrls.includes(url))
        )
      ).slice(0, 8)
      : availableImageUrls.slice(0, 8);

    // ---------- Step 1: Extract text from each original slide ----------
    console.log("[script] Step 1: Extracting slide texts from original images...");
    const extractedTexts = await extractSlideTexts(selectedReferenceImageUrls, reasoningModel);

    // Build an "original script" from extracted texts for the rewrite step
    const originalExtractedScript = extractedTexts
      .map((slide, i) => `Slide ${i + 1}\nHeadline: ${slide.headline || "(no text)"}\nSupporting: ${slide.supportingText || "(no text)"}`)
      .join("\n\n");

    console.log("[script] Extracted original script from slides:", originalExtractedScript.slice(0, 300));

    // ---------- Niche classification ----------
    const nicheRelevance = await detectNicheRelevance(
      {
        title: post.title,
        description: post.description,
        platform: post.platform,
      },
      appContext,
      appName,
      selectedReferenceImageUrls,
      reasoningModel
    );

    const isIslamic = nicheRelevance.isIslamic;
    const isPregnancyOrPeriodRelated = nicheRelevance.isPregnancyOrPeriodRelated;
    const canIncorporateAppContext = nicheRelevance.canIncorporateAppContext;
    const canReframeToIslamicAppContext = nicheRelevance.canReframeToIslamicAppContext;
    const canRecreate = nicheRelevance.canRecreate;

    if (!canRecreate) {
      return NextResponse.json({
        script: "",
        slidePlans: [],
        versions: [],
        primaryVersionId: null,
        canRecreate: false,
        isIslamic,
        isPregnancyOrPeriodRelated,
        canIncorporateAppContext,
        canReframeToIslamicAppContext,
        isAppNicheRelevant: nicheRelevance.isAppNicheRelevant,
        relevanceReason: nicheRelevance.reason,
        relevanceConfidence: nicheRelevance.confidence,
        recreatedPostId: null,
      });
    }

    const originalPost = {
      title: post.title,
      description: `${post.description || ""}\n\nEXTRACTED SLIDE TEXTS FROM ORIGINAL POST:\n${originalExtractedScript}`,
      platform: post.platform,
      postType: post.post_type,
    };

    const adaptationModes: AdaptationMode[] = isIslamic
      ? ["variant_only", "app_context"]
      : isPregnancyOrPeriodRelated && canReframeToIslamicAppContext
        ? ["app_context"]
        : [];

    if (adaptationModes.length === 0) {
      return NextResponse.json({
        script: "",
        slidePlans: [],
        versions: [],
        primaryVersionId: null,
        canRecreate: false,
        isIslamic,
        isPregnancyOrPeriodRelated,
        canIncorporateAppContext,
        canReframeToIslamicAppContext,
        isAppNicheRelevant: nicheRelevance.isAppNicheRelevant,
        relevanceReason: nicheRelevance.reason,
        relevanceConfidence: nicheRelevance.confidence,
        recreatedPostId: null,
      });
    }

    // ---------- Step 2: Generate rewritten scripts (all slides at once) ----------
    console.log("[script] Step 2: Generating rewritten scripts...");
    const scriptsByMode = await Promise.all(
      adaptationModes.map(async (mode) => {
        const script = await generatePostScript(
          originalPost,
          appContext,
          appName,
          selectedReferenceImageUrls,
          nicheRelevance,
          mode,
          reasoningModel
        );

        return { mode, script };
      })
    );

    const scriptMap = new Map<AdaptationMode, string>(
      scriptsByMode.map((entry) => [entry.mode, entry.script])
    );

    // ---------- Step 3: Per-slide Figma instructions + asset prompts ----------
    console.log("[script] Step 3: Generating per-slide design plans...");
    const versions = await Promise.all(
      adaptationModes.map(async (mode): Promise<ScriptVersion> => {
        const modeScript = scriptMap.get(mode);
        if (!modeScript) {
          throw new Error(`Missing generated script for adaptation mode: ${mode}`);
        }

        const slidePlans = await generateSlideDesignPlans(
          selectedReferenceImageUrls,
          modeScript,
          post.platform,
          APP_BRAND_PRIMARY_COLOR,
          APP_BRAND_GRADIENT,
          appName,
          reasoningModel
        );

        return {
          id: mode,
          label: buildVersionLabel(mode),
          adaptationMode: mode,
          usesAppContext: mode === "app_context",
          uiGenerationMode: "ai_creative" as UIGenerationMode,
          followsReferenceLayout: false,
          script: modeScript,
          slidePlans,
        };
      })
    );

    const primaryVersion = versions[0];

    const script = primaryVersion.script;
    const slidePlans = primaryVersion.slidePlans;

    const versionsWithRecreatedIds = await Promise.all(
      versions.map(async (version) => {
        const { data: recreated, error: insertError } = await supabase
          .from("recreated_posts")
          .insert({
            original_post_id: postId,
            collection_id: collectionId,
            script: version.script,
            status: "draft",
          })
          .select("id")
          .single();

        if (insertError) throw insertError;

        return {
          ...version,
          recreatedPostId: recreated.id,
        };
      })
    );

    const primaryVersionWithId = versionsWithRecreatedIds[0];

    return NextResponse.json({
      script,
      slidePlans,
      versions: versionsWithRecreatedIds,
      primaryVersionId: primaryVersionWithId.id,
      canRecreate,
      isIslamic,
      isPregnancyOrPeriodRelated,
      canIncorporateAppContext,
      canReframeToIslamicAppContext,
      isAppNicheRelevant: nicheRelevance.isAppNicheRelevant,
      relevanceReason: nicheRelevance.reason,
      relevanceConfidence: nicheRelevance.confidence,
      reasoningModel,
      recreatedPostId: primaryVersionWithId.recreatedPostId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate script" },
      { status: 500 }
    );
  }
}
