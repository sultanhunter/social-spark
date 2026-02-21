import { GoogleGenerativeAI } from "@google/generative-ai";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { uploadToR2, generateMediaKey } from "./r2";
import { getSlideImageSpec } from "./utils";
import type { SlideGenerationPlan } from "./gemini";
import type { UIGenerationMode } from "./gemini";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  type ImageGenerationModel,
} from "./image-generation-model";

interface PartWithInlineData {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
}

interface GenerateImageOptions {
  collectionId?: string;
  postId?: string;
  index?: number;
  platform?: string;
  generationId?: string;
  versionId?: string;
  brandAssets?: BrandAssets;
  uiGenerationMode?: UIGenerationMode;
  referenceImageUrls?: string[];
  imageModel?: ImageGenerationModel;
}

interface GenerateSlideImagesOptions {
  collectionId?: string;
  postId?: string;
  platform?: string;
  generationId?: string;
  versionId?: string;
  brandAssets?: BrandAssets;
  uiGenerationMode?: UIGenerationMode;
  referenceImageUrls?: string[];
  imageModel?: ImageGenerationModel;
  onSlideComplete?: (update: { slideIndex: number; imageUrl: string }) => Promise<void> | void;
}

interface BrandAssets {
  appName?: string;
  primaryColorHex?: string;
  gradientHexColors?: string[];
  logoImagePath?: string;
  featureMockupPath?: string;
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

type GeminiInlineImagePart = {
  inlineData: {
    data: string;
    mimeType: string;
  };
};

function isImagenPredictModel(model: ImageGenerationModel): boolean {
  return model.startsWith("imagen-");
}

async function generateImageWithImagenPredict(
  model: ImageGenerationModel,
  prompt: string,
  sampleCount: number = 1
): Promise<Buffer> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_GEMINI_API_KEY is required for Imagen models.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount,
        },
      }),
    }
  );

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const errorMessage =
      typeof payload?.error === "object" &&
        payload.error !== null &&
        typeof (payload.error as Record<string, unknown>).message === "string"
        ? ((payload.error as Record<string, unknown>).message as string)
        : `Imagen predict request failed (${response.status})`;
    throw new Error(errorMessage);
  }

  const predictions = Array.isArray(payload.predictions)
    ? (payload.predictions as Array<Record<string, unknown>>)
    : [];
  const firstPrediction = predictions[0];
  const bytesBase64Encoded =
    typeof firstPrediction?.bytesBase64Encoded === "string"
      ? firstPrediction.bytesBase64Encoded
      : typeof firstPrediction?.image === "object" &&
        firstPrediction.image !== null &&
        typeof (firstPrediction.image as Record<string, unknown>).bytesBase64Encoded === "string"
        ? ((firstPrediction.image as Record<string, unknown>).bytesBase64Encoded as string)
        : null;

  if (!bytesBase64Encoded) {
    throw new Error("Imagen model did not return image bytes.");
  }

  return Buffer.from(bytesBase64Encoded, "base64");
}

function mimeTypeFromPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/jpeg";
}

async function loadLocalImagePart(filePath: string): Promise<GeminiInlineImagePart | null> {
  try {
    const imageBuffer = await fs.readFile(filePath);
    return {
      inlineData: {
        data: imageBuffer.toString("base64"),
        mimeType: mimeTypeFromPath(filePath),
      },
    };
  } catch {
    return null;
  }
}

async function loadRemoteImagePart(url: string): Promise<GeminiInlineImagePart | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
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

async function getBrandImageParts(brandAssets?: BrandAssets): Promise<{
  logoPart: GeminiInlineImagePart | null;
  featureMockupPart: GeminiInlineImagePart | null;
}> {
  if (!brandAssets) {
    return {
      logoPart: null,
      featureMockupPart: null,
    };
  }

  const [logoPart, featureMockupPart] = await Promise.all([
    brandAssets.logoImagePath ? loadLocalImagePart(brandAssets.logoImagePath) : Promise.resolve(null),
    brandAssets.featureMockupPath ? loadLocalImagePart(brandAssets.featureMockupPath) : Promise.resolve(null),
  ]);

  return { logoPart, featureMockupPart };
}

async function normalizeImageForPlatform(imageBuffer: Buffer, platform: string = "unknown"): Promise<Buffer> {
  const imageSpec = getSlideImageSpec(platform);
  return sharp(imageBuffer)
    .resize(imageSpec.width, imageSpec.height, {
      fit: "cover",
      position: "center",
    })
    .png()
    .toBuffer();
}

function normalizeKeySegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
}

function parseGeneratedImagePart(
  result: Awaited<ReturnType<ReturnType<typeof genAI.getGenerativeModel>["generateContent"]>>
): PartWithInlineData | undefined {
  const response = result.response;
  const parts = ((response.candidates?.[0]?.content?.parts ?? []) as unknown) as Array<
    Record<string, unknown>
  >;
  return parts.find((part) => "inlineData" in part) as PartWithInlineData | undefined;
}

