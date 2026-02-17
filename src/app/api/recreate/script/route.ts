import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  detectNicheRelevance,
  generateImagePrompts,
  generatePostScript,
  type AdaptationMode,
  type SlideGenerationPlan,
} from "@/lib/gemini";

interface ScriptVersion {
  id: "app_context" | "variant_only";
  label: string;
  adaptationMode: AdaptationMode;
  usesAppContext: boolean;
  script: string;
  slidePlans: SlideGenerationPlan[];
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const postId = asNonEmptyString(body.postId);
    const collectionId = asNonEmptyString(body.collectionId);
    const referenceImageUrls = body.referenceImageUrls;

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

    const nicheRelevance = await detectNicheRelevance(
      {
        title: post.title,
        description: post.description,
        platform: post.platform,
      },
      appContext,
      appName,
      selectedReferenceImageUrls
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

    const inferredSlideCount = Array.isArray(post.media_urls)
      ? Math.min(Math.max(post.media_urls.length || 6, 4), 8)
      : 6;

    const originalPost = {
      title: post.title,
      description: post.description,
      platform: post.platform,
      postType: post.post_type,
    };

    const buildVersion = async (mode: AdaptationMode): Promise<ScriptVersion> => {
      const script = await generatePostScript(
        originalPost,
        appContext,
        appName,
        selectedReferenceImageUrls,
        nicheRelevance,
        mode
      );

      const slidePlans = await generateImagePrompts(
        script,
        appName,
        inferredSlideCount,
        post.platform,
        selectedReferenceImageUrls,
        appContext,
        nicheRelevance,
        mode
      );

      return {
        id: mode,
        label: mode === "app_context" ? "App Context Rewrite" : "Original Topic Variant",
        adaptationMode: mode,
        usesAppContext: mode === "app_context",
        script,
        slidePlans,
      };
    };

    const adaptationModes: AdaptationMode[] = isIslamic
      ? isPregnancyOrPeriodRelated
        ? ["app_context"]
        : canIncorporateAppContext
          ? ["variant_only", "app_context"]
          : ["variant_only"]
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

    const versions = await Promise.all(adaptationModes.map((mode) => buildVersion(mode)));

    const primaryVersion = versions[0];

    const script = primaryVersion.script;
    const slidePlans = primaryVersion.slidePlans;

    // Save recreated post record
    const { data: recreated, error: insertError } = await supabase
      .from("recreated_posts")
      .insert({
        original_post_id: postId,
        collection_id: collectionId,
        script,
        status: "draft",
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({
      script,
      slidePlans,
      versions,
      primaryVersionId: primaryVersion.id,
      canRecreate,
      isIslamic,
      isPregnancyOrPeriodRelated,
      canIncorporateAppContext,
      canReframeToIslamicAppContext,
      isAppNicheRelevant: nicheRelevance.isAppNicheRelevant,
      relevanceReason: nicheRelevance.reason,
      relevanceConfidence: nicheRelevance.confidence,
      recreatedPostId: recreated.id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate script" },
      { status: 500 }
    );
  }
}
