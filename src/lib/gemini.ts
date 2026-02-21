import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSlideImageSpec } from "@/lib/utils";
import { DEFAULT_REASONING_MODEL, type ReasoningModel } from "@/lib/reasoning-model";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

export interface NicheRelevanceResult {
  isIslamic: boolean;
  isPregnancyOrPeriodRelated: boolean;
  canIncorporateAppContext: boolean;
  canReframeToIslamicAppContext: boolean;
  canRecreate: boolean;
  isAppNicheRelevant: boolean;
  confidence: number;
  reason: string;
}

export type AdaptationMode = "app_context" | "variant_only";
export type UIGenerationMode = "reference_exact" | "ai_creative";

export interface SlideGenerationPlan {
  headline: string;
  supportingText: string;
  figmaInstructions: string[];
  assetPrompts: { prompt: string; description: string }[];
}

export function detectAdaptationModeFromScript(script: string): AdaptationMode {
  return /Adaptation Mode\s*:\s*app_context/i.test(script) ? "app_context" : "variant_only";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function buildReferenceImageParts(
  referenceImageUrls: string[]
): Promise<Array<{ inlineData: { data: string; mimeType: string } }>> {
  if (referenceImageUrls.length === 0) return [];

  const imageParts = await Promise.allSettled(
    referenceImageUrls.slice(0, 8).map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch reference image: ${url}`);
      }

      const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      const buffer = Buffer.from(await response.arrayBuffer());

      return {
        inlineData: {
          data: buffer.toString("base64"),
          mimeType,
        },
      };
    })
  );

  return imageParts
    .filter((part): part is PromiseFulfilledResult<{ inlineData: { data: string; mimeType: string } }> =>
      part.status === "fulfilled"
    )
    .map((part) => part.value);
}

function parseJsonFromModel(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
}

export async function detectNicheRelevance(
  originalPost: {
    title: string | null;
    description: string | null;
    platform: string;
  },
  appContext: string,
  appName: string,
  referenceImageUrls: string[] = [],
  reasoningModel: ReasoningModel = DEFAULT_REASONING_MODEL
): Promise<NicheRelevanceResult> {
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const prompt = `You are a strict social-post classifier for a two-step niche gate.

TARGET APP:
- App Name: ${appName}
- App Context: ${appContext}

ORIGINAL POST:
- Platform: ${originalPost.platform}
- Title: ${originalPost.title || "N/A"}
- Description: ${originalPost.description || "N/A"}

TASK:
- Step 1: Decide if the post is Islamic content.
- Step 2: Decide if the post is pregnancy/period related.
- If Step 1 is true and Step 2 is false, decide if app context can be naturally incorporated while preserving the original post's style.
- If Step 1 is false and Step 2 is true, decide if the post can be reframed into an Islamic-context + app-context version without losing coherence.
- Return strict JSON only:
{
  "isIslamic": true|false,
  "isPregnancyOrPeriodRelated": true|false,
  "canIncorporateAppContext": true|false,
  "canReframeToIslamicAppContext": true|false,
  "confidence": 0.0-1.0,
  "reason": "short reason"
}`;

  let result;
  if (referenceImageUrls.length > 0) {
    const imageParts = await buildReferenceImageParts(referenceImageUrls);
    result =
      imageParts.length > 0
        ? await model.generateContent([{ text: prompt }, ...imageParts])
        : await model.generateContent(prompt);
  } else {
    result = await model.generateContent(prompt);
  }

  const parsed = parseJsonFromModel(result.response.text()) as Record<string, unknown> | null;
  const legacyRelevant = Boolean(parsed?.isAppNicheRelevant);
  const isIslamic = typeof parsed?.isIslamic === "boolean" ? parsed.isIslamic : legacyRelevant;
  const isPregnancyOrPeriodRelated =
    typeof parsed?.isPregnancyOrPeriodRelated === "boolean"
      ? parsed.isPregnancyOrPeriodRelated
      : false;
  const canIncorporateAppContext = isIslamic && !isPregnancyOrPeriodRelated
    ? Boolean(parsed?.canIncorporateAppContext)
    : false;
  const canReframeToIslamicAppContext = !isIslamic && isPregnancyOrPeriodRelated
    ? Boolean(parsed?.canReframeToIslamicAppContext)
    : false;
  const canRecreate = isIslamic || canReframeToIslamicAppContext;
  const isAppNicheRelevant =
    (isIslamic && (isPregnancyOrPeriodRelated || canIncorporateAppContext)) ||
    canReframeToIslamicAppContext;
  const confidenceRaw = typeof parsed?.confidence === "number" ? parsed.confidence : 0.5;
  const reason = typeof parsed?.reason === "string" ? parsed.reason : "No reason provided";

  return {
    isIslamic,
    isPregnancyOrPeriodRelated,
    canIncorporateAppContext,
    canReframeToIslamicAppContext,
    canRecreate,
    isAppNicheRelevant,
    confidence: clamp(confidenceRaw, 0, 1),
    reason,
  };
}

export async function generatePostScript(
  originalPost: {
    title: string | null;
    description: string | null;
    platform: string;
    postType: string;
  },
  appContext: string,
  appName: string,
  referenceImageUrls: string[] = [],
  nicheRelevance?: NicheRelevanceResult,
  forcedAdaptationMode?: AdaptationMode,
  reasoningModel: ReasoningModel = DEFAULT_REASONING_MODEL
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const relevanceBlock = nicheRelevance
    ? `
NICHE CLASSIFICATION (already decided):
- isIslamic: ${nicheRelevance.isIslamic}
- isPregnancyOrPeriodRelated: ${nicheRelevance.isPregnancyOrPeriodRelated}
- canIncorporateAppContext: ${nicheRelevance.canIncorporateAppContext}
- canReframeToIslamicAppContext: ${nicheRelevance.canReframeToIslamicAppContext}
- canRecreate: ${nicheRelevance.canRecreate}
- isAppNicheRelevant: ${nicheRelevance.isAppNicheRelevant}
- confidence: ${nicheRelevance.confidence}
- reason: ${nicheRelevance.reason}
`
    : "";

  const forcedModeBlock = forcedAdaptationMode
    ? `
FORCED OUTPUT MODE:
- You MUST use Adaptation Mode: ${forcedAdaptationMode}
- Do not choose the other mode in this response.
`
    : "";

  const prompt = `You are a social content strategist.

ORIGINAL POST DETAILS:
- Platform: ${originalPost.platform}
- Type: ${originalPost.postType === "image_slides" ? "Image Carousel/Slides" : "Short-form Video"}
- Title: ${originalPost.title || "N/A"}
- Description: ${originalPost.description || "N/A"}

APP:
- App Name: ${appName}
- App Context: ${appContext}
${relevanceBlock}
${forcedModeBlock}

CRITICAL ADAPTATION RULE:
1) If canRecreate is false, do not force app context.
2) If isIslamic=true and isPregnancyOrPeriodRelated=true, app context adaptation is preferred.
3) If isIslamic=true and isPregnancyOrPeriodRelated=false, keep a faithful variant unless app context integration is explicitly requested.
4) If isIslamic=false and isPregnancyOrPeriodRelated=true, only use app-context adaptation when canReframeToIslamicAppContext=true.
5) If FORCED OUTPUT MODE is provided, follow it exactly.

