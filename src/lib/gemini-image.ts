import { GoogleGenerativeAI } from "@google/generative-ai";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { uploadToR2, generateMediaKey } from "./r2";
import { getSlideImageSpec } from "./utils";
import type { SlideGenerationPlan } from "./gemini";
import type { UIGenerationMode } from "./gemini";
import type { VisualVariant } from "./gemini";
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
  characterReferenceImageUrls?: string[];
  characterLockDescriptor?: string;
  visualVariant?: VisualVariant;
  forceCarouselAspect?: boolean;
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
  visualVariant?: VisualVariant;
  forceCarouselAspect?: boolean;
  imageModel?: ImageGenerationModel;
  onSlideComplete?: (update: { slideIndex: number; imageUrl: string }) => Promise<void> | void;
}

interface BrandAssets {
  appName?: string;
  primaryColorHex?: string;
  gradientHexColors?: string[];
  logoImagePath?: string;
  featureMockupPath?: string;
  featureMockupUrl?: string;
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
    brandAssets.featureMockupUrl
      ? loadRemoteImagePart(brandAssets.featureMockupUrl)
      : brandAssets.featureMockupPath
        ? loadLocalImagePart(brandAssets.featureMockupPath)
        : Promise.resolve(null),
  ]);

  return { logoPart, featureMockupPart };
}

