import { NextRequest, NextResponse } from "next/server";
import { publishInstagramPostSet } from "@/lib/instagram-publisher";
import {
  generateMuslimahCarousel,
  generateMuslimahCarouselImages,
  generateMuslimahCarouselScript,
  MUSLIMAH_IMAGE_MODEL,
  MUSLIMAH_IMAGE_QUALITY,
  MUSLIMAH_IMAGE_SIZE,
  MUSLIMAH_SCRIPT_MODEL,
  type MuslimahCarouselScript,
} from "@/lib/muslimah-carousel-agent";

export const maxDuration = 800;

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function asScript(value: unknown): MuslimahCarouselScript | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (row.brand !== "muslimah.health" || !Array.isArray(row.slides)) return null;
  return value as MuslimahCarouselScript;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const collectionId = asNonEmptyString(body.collectionId) || "muslimah-health";
    const scriptModel = asNonEmptyString(body.scriptModel) || MUSLIMAH_SCRIPT_MODEL;
    const imageModel = asNonEmptyString(body.imageModel) || MUSLIMAH_IMAGE_MODEL;
    const generateImages = asBoolean(body.generateImages, true);
    const publish = asBoolean(body.publish, false);
    const existingScript = asScript(body.script);

    const script = existingScript || await generateMuslimahCarouselScript({
      scriptModel,
      focus: asNonEmptyString(body.focus) || undefined,
      previousHookBackground: asNonEmptyString(body.previousHookBackground) || undefined,
      previousFeatures: asStringArray(body.previousFeatures),
    });

    if (!generateImages) {
      return NextResponse.json({
        scriptModel,
        imageModel,
        imageQuality: MUSLIMAH_IMAGE_QUALITY,
        imageSize: MUSLIMAH_IMAGE_SIZE,
        generatedImages: false,
        published: false,
        script,
      });
    }

    const generation = existingScript
      ? {
          scriptModel,
          imageModel,
          imageQuality: MUSLIMAH_IMAGE_QUALITY,
          imageSize: MUSLIMAH_IMAGE_SIZE,
          script,
          images: await generateMuslimahCarouselImages({
            script,
            imageModel,
            collectionId,
            referenceImagePaths: asStringArray(body.referenceImagePaths),
          }),
        }
      : await generateMuslimahCarousel({
          script,
          scriptModel,
          imageModel,
          collectionId,
          referenceImagePaths: asStringArray(body.referenceImagePaths),
        });

    if (!publish) {
      return NextResponse.json({
        ...generation,
        generatedImages: true,
        published: false,
      });
    }

    const accessToken =
      asNonEmptyString(body.accessToken) || asNonEmptyString(process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN);
    const igUserId = asNonEmptyString(body.igUserId) || asNonEmptyString(process.env.INSTAGRAM_GRAPH_USER_ID);

    if (!accessToken || !igUserId) {
      return NextResponse.json(
        {
          error:
            "Instagram publishing is not configured. Set INSTAGRAM_GRAPH_ACCESS_TOKEN and INSTAGRAM_GRAPH_USER_ID, or send accessToken/igUserId in the request.",
          ...generation,
          generatedImages: true,
          published: false,
        },
        { status: 400 }
      );
    }

    const publishResult = await publishInstagramPostSet({
      accessToken,
      igUserId,
      imageUrls: generation.images.map((image) => image.imageUrl),
      caption: generation.script.caption,
      apiVersion: asNonEmptyString(process.env.INSTAGRAM_GRAPH_API_VERSION) || undefined,
    });

    return NextResponse.json({
      ...generation,
      generatedImages: true,
      published: true,
      publishResult,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate muslimah.health carousel.",
      },
      { status: 500 }
    );
  }
}
