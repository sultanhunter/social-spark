import { GoogleGenerativeAI } from "@google/generative-ai";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { uploadToR2, generateMediaKey } from "./r2";
import { getSlideImageSpec } from "./utils";
import type { SlideGenerationPlan } from "./gemini";

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
}

interface GenerateSlideImagesOptions {
  collectionId?: string;
  postId?: string;
  platform?: string;
  generationId?: string;
  versionId?: string;
  brandAssets?: BrandAssets;
}

interface BrandAssets {
  appName?: string;
  primaryColorHex?: string;
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

export async function generateImage(
  slidePlan: SlideGenerationPlan,
  options: GenerateImageOptions = {}
): Promise<string> {
  const { collectionId, postId, index, platform, generationId, versionId, brandAssets } = options;
  const model = genAI.getGenerativeModel({ model: "gemini-3-pro-image-preview" });
  const imageSpec = getSlideImageSpec(platform || "unknown");
  const { logoPart, featureMockupPart } = await getBrandImageParts(brandAssets);

  const brandRules = brandAssets
    ? `
BRAND GUIDELINES:
- Brand/app name: ${brandAssets.appName || "N/A"}
- Primary brand color: ${brandAssets.primaryColorHex || "N/A"}
- A logo reference image is attached${logoPart ? "" : " (not available at runtime)"}.
- A feature screenshot reference is attached${featureMockupPart ? "" : " (not available at runtime)"}.
- If the design includes app mockups or in-app UI surfaces, style those UI details based on the feature screenshot.
- If logo usage is appropriate for the composition, use only the provided logo style.
- Use the primary brand color as a recurring accent in typography/UI details.
`
    : "";

  const prompt = `Create ONE final social carousel slide image.

TEXT CONTENT TO RENDER IN IMAGE:
- Headline: ${slidePlan.headline}
- Supporting text: ${slidePlan.supportingText}

UI INSTRUCTIONS (must be followed):
${JSON.stringify(slidePlan.uiInstructions)}

VISUAL DIRECTION:
${slidePlan.imagePrompt}

${brandRules}

OUTPUT RULES:
- Render the full final designed slide (background + typography + UI), not a plain background.
- Keep typography clean and readable.
- Respect safe margins and composition.
- Do not add third-party logos or watermarks.
- Target size: ${imageSpec.width}x${imageSpec.height} (${imageSpec.aspectRatio}).`;

  const promptParts: Array<{ text: string } | GeminiInlineImagePart> = [{ text: prompt }];
  if (logoPart) promptParts.push(logoPart);
  if (featureMockupPart) promptParts.push(featureMockupPart);

  const result = await model.generateContent(promptParts);
  const response = result.response;

  const parts = ((response.candidates?.[0]?.content?.parts ?? []) as unknown) as Array<
    Record<string, unknown>
  >;
  const imagePart = parts.find((part) => "inlineData" in part) as PartWithInlineData | undefined;

  if (!imagePart?.inlineData?.data) {
    throw new Error("No image generated");
  }

  const generatedBuffer = Buffer.from(imagePart.inlineData.data, "base64");
  const normalizedBuffer = await normalizeImageForPlatform(generatedBuffer, platform);
  const mimeType = "image/png";
  const extension = "png";

  if (collectionId && postId) {
    const safeGenerationId = normalizeKeySegment(generationId || `${Date.now()}`);
    const safeVersionId = normalizeKeySegment(versionId || "default");
    const slideIndex = index !== undefined ? index + 1 : 1;
    const filename = `generated/${safeGenerationId}/${safeVersionId}/slide-${slideIndex}.${extension}`;
    const key = generateMediaKey(collectionId, postId, filename);
    return uploadToR2(key, normalizedBuffer, mimeType);
  }

  return `data:${mimeType};base64,${normalizedBuffer.toString("base64")}`;
}

export async function generateSlideImages(
  slidePlans: SlideGenerationPlan[],
  options: GenerateSlideImagesOptions = {}
): Promise<string[]> {
  const { collectionId, postId, platform, generationId, versionId, brandAssets } = options;

  return Promise.all(
    slidePlans.map((slidePlan, index) =>
      generateImage(slidePlan, {
        collectionId,
        postId,
        index,
        platform,
        generationId,
        versionId,
        brandAssets,
      })
    )
  );
}