export async function generateImage(
  assetPromptText: string,
  options: GenerateImageOptions = {}
): Promise<string> {
  const {
    collectionId,
    postId,
    index,
    platform,
    generationId,
    versionId,
    brandAssets,
    uiGenerationMode = "ai_creative",
    referenceImageUrls = [],
    imageModel = DEFAULT_IMAGE_GENERATION_MODEL,
  } = options;

  const supportsInlineImageContext = !isImagenPredictModel(imageModel);
  const imageSpec = getSlideImageSpec(platform || "unknown");
  const { logoPart, featureMockupPart } = supportsInlineImageContext
    ? await getBrandImageParts(brandAssets)
    : { logoPart: null, featureMockupPart: null };
  const exactUiReferencePart =
    supportsInlineImageContext && uiGenerationMode === "reference_exact" && referenceImageUrls.length > 0
      ? await loadRemoteImagePart(referenceImageUrls[0])
      : null;

  const gradientStr = brandAssets?.gradientHexColors?.length
    ? brandAssets.gradientHexColors.join(" → ")
    : brandAssets?.primaryColorHex || "";

  const brandRules = brandAssets
    ? `
BRAND TONE GUIDELINES:
- Brand/app name: ${brandAssets.appName || "N/A"}
- Primary brand color: ${brandAssets.primaryColorHex || "N/A"}
- Brand gradient: ${gradientStr}
- Use the warm pink-to-blush gradient tones (${gradientStr}) to influence the mood, lighting, and color palette of the asset.
- If generating a mockup or UI screenshot asset, style it based on brand context.
`
    : "";

  const referenceModeRule =
    uiGenerationMode === "reference_exact"
      ? supportsInlineImageContext
        ? "- Match the attached reference image's visual mood and color palette closely."
        : "- Match the source post's visual mood and color palette based on the prompt instructions."
      : "- Keep quality high but allow fresh visual exploration.";

  const prompt = `Generate ONE clean visual design asset image. This will be used as a background or visual element inside a slide that a designer will assemble in Figma.

ASSET DESCRIPTION:
${assetPromptText}

${brandRules}

STYLE REFERENCE:
- ${referenceModeRule}
- Do NOT copy source people, products, logos, or scene details.

CRITICAL OUTPUT RULES:
- Do NOT render any text, headlines, typography, captions, or UI overlays into the image.
- Do NOT include any words, letters, or numbers in the generated image.
- The image must be a clean visual asset only (photo, illustration, texture, pattern, gradient, 3D render, etc.).
- Do not add third-party logos or watermarks.
- Target size: ${imageSpec.width}x${imageSpec.height} (${imageSpec.aspectRatio}).`;

  const promptParts: Array<{ text: string } | GeminiInlineImagePart> = [{ text: prompt }];
  if (exactUiReferencePart) promptParts.push(exactUiReferencePart);
  if (logoPart) promptParts.push(logoPart);
  if (featureMockupPart) promptParts.push(featureMockupPart);

  const generatedBuffer = supportsInlineImageContext
    ? await (async () => {
      const model = genAI.getGenerativeModel({ model: imageModel });
      const result = await model.generateContent(promptParts);
      const imagePart = parseGeneratedImagePart(result);

      if (!imagePart?.inlineData?.data) {
        throw new Error("No image generated");
      }

      return Buffer.from(imagePart.inlineData.data, "base64");
    })()
    : await generateImageWithImagenPredict(imageModel, prompt, 1);

  const finalizedBuffer = await normalizeImageForPlatform(generatedBuffer, platform);
  const mimeType = "image/png";
  const extension = "png";

  if (collectionId && postId) {
    const safeGenerationId = normalizeKeySegment(generationId || `${Date.now()}`);
    const safeVersionId = normalizeKeySegment(versionId || "default");
    const slideIndex = index !== undefined ? index + 1 : 1;
    const filename = `generated/${safeGenerationId}/${safeVersionId}/slide-${slideIndex}.${extension}`;
    const key = generateMediaKey(collectionId, postId, filename);
    return uploadToR2(key, finalizedBuffer, mimeType);
  }

  return `data:${mimeType};base64,${finalizedBuffer.toString("base64")}`;
}

export async function generateSlideImages(
  slidePlans: SlideGenerationPlan[],
  options: GenerateSlideImagesOptions = {}
): Promise<string[]> {
  const {
    collectionId,
    postId,
    platform,
    generationId,
    versionId,
    brandAssets,
    uiGenerationMode,
    referenceImageUrls,
    imageModel,
    onSlideComplete,
  } = options;

  const images: string[] = [];

  for (let slideIndex = 0; slideIndex < slidePlans.length; slideIndex += 1) {
    const plan = slidePlans[slideIndex];
    const assetPrompts = plan.assetPrompts;

    if (assetPrompts.length === 0) {
      // No asset prompts for this slide — generate a default branded background
      const imageUrl = await generateImage(
        "Clean abstract background with soft pink-to-blush gradients, suitable as a design asset for a social slide.",
        {
          collectionId,
          postId,
          index: slideIndex,
          platform,
          generationId,
          versionId,
          brandAssets,
          uiGenerationMode,
          referenceImageUrls,
          imageModel,
        }
      );
      images.push(imageUrl);
      await onSlideComplete?.({ slideIndex, imageUrl });
      continue;
    }

    // Generate each asset for this slide
    for (let assetIndex = 0; assetIndex < assetPrompts.length; assetIndex += 1) {
      const asset = assetPrompts[assetIndex];
      const imageUrl = await generateImage(asset.prompt, {
        collectionId,
        postId,
        index: slideIndex * 10 + assetIndex, // unique index for file naming
        platform,
        generationId,
        versionId,
        brandAssets,
        uiGenerationMode,
        referenceImageUrls,
        imageModel,
      });
      images.push(imageUrl);
    }

    // Report the first asset of this slide as the slide completion
    if (images.length > 0) {
      await onSlideComplete?.({ slideIndex, imageUrl: images[images.length - assetPrompts.length] });
    }
  }

  return images;
}