OUTPUT:
- Start with: Adaptation Mode: app_context OR variant_only
- Then provide a slide-by-slide script (5-8 slides) with:
  Slide X
  Headline: ...
  Supporting: ...
  Visual: ...

Keep copy natural, specific, and non-generic.`;

  let result;
  if (referenceImageUrls.length > 0) {
    const imageParts = await buildReferenceImageParts(referenceImageUrls);
    if (imageParts.length === 0) {
      throw new Error("Failed to load selected reference images for script generation.");
    }
    result = await model.generateContent([{ text: prompt }, ...imageParts]);
  } else {
    result = await model.generateContent(prompt);
  }

  return result.response.text();
}

/* ---------- Step 1: Extract slide texts from original images ---------- */

export interface ExtractedSlideText {
  slideIndex: number;
  headline: string;
  supportingText: string;
}

export async function extractSlideTexts(
  imageUrls: string[],
  reasoningModel: ReasoningModel = DEFAULT_REASONING_MODEL
): Promise<ExtractedSlideText[]> {
  if (imageUrls.length === 0) return [];

  const model = genAI.getGenerativeModel({ model: reasoningModel });
  const imageParts = await buildReferenceImageParts(imageUrls);
  if (imageParts.length === 0) {
    throw new Error("Failed to load slide images for text extraction.");
  }

  const prompt = `You are looking at ${imageParts.length} social media carousel slide images.