async function normalizeImageForPlatform(
  imageBuffer: Buffer,
  platform: string = "unknown",
  options?: { forceCarouselAspect?: boolean }
): Promise<Buffer> {
  const imageSpec = getSlideImageSpec(platform, { forceCarouselAspect: options?.forceCarouselAspect });
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

function isCharacterAssetPrompt(prompt: string, description: string): boolean {
  const combined = `${prompt} ${description}`.toLowerCase();
  return /(woman|female|girl|lady|muslimah|hijab|character|person|portrait|face|model|influencer)/i.test(
    combined
  );
}

function shouldAttachBrandVisualRefs(prompt: string): boolean {
  return /(app ui|ui mockup|app mockup|phone mockup|screen mockup|dashboard|interface|logo placement|logo lockup|product shot of app)/i.test(
    prompt.toLowerCase()
  );
}

function buildCharacterLockDescriptor(seedPrompt: string): string {
  return `Same fictional woman identity across all slides: ${seedPrompt}`;
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
    characterReferenceImageUrls = [],
    characterLockDescriptor,
    visualVariant = "brand_optimized",
    forceCarouselAspect = false,
    imageModel = DEFAULT_IMAGE_GENERATION_MODEL,
  } = options;

  const supportsInlineImageContext = !isImagenPredictModel(imageModel);
  const imageSpec = getSlideImageSpec(platform || "unknown", { forceCarouselAspect });
  const attachBrandVisualRefs =
    visualVariant === "brand_optimized" && shouldAttachBrandVisualRefs(assetPromptText);
  const { logoPart, featureMockupPart } = supportsInlineImageContext
    ? await getBrandImageParts(brandAssets)
    : { logoPart: null, featureMockupPart: null };
  const exactUiReferencePart =
    supportsInlineImageContext && uiGenerationMode === "reference_exact" && referenceImageUrls.length > 0
      ? await loadRemoteImagePart(referenceImageUrls[0])
      : null;
  const characterReferencePart =
    supportsInlineImageContext && characterReferenceImageUrls.length > 0
      ? await loadRemoteImagePart(characterReferenceImageUrls[0])
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
- ${
      visualVariant === "ugc_real"
        ? "Keep branding subtle and secondary. Never transform people into mascots/cartoons."
        : "You may use stronger brand expression, mascot-like style, and branded gradient accents when it improves output."
    }
- If generating a mockup or UI screenshot asset, style it based on brand context.
`
    : "";

  const referenceModeRule =
    uiGenerationMode === "reference_exact"
      ? supportsInlineImageContext
        ? "- Match the attached reference image's visual mood and color palette closely."
        : "- Match the source post's visual mood and color palette based on the prompt instructions."
      : "- Keep quality high but allow fresh visual exploration.";

  const characterLockRules = characterLockDescriptor
    ? `
CHARACTER CONTINUITY RULES:
- ${characterLockDescriptor}
- Preserve face identity, age range, skin tone, expression style, and hijab/wardrobe style consistently.
- Do not switch to a different person.
`
    : "";

  const peopleCopyRule = characterLockDescriptor
    ? "- Keep the same character identity anchored by the provided character reference image."
    : "- Do NOT copy source people, products, logos, or scene details.";

  const realismRules = visualVariant === "ugc_real"
    ? `
REALISM RULES:
- Generate a photorealistic lifestyle photograph.
- No cartoon, no 3D render, no illustration, no CGI, no mascot style.
- Natural textures, natural skin rendering, realistic lighting.
- Use a real environment background (bedroom/home/kitchen/table etc. as implied by prompt), not plain white studio backdrop.
`
    : "";

  const variantRules =
    visualVariant === "ugc_real"
      ? `
VISUAL VARIANT: UGC_REAL
- Prioritize authentic user-generated photo style over branded polish.
- Keep color grading natural and understated.
`
      : `
VISUAL VARIANT: BRAND_OPTIMIZED
- You may use polished art direction and stronger brand styling.
- Stylized/3D/mascot aesthetics are allowed only when aligned with prompt intent.
`;

  const prompt = `Generate ONE clean visual design asset image. This will be used as a background or visual element inside a slide that a designer will assemble in Figma.

ASSET DESCRIPTION:
${assetPromptText}

${brandRules}

STYLE REFERENCE:
- ${referenceModeRule}
- ${peopleCopyRule}

${characterLockRules}
${realismRules}
${variantRules}

CRITICAL OUTPUT RULES:
- Do NOT render any text, headlines, typography, captions, or UI overlays into the image.
- Do NOT include any words, letters, or numbers in the generated image.
- The image must be a clean visual asset only (photo, illustration, texture, pattern, gradient, 3D render, etc.).
- Do not add third-party logos or watermarks.
- Do not include Gemini logo/text or any AI model branding.
- Target size: ${imageSpec.width}x${imageSpec.height} (${imageSpec.aspectRatio}).`;

  const promptParts: Array<{ text: string } | GeminiInlineImagePart> = [{ text: prompt }];
  if (characterReferencePart) promptParts.push(characterReferencePart);
  if (exactUiReferencePart) promptParts.push(exactUiReferencePart);
  if (attachBrandVisualRefs && logoPart) promptParts.push(logoPart);
  if (attachBrandVisualRefs && featureMockupPart) promptParts.push(featureMockupPart);

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

  const finalizedBuffer = await normalizeImageForPlatform(generatedBuffer, platform, { forceCarouselAspect });

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
    visualVariant = "brand_optimized",
    forceCarouselAspect = false,
    imageModel,
    onSlideComplete,
  } = options;

  const images: string[] = [];
  const allAssetPrompts = slidePlans.flatMap((plan) => plan.assetPrompts || []);
  const firstCharacterAsset =
    visualVariant === "ugc_real"
      ? allAssetPrompts.find((asset) => isCharacterAssetPrompt(asset.prompt, asset.description))
      : undefined;

  let characterReferenceImageUrl: string | null = null;
  let characterLockDescriptor: string | null = null;

  if (firstCharacterAsset) {
    const descriptorSeed = `${firstCharacterAsset.description}. ${firstCharacterAsset.prompt}`;
    characterLockDescriptor = buildCharacterLockDescriptor(descriptorSeed);

    const characterAnchorPrompt = `${firstCharacterAsset.prompt}

Create a single-character identity anchor image in a natural lifestyle setting (not plain white background). One woman only, high facial clarity, modest styling, no text/UI, realistic phone-camera look.`;

      characterReferenceImageUrl = await generateImage(characterAnchorPrompt, {
      collectionId,
      postId,
      index: 9999,
      platform,
      generationId,
      versionId: `${versionId || "default"}-character-lock`,
      brandAssets,
      uiGenerationMode: "ai_creative",
      referenceImageUrls,
      visualVariant,
      forceCarouselAspect,
      imageModel,
      characterLockDescriptor,
    });
  }

  for (let slideIndex = 0; slideIndex < slidePlans.length; slideIndex += 1) {
    const plan = slidePlans[slideIndex];
    const assetPrompts = plan.assetPrompts;

    if (assetPrompts.length === 0) {
      // No asset prompts for this slide — generate a default branded background
      const imageUrl = await generateImage(
        visualVariant === "ugc_real"
          ? "Photorealistic natural lifestyle background scene for a social slide, no text, no logos."
          : "Clean abstract background with soft pink-to-blush gradients, suitable as a design asset for a social slide.",
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
          visualVariant,
          forceCarouselAspect,
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
      const isCharacterAsset = isCharacterAssetPrompt(asset.prompt, asset.description);
      const continuityPrompt =
        isCharacterAsset && characterLockDescriptor
          ? `${asset.prompt}\n\nCharacter continuity lock: ${characterLockDescriptor}. Keep this exact same woman identity as the character reference image.`
          : asset.prompt;

      const imageUrl = await generateImage(continuityPrompt, {
        collectionId,
        postId,
        index: slideIndex * 10 + assetIndex, // unique index for file naming
        platform,
        generationId,
        versionId,
        brandAssets,
        uiGenerationMode,
        referenceImageUrls,
        visualVariant,
        forceCarouselAspect,
        characterReferenceImageUrls:
          isCharacterAsset && characterReferenceImageUrl ? [characterReferenceImageUrl] : [],
        characterLockDescriptor: isCharacterAsset ? characterLockDescriptor || undefined : undefined,
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
