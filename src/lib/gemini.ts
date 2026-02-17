import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSlideImageSpec } from "@/lib/utils";

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

export interface SlideGenerationPlan {
  imagePrompt: string;
  headline: string;
  supportingText: string;
  textPlacement: "top" | "center" | "bottom";
  uiInstructions: {
    layoutConcept: string;
    artDirection: string;
    typography: {
      headlineFontFamily: string;
      headlineFontWeight: string;
      supportingFontFamily: string;
      supportingFontWeight: string;
      alignment: "left" | "center" | "right";
    };
    composition: {
      textArea: string;
      safeMargins: string;
      elementNotes: string[];
    };
    styling: {
      panelStyle: string;
      accentStyle: string;
      iconStyle: string;
    };
  };
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
  referenceImageUrls: string[] = []
): Promise<NicheRelevanceResult> {
  const model = genAI.getGenerativeModel({ model: "gemini-3-pro-preview" });

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
  forcedAdaptationMode?: AdaptationMode
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-3-pro-preview" });

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

function parseSlidePlans(text: string, slideCount: number): SlideGenerationPlan[] {
  const parsed = parseJsonFromModel(text);

  const fallback = Array.from({ length: slideCount }, (_, index) => ({
    imagePrompt: "Editorial social carousel scene with strong hierarchy and premium composition.",
    headline: `Slide ${index + 1}`,
    supportingText: "",
    textPlacement: "top" as const,
    uiInstructions: {
      layoutConcept: "Dynamic editorial card",
      artDirection: "Premium and modern",
      typography: {
        headlineFontFamily: "Space Grotesk",
        headlineFontWeight: "700",
        supportingFontFamily: "Inter",
        supportingFontWeight: "500",
        alignment: "left" as const,
      },
      composition: {
        textArea: "Upper third",
        safeMargins: "8% all sides",
        elementNotes: ["Keep clear hierarchy"],
      },
      styling: {
        panelStyle: "Subtle translucent panel",
        accentStyle: "Soft contrast accent",
        iconStyle: "Minimal icons",
      },
    },
  }));

  if (!Array.isArray(parsed)) return fallback;

  const plans = parsed
    .map((item): SlideGenerationPlan | null => {
      if (typeof item !== "object" || item === null) return null;
      const row = item as Record<string, unknown>;
      const imagePrompt = typeof row.imagePrompt === "string" ? row.imagePrompt.trim() : "";
      const headline = typeof row.headline === "string" ? row.headline.trim() : "";
      const supportingText = typeof row.supportingText === "string" ? row.supportingText.trim() : "";
      const textPlacement =
        typeof row.textPlacement === "string" && ["top", "center", "bottom"].includes(row.textPlacement)
          ? (row.textPlacement as "top" | "center" | "bottom")
          : "top";

      const uiRaw =
        typeof row.uiInstructions === "object" && row.uiInstructions !== null
          ? (row.uiInstructions as Record<string, unknown>)
          : {};
      const typoRaw =
        typeof uiRaw.typography === "object" && uiRaw.typography !== null
          ? (uiRaw.typography as Record<string, unknown>)
          : {};
      const compositionRaw =
        typeof uiRaw.composition === "object" && uiRaw.composition !== null
          ? (uiRaw.composition as Record<string, unknown>)
          : {};
      const stylingRaw =
        typeof uiRaw.styling === "object" && uiRaw.styling !== null
          ? (uiRaw.styling as Record<string, unknown>)
          : {};

      if (!imagePrompt || !headline) return null;

      const uiInstructions: SlideGenerationPlan["uiInstructions"] = {
        layoutConcept:
          typeof uiRaw.layoutConcept === "string" ? uiRaw.layoutConcept : "Editorial text composition",
        artDirection: typeof uiRaw.artDirection === "string" ? uiRaw.artDirection : "Clean and premium",
        typography: {
          headlineFontFamily:
            typeof typoRaw.headlineFontFamily === "string" ? typoRaw.headlineFontFamily : "Space Grotesk",
          headlineFontWeight:
            typeof typoRaw.headlineFontWeight === "string" ? typoRaw.headlineFontWeight : "700",
          supportingFontFamily:
            typeof typoRaw.supportingFontFamily === "string" ? typoRaw.supportingFontFamily : "Inter",
          supportingFontWeight:
            typeof typoRaw.supportingFontWeight === "string" ? typoRaw.supportingFontWeight : "500",
          alignment:
            typeof typoRaw.alignment === "string" && ["left", "center", "right"].includes(typoRaw.alignment)
              ? (typoRaw.alignment as "left" | "center" | "right")
              : "left",
        },
        composition: {
          textArea: typeof compositionRaw.textArea === "string" ? compositionRaw.textArea : "Upper third",
          safeMargins:
            typeof compositionRaw.safeMargins === "string" ? compositionRaw.safeMargins : "8% all sides",
          elementNotes: Array.isArray(compositionRaw.elementNotes)
            ? compositionRaw.elementNotes.filter((note): note is string => typeof note === "string")
            : [],
        },
        styling: {
          panelStyle:
            typeof stylingRaw.panelStyle === "string" ? stylingRaw.panelStyle : "Subtle translucent panel",
          accentStyle:
            typeof stylingRaw.accentStyle === "string" ? stylingRaw.accentStyle : "Soft contrast accent",
          iconStyle: typeof stylingRaw.iconStyle === "string" ? stylingRaw.iconStyle : "Minimal icons",
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
    .filter((plan): plan is SlideGenerationPlan => Boolean(plan));

  if (plans.length === 0) return fallback;
  if (plans.length >= slideCount) return plans.slice(0, slideCount);
  return [...plans, ...fallback.slice(0, slideCount - plans.length)];
}

export async function generateImagePrompts(
  script: string,
  appName: string,
  slideCount: number,
  platform: string,
  referenceImageUrls: string[] = [],
  appContext?: string,
  nicheRelevance?: NicheRelevanceResult,
  forcedAdaptationMode?: AdaptationMode
): Promise<SlideGenerationPlan[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-3-pro-preview" });
  const imageSpec = getSlideImageSpec(platform);

  const relevanceBlock = nicheRelevance
    ? `
NICHE CLASSIFICATION:
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
- You MUST produce slides for adaptation mode: ${forcedAdaptationMode}
- Do not generate plans for the other mode.
`
    : "";

  const prompt = `Generate ${slideCount} slide-generation plans for ${appName}.

SCRIPT:
${script}

APP CONTEXT:
${appContext || "N/A"}
${relevanceBlock}
${forcedModeBlock}

RULES:
- If canRecreate=false, do not force app context.
- If isIslamic=true and isPregnancyOrPeriodRelated=true, plans should align copy + visuals to app context.
- If isIslamic=true and isPregnancyOrPeriodRelated=false, keep same topic/vibe/structure unless app-context mode is explicitly required.
- If isIslamic=false and isPregnancyOrPeriodRelated=true, only align to app context when canReframeToIslamicAppContext=true.
- If FORCED OUTPUT MODE is provided, follow it exactly.
- Use the original references for structure and pacing, not exact duplication.
- Ensure strong variation across slides (layout, hierarchy, visual rhythm, typography).
- Target ${platform} with ${imageSpec.width}x${imageSpec.height} (${imageSpec.aspectRatio}).

Return JSON array with exactly ${slideCount} items:
[
  {
    "imagePrompt": "Full final slide render instructions with background + typography + UI",
    "headline": "string",
    "supportingText": "string",
    "textPlacement": "top|center|bottom",
    "uiInstructions": {
      "layoutConcept": "string",
      "artDirection": "string",
      "typography": {
        "headlineFontFamily": "string",
        "headlineFontWeight": "string",
        "supportingFontFamily": "string",
        "supportingFontWeight": "string",
        "alignment": "left|center|right"
      },
      "composition": {
        "textArea": "string",
        "safeMargins": "string",
        "elementNotes": ["string"]
      },
      "styling": {
        "panelStyle": "string",
        "accentStyle": "string",
        "iconStyle": "string"
      }
    }
  }
]

No markdown. JSON only.`;

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

  return parseSlidePlans(result.response.text(), slideCount);
}