For EACH slide image, extract the text that appears on it. Identify the main headline and any supporting/body text separately.

Return JSON array with one object per slide, in order:
[
  { "slideIndex": 0, "headline": "...", "supportingText": "..." },
  { "slideIndex": 1, "headline": "...", "supportingText": "..." }
]

Rules:
- Extract the EXACT text as it appears on each slide.
- If a slide has no headline, set headline to "".
- If a slide has no supporting text, set supportingText to "".
- Do not add or modify any text — transcribe exactly.
- JSON only, no markdown.`;

  const result = await model.generateContent([{ text: prompt }, ...imageParts]);
  const parsed = parseJsonFromModel(result.response.text());

  if (!Array.isArray(parsed)) {
    return imageUrls.map((_, i) => ({ slideIndex: i, headline: "", supportingText: "" }));
  }

  return parsed.map((item, i) => {
    const row = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    return {
      slideIndex: i,
      headline: typeof row.headline === "string" ? row.headline.trim() : "",
      supportingText: typeof row.supportingText === "string" ? row.supportingText.trim() : "",
    };
  });
}

/* ---------- Step 3: Per-slide Figma instructions + asset prompts ---------- */

export async function generateSlideDesignPlans(
  originalImageUrls: string[],
  script: string,
  platform: string,
  brandPrimaryColor: string,
  brandGradient: string[],
  appName: string,
  reasoningModel: ReasoningModel = DEFAULT_REASONING_MODEL
): Promise<SlideGenerationPlan[]> {
  const model = genAI.getGenerativeModel({ model: reasoningModel });
  const imageSpec = getSlideImageSpec(platform);
  const gradientStr = brandGradient.join(" → ");

  const imageParts = await buildReferenceImageParts(originalImageUrls);

  const prompt = `You are an expert art director and Figma designer. I am showing you ${imageParts.length} original carousel slide images and a rewritten script for our brand.

YOUR TASK: For EACH slide, produce:
1. **figmaInstructions** — step-by-step instructions to recreate this slide's EXACT visual layout and style in Figma, but using OUR brand identity. Be extremely specific:
   - Mention exact positions (e.g. "48px from top-left"), sizes (e.g. "width: 600px"), spacings
   - Reference our brand gradient: ${gradientStr} — use these for backgrounds, panels, accent shapes, overlays
   - Include brand logo placement (position, size)
   - Specify font names, weights, sizes, colors for each text layer
   - Describe any shapes, dividers, icons, overlays, and their exact styling
   - The goal is that a designer can follow these steps to build the slide in Figma without guessing

2. **assetPrompts** — an array of image asset descriptions that need to be AI-generated for this slide. Each asset is something the Figma design will use (e.g. a background photo, an illustration, an icon, a texture, a product mockup). For each, provide:
   - "prompt": a detailed image generation prompt (NO text/typography in the image)
   - "description": a short label (e.g. "Background gradient photo", "Hero illustration")

3. **headline** — the new headline from the script for this slide
4. **supportingText** — the new supporting text from the script for this slide

REWRITTEN SCRIPT (all slides):
${script}

BRAND IDENTITY:
- App Name: ${appName}
- Primary Color: ${brandPrimaryColor}
- Brand Gradient: ${gradientStr}
- Target size: ${imageSpec.width}×${imageSpec.height} (${imageSpec.aspectRatio})

RULES:
- Look at each original slide image carefully to understand its layout, composition, typography placement, visual hierarchy, and style.
- Your figmaInstructions should recreate that SAME style/layout but adapted with our brand colors (${gradientStr}), our copy from the script, and our logo.
- assetPrompts must NEVER include text/typography in the generated images. Assets are purely visual elements.
- Match the number of slides in the script to the provided images. If the script has more slides than images, use the last image's style for extra slides.

Return JSON array with one object per slide:
[
  {
    "headline": "New headline from script",
    "supportingText": "New supporting text from script",
    "figmaInstructions": [
      "Step 1: Create a ${imageSpec.width}×${imageSpec.height} frame...",
      "Step 2: ...",
      "..."
    ],
    "assetPrompts": [
      { "prompt": "Detailed image generation prompt for asset...", "description": "Background photo" },
      { "prompt": "...", "description": "Decorative element" }
    ]
  }
]

