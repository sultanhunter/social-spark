import { NextRequest, NextResponse } from "next/server";
import {
  createTopicResearchBrief,
  discoverTrendingBlogTopic,
  generateSeoBlogDraft,
  BLOG_REASONING_MODEL,
} from "@/lib/blog-agent";
import { generateBlogImages, injectBlogImagesIntoMarkdown } from "@/lib/blog-image";
import { createBlogDraft } from "@/lib/muslimah-blog-api";
import { isReasoningModel } from "@/lib/reasoning-model";
import { supabase } from "@/lib/supabase";

export const maxDuration = 600;

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getCollectionAppContext(collection: unknown): string {
  if (typeof collection !== "object" || collection === null) return "";
  const row = collection as Record<string, unknown>;

  return (
    asNonEmptyString(row.app_description) ||
    asNonEmptyString(row.app_context) ||
    "Muslimah Pro supports Muslim women with faith-centered wellness, period tracking, and practical Islamic guidance."
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const collectionId = asNonEmptyString(body.collectionId);
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : BLOG_REASONING_MODEL;

    if (!collectionId) {
      return NextResponse.json(
        { error: "Collection ID is required." },
        { status: 400 }
      );
    }

    const { data: collection, error: collectionError } = await supabase
      .from("collections")
      .select("*")
      .eq("id", collectionId)
      .single();

    if (collectionError || !collection) {
      return NextResponse.json({ error: "Collection not found." }, { status: 404 });
    }

    const appName = asNonEmptyString(collection.app_name) || "Muslimah Pro";
    const appContext = getCollectionAppContext(collection);

    let topicPlan;
    try {
      topicPlan = await discoverTrendingBlogTopic({
        appName,
        appContext,
        reasoningModel,
      });
    } catch (error) {
      throw new Error(
        `Trend discovery failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    let research;
    try {
      research = await createTopicResearchBrief({
        topic: topicPlan.selectedTopic,
        appName,
        appContext,
        reasoningModel,
      });
    } catch (error) {
      throw new Error(
        `Topic research failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    let draft;
    try {
      draft = await generateSeoBlogDraft({
        topic: topicPlan.selectedTopic,
        appName,
        appContext,
        research,
        reasoningModel,
      });
    } catch (error) {
      throw new Error(
        `Draft generation failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    let generatedImages;
    try {
      generatedImages = await generateBlogImages({
        topic: topicPlan.selectedTopic,
        title: draft.title,
        slug: draft.slug,
        research,
        reasoningModel,
      });
    } catch (error) {
      throw new Error(
        `Image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    const draftWithImages = {
      ...draft,
      content: injectBlogImagesIntoMarkdown({
        markdown: draft.content,
        title: draft.title,
        coverImageUrl: generatedImages.coverImageUrl,
        inlineImages: generatedImages.inlineImages,
      }),
      cover_image: generatedImages.coverImageUrl,
    };

    let draftPost;
    try {
      draftPost = await createBlogDraft(draftWithImages);
    } catch (error) {
      throw new Error(
        `Draft save failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    return NextResponse.json({
      model: reasoningModel,
      topicPlan,
      research,
      draft: draftWithImages,
      generatedImages,
      draftPost,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to research topic, generate content, and save blog draft.",
      },
      { status: 500 }
    );
  }
}