JSON only. No markdown.`;

  const content = imageParts.length > 0
    ? [{ text: prompt }, ...imageParts]
    : [{ text: prompt }];

  const result = await model.generateContent(content);
  return parseSlideDesignPlans(result.response.text(), originalImageUrls.length);
}

function parseSlideDesignPlans(text: string, slideCount: number): SlideGenerationPlan[] {
  const parsed = parseJsonFromModel(text);

  const fallback: SlideGenerationPlan[] = Array.from({ length: slideCount }, (_, i) => ({
    headline: `Slide ${i + 1}`,
    supportingText: "",
    figmaInstructions: [
      "Create a 1080×1080 frame in Figma.",
      "Place the generated asset as the background layer.",
      "Add headline text using your brand font.",
    ],
    assetPrompts: [
      { prompt: "Clean abstract background with soft pink-to-blush gradients.", description: "Background" },
    ],
  }));

  if (!Array.isArray(parsed)) return fallback;

  const plans = parsed
    .map((item): SlideGenerationPlan | null => {
      if (typeof item !== "object" || item === null) return null;
      const row = item as Record<string, unknown>;

      const headline = typeof row.headline === "string" ? row.headline.trim() : "";
      const supportingText = typeof row.supportingText === "string" ? row.supportingText.trim() : "";

      const figmaInstructions = Array.isArray(row.figmaInstructions)
        ? row.figmaInstructions.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        : [];

      const assetPrompts = Array.isArray(row.assetPrompts)
        ? row.assetPrompts
          .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
          .map((a) => ({
            prompt: typeof a.prompt === "string" ? a.prompt : "",
            description: typeof a.description === "string" ? a.description : "Asset",
          }))
          .filter((a) => a.prompt.length > 0)
        : [];

      if (!headline && figmaInstructions.length === 0) return null;

      return { headline, supportingText, figmaInstructions, assetPrompts };
    })
    .filter((plan): plan is SlideGenerationPlan => Boolean(plan));

  if (plans.length === 0) return fallback;
  if (plans.length >= slideCount) return plans.slice(0, slideCount);
  return [...plans, ...fallback.slice(0, slideCount - plans.length)];
}

/* ---------- Caption generation ---------- */

function cleanCaption(text: string): string {
  let output = text.trim();
  if (!output) return output;

  if (output.startsWith("```") && output.endsWith("```")) {
    output = output.replace(/^```\w*\s*/i, "").replace(/```$/, "").trim();
  }

  if (
    (output.startsWith("\"") && output.endsWith("\"")) ||
    (output.startsWith("'") && output.endsWith("'"))
  ) {
    output = output.slice(1, -1).trim();
  }

  return output;
}

export async function generatePostCaption({
  script,
  appName,
  appContext,
  platform,
  slideSummaries = [],
  originalTitle,
  originalDescription,
  reasoningModel = DEFAULT_REASONING_MODEL,
}: {
  script: string;
  appName: string;
  appContext: string;
  platform: string;
  slideSummaries?: string[];
  originalTitle?: string | null;
  originalDescription?: string | null;
  reasoningModel?: ReasoningModel;
}): Promise<string> {
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const slidesBlock = slideSummaries.length > 0 ? `SLIDES:\n- ${slideSummaries.join("\n- ")}` : "";
  const originalBlock = originalTitle || originalDescription
    ? `ORIGINAL POST:\n- Title: ${originalTitle || "N/A"}\n- Description: ${originalDescription || "N/A"}`
    : "";

  const prompt = `You are a social media copywriter.

APP:
- App Name: ${appName}
- App Context: ${appContext || "N/A"}

PLATFORM: ${platform}

${originalBlock}

SCRIPT:
${script}

${slidesBlock}

TASK:
- Write a caption for a carousel post based on the script.
- Keep it concise and specific to the content.
- 2-4 sentences total.
- If the script implies app context, mention ${appName} once and include a soft call-to-action.
- End with 3-6 relevant hashtags on a new line.
- Output plain text only. No quotes. No markdown.`;

  const result = await model.generateContent(prompt);
  return cleanCaption(result.response.text());
}
