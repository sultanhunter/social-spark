import sharp from "sharp";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { uploadToR2 } from "@/lib/r2";
import {
  type ImageGenerationModel,
  DEFAULT_IMAGE_GENERATION_MODEL,
} from "@/lib/image-generation-model";
import {
  type ReasoningModel,
  DEFAULT_REASONING_MODEL,
} from "@/lib/reasoning-model";

export const DEFAULT_PINTEREST_IMAGE_MODEL: ImageGenerationModel = "gemini-3.1-flash-image-preview";

const PINTEREST_CANVAS = { width: 1000, height: 1500 };
const BRAND_COLOR_PRIMARY = "#F36F97";
const BRAND_COLOR_SECONDARY = "#EEB4C3";
const BRAND_COLOR_TERTIARY = "#F7DFD6";
const BRAND_COLOR_INK = "#1E2433";
const BRAND_COLOR_PAPER = "#FFFDFB";
const REFERENCE_VISUAL_VIBE =
  "Dreamy feminine editorial look: soft sakura-like floral framing near the top, airy blush background, gentle illustrated Muslimah character in lower area, delicate particles, high polish.";
const REFERENCE_RENDER_QUALITY_VIBE =
  "High-finish illustration quality similar to premium Pinterest Islamic art: serene environment depth, soft cinematic lighting, clean cel-shaded forms, elegant architecture details, polished edges, intentional composition.";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

type GenerateContentResult = Awaited<
  ReturnType<ReturnType<typeof genAI.getGenerativeModel>["generateContent"]>
>;

interface PartWithInlineData {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
}

export interface PinterestPinSection {
  heading: string;
  points: string[];
  visualHint: string;
}

export interface PinterestPinScript {
  targetAudience: string;
  objective: string;
  headline: string;
  supportingLine: string;
  valueProps: string[];
  sections: PinterestPinSection[];
  cta: string;
  footerNote: string;
}

export interface PinterestPinPack {
  topic: string;
  angleRationale: string;
  styleTheme: string;
  styleDirection: string;
  script: PinterestPinScript;
  imagePrompt: string;
  altText: string;
  imageUrl?: string;
}

function parseJsonFromModel<T>(text: string): T | null {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;

    try {
      return JSON.parse(objectMatch[0]) as T;
    } catch {
      return null;
    }
  }
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sanitizeEnglishText(value: unknown, fallback: string): string {
  const raw = asNonEmptyString(value) || fallback;
  const clean = raw
    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean || fallback;
}

function sanitizeStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") continue;
    const clean = item
      .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g, "")
      .replace(/[^\x20-\x7E]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
    if (output.length >= max) break;
  }

  return output;
}

function truncateWords(text: string, maxWords: number): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length <= maxWords) return tokens.join(" ");
  return tokens.slice(0, maxWords).join(" ");
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);

  return slug || `pin-${Date.now()}`;
}

function sanitizeSections(value: unknown): PinterestPinSection[] {
  if (!Array.isArray(value)) return [];

  const sections: PinterestPinSection[] = [];

  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;

    const heading = truncateWords(
      sanitizeEnglishText(row.heading, "Key Point"),
      7
    );
    const points = sanitizeStringArray(row.points, 3)
      .map((line) => truncateWords(line, 14))
      .slice(0, 3);

    sections.push({
      heading,
      points: points.length > 0 ? points : ["Add one practical tip."],
      visualHint: truncateWords(
        sanitizeEnglishText(row.visualHint, "Simple icon + clean spacing"),
        12
      ),
    });

    if (sections.length >= 5) break;
  }

  return sections;
}

function fallbackPinPack(topic = "Faith-aligned wellness routine for busy Muslim women"): PinterestPinPack {
  return {
    topic,
    angleRationale:
      "This topic gives practical, save-worthy guidance in a format that performs well as Pinterest infographics.",
    styleTheme: "Modern editorial infographic",
    styleDirection:
      "Premium dreamy editorial infographic using brand palette, layered depth, floral motifs, and polished typography.",
    script: {
      targetAudience: "Muslim women balancing worship, energy, and daily responsibilities",
      objective: "Deliver a quick action checklist readers can save and apply today",
      headline: "5 Habits That Lower Daily Overwhelm",
      supportingLine: "A faith-aligned routine you can follow in under 20 minutes",
      valueProps: [
        "Simple steps with realistic timing",
        "Built for low-energy days",
        "Easy to save and revisit",
      ],
      sections: [
        {
          heading: "Morning Anchor",
          points: [
            "Start with 2 minutes of dua",
            "Write one priority only",
            "Hydrate before checking messages",
          ],
          visualHint: "Sun icon + checklist",
        },
        {
          heading: "Midday Reset",
          points: [
            "Take a 5-minute movement break",
            "Make one istighfar pause",
            "Simplify your next task",
          ],
          visualHint: "Clock icon + divider",
        },
        {
          heading: "Evening Close",
          points: [
            "Prepare tomorrow in 10 minutes",
            "Note one gratitude",
            "Sleep with clear intention",
          ],
          visualHint: "Moon icon + progress dots",
        },
      ],
      cta: "Save this pin and follow it tonight",
      footerNote: "Small consistent steps create calm routines",
    },
    imagePrompt: "",
    altText: "Pinterest infographic with practical wellness steps for Muslim women",
  };
}

function buildExactTextSpec(script: PinterestPinScript): string {
  const sectionLines = script.sections
    .map((section, sectionIndex) => {
      const points = section.points.map((point, pointIndex) => `  - ${sectionIndex + 1}.${pointIndex + 1} ${point}`);
      return [`- SECTION ${sectionIndex + 1} HEADER: ${section.heading}`, ...points].join("\n");
    })
    .join("\n");

  const valueProps = script.valueProps.map((line, index) => `- VALUE ${index + 1}: ${line}`).join("\n");

  return [
    `- HEADLINE: ${script.headline}`,
    `- SUPPORTING LINE: ${script.supportingLine}`,
    valueProps,
    sectionLines,
    `- CTA: ${script.cta}`,
    `- FOOTER NOTE: ${script.footerNote}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFallbackImagePrompt(pack: PinterestPinPack): string {
  return `Create a premium Pinterest infographic image for ${pack.topic}.

Canvas and composition:
- Vertical 2:3 layout at 1000x1500.
- Use a polished, agency-level visual style (behance/dribbble quality).
- Keep generous margins, crisp alignment, and strict visual hierarchy.
- Use a 12-column grid feel with balanced whitespace and modular cards.

Reference style vibe:
- ${REFERENCE_VISUAL_VIBE}
- ${REFERENCE_RENDER_QUALITY_VIBE}
- Keep this as inspiration only; still prioritize infographic readability and structure.

Brand color lock (MANDATORY):
- Primary accent: ${BRAND_COLOR_PRIMARY}
- Secondary accent: ${BRAND_COLOR_SECONDARY}
- Soft background tint: ${BRAND_COLOR_TERTIARY}
- Main text color: ${BRAND_COLOR_INK}
- Base background: ${BRAND_COLOR_PAPER}
- Do not switch to random palettes. Keep the final design clearly brand-aligned.

Color and typography:
- Typography: bold modern sans-serif headline, readable medium-weight body, clear line-height rhythm.
- Add subtle depth: soft gradients, very light grain texture, and clean shadows.
- Contrast must be high for readability.

Visual richness requirements (MANDATORY):
- Avoid flat/plain background. Use layered backdrop with gradient + texture.
- Add decorative top framing motifs (botanical blossoms, curved branches, or abstract floral ornaments).
- Include one tasteful hero subject in lower third (modest Muslimah illustration or editorial figure) that supports the topic.
- Use section cards/chips with rounded corners, soft shadows, and clear separation.
- Add tiny accent elements (sparkles, dots, petals, subtle dividers) for premium detail density.
- Text must be rendered as part of the same final artwork (integrated typography), not as detached overlay blocks.

EXACT TEXT TO RENDER (ENGLISH ONLY):
${buildExactTextSpec(pack.script)}

Layout guidance:
- Top zone: headline + supporting line.
- Mid zone: value props in short chips/cards.
- Main body: 3-5 section blocks, each with header and concise bullets.
- Bottom zone: CTA and footer note.
- Support visuals: minimal geometric icons and separators with consistent stroke style.
- Preserve a safe text zone with no visual clutter behind critical text.

Quality constraints:
- Spell all words correctly.
- No gibberish characters.
- No watermark, no logo, no UI chrome.
- Keep text fully readable and professionally typeset; no awkward wrapping.
- Respectful modest visual language for Muslim women audience.
- Final image must look like a finished, conversion-oriented Pinterest infographic from a senior designer.`;
}

async function polishSingleShotPrompt({
  draftPrompt,
  pack,
  reasoningModel,
}: {
  draftPrompt: string;
  pack: PinterestPinPack;
  reasoningModel?: ReasoningModel;
}): Promise<string> {
  const model = genAI.getGenerativeModel({ model: reasoningModel || DEFAULT_REASONING_MODEL });

  const prompt = `You are refining one final image prompt for a single-shot Pinterest generation.

Goal:
- Maximize professional visual quality in one generation.
- Keep all text integrated inside the generated artwork.
- Keep brand palette strict.

Brand colors (must be explicit in final prompt):
- ${BRAND_COLOR_PRIMARY}
- ${BRAND_COLOR_SECONDARY}
- ${BRAND_COLOR_TERTIARY}
- ${BRAND_COLOR_INK}
- ${BRAND_COLOR_PAPER}

Topic: ${pack.topic}
Style theme: ${pack.styleTheme}
Current style direction: ${pack.styleDirection}

Exact text blocks that must appear:
${buildExactTextSpec(pack.script)}

Draft prompt:
${draftPrompt}

Return JSON only:
{
  "imagePrompt": "single polished prompt, 260-480 words"
}

Hard constraints:
- Single cohesive artwork (no external editing steps, no separate text layer language).
- Integrated typography with clear hierarchy and text-safe areas.
- Cinematic but soft lighting, clean edges, refined depth.
- No flat/template look.
- No watermarks, no logos, no random symbols, no gibberish text.
- No markdown, no prose outside JSON.`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.35,
      },
    });

    const parsed = parseJsonFromModel<{ imagePrompt?: string }>(result.response.text()) || {};
    return sanitizeEnglishText(parsed.imagePrompt, draftPrompt);
  } catch {
    return draftPrompt;
  }
}

async function generateWithSearchFallback(
  modelId: string,
  payload: Parameters<ReturnType<typeof genAI.getGenerativeModel>["generateContent"]>[0]
): Promise<GenerateContentResult> {
  try {
    const modelWithGoogleSearch = genAI.getGenerativeModel({
      model: modelId,
      tools: ([{ googleSearch: {} }] as unknown) as Array<{ googleSearchRetrieval: Record<string, never> }>,
    });
    return await modelWithGoogleSearch.generateContent(payload);
  } catch {
    try {
      const modelWithLegacySearch = genAI.getGenerativeModel({
        model: modelId,
        tools: [{ googleSearchRetrieval: {} }],
      });
      return await modelWithLegacySearch.generateContent(payload);
    } catch {
      const modelWithoutSearchTool = genAI.getGenerativeModel({ model: modelId });
      return modelWithoutSearchTool.generateContent(payload);
    }
  }
}

async function decidePinterestScript({
  appName,
  appContext,
  focus,
  reasoningModel,
}: {
  appName: string;
  appContext: string;
  focus?: string;
  reasoningModel?: ReasoningModel;
}): Promise<PinterestPinPack> {
  const fallback = fallbackPinPack();

  const prompt = `You are an elite Pinterest strategist and infographic scriptwriter for ${appName}.

APP CONTEXT:
${appContext}

OPTIONAL FOCUS:
${focus?.trim() || "None"}

Task:
Decide a high-performing Pinterest infographic pin concept for this app.
The output MUST be script-first: decide exactly what the pin will say and how information is structured.

Return valid JSON only with this schema:
{
  "topic": "",
  "angleRationale": "2-3 sentences",
  "styleTheme": "",
  "script": {
    "targetAudience": "",
    "objective": "",
    "headline": "",
    "supportingLine": "",
    "valueProps": [""],
    "sections": [
      {
        "heading": "",
        "points": ["", "", ""],
        "visualHint": ""
      }
    ],
    "cta": "",
    "footerNote": ""
  }
}

Rules:
- English only.
- Pinterest infographic format, practical and save-worthy.
- Keep headline short and powerful.
- Create 3-5 sections with concise points.
- Style theme should feel art-directed and emotionally appealing, not generic.
- Prefer expressive themes like dreamy floral editorial, luxe feminine collage, or clean premium kawaii editorial.
- Also prefer premium serene illustration direction with cinematic depth when relevant.
- Keep claims responsible and aligned with app context.
- No markdown, no prose outside JSON.`;

  const result = await generateWithSearchFallback(
    reasoningModel || DEFAULT_REASONING_MODEL,
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
      },
    }
  );

  const parsed = parseJsonFromModel<Partial<PinterestPinPack> & { script?: Partial<PinterestPinScript> }>(
    result.response.text()
  ) || {};
  const script: Partial<PinterestPinScript> = parsed.script || {};
  const sections = sanitizeSections(script.sections);

  return {
    topic: sanitizeEnglishText(parsed.topic, fallback.topic),
    angleRationale: sanitizeEnglishText(parsed.angleRationale, fallback.angleRationale),
    styleTheme: sanitizeEnglishText(parsed.styleTheme, fallback.styleTheme),
    styleDirection: "",
    script: {
      targetAudience: sanitizeEnglishText(script.targetAudience, fallback.script.targetAudience),
      objective: sanitizeEnglishText(script.objective, fallback.script.objective),
      headline: truncateWords(sanitizeEnglishText(script.headline, fallback.script.headline), 12),
      supportingLine: truncateWords(sanitizeEnglishText(script.supportingLine, fallback.script.supportingLine), 20),
      valueProps: sanitizeStringArray(script.valueProps, 4).length > 0
        ? sanitizeStringArray(script.valueProps, 4).map((line) => truncateWords(line, 14))
        : fallback.script.valueProps,
      sections: sections.length >= 3 ? sections : fallback.script.sections,
      cta: truncateWords(sanitizeEnglishText(script.cta, fallback.script.cta), 12),
      footerNote: truncateWords(sanitizeEnglishText(script.footerNote, fallback.script.footerNote), 16),
    },
    imagePrompt: "",
    altText: fallback.altText,
  };
}

async function generateDetailedPinterestImagePrompt({
  pack,
  appName,
  reasoningModel,
}: {
  pack: PinterestPinPack;
  appName: string;
  reasoningModel?: ReasoningModel;
}): Promise<Pick<PinterestPinPack, "imagePrompt" | "styleDirection" | "altText">> {
  const fallbackPrompt = buildFallbackImagePrompt(pack);

  const model = genAI.getGenerativeModel({ model: reasoningModel || DEFAULT_REASONING_MODEL });

  const prompt = `You are a senior visual prompt engineer for Pinterest infographics.

APP: ${appName}
TOPIC: ${pack.topic}
STYLE THEME: ${pack.styleTheme}

SCRIPT JSON:
${JSON.stringify(pack.script, null, 2)}

Task:
Generate a detailed image prompt for an image model.
The prompt must preserve the script text structure and produce a polished infographic pin.

Brand palette to enforce:
- ${BRAND_COLOR_PRIMARY} (primary)
- ${BRAND_COLOR_SECONDARY} (secondary)
- ${BRAND_COLOR_TERTIARY} (soft background)
- ${BRAND_COLOR_INK} (text)
- ${BRAND_COLOR_PAPER} (base)

Return valid JSON only:
{
  "styleDirection": "short style direction",
  "imagePrompt": "detailed prompt, 220-420 words",
  "altText": "concise alt text"
}

Rules:
- English only.
- Must explicitly include exact text blocks to render from the script.
- Mention vertical Pinterest composition and layout zones.
- Must enforce brand colors using the provided HEX values.
- Mention color palette, typography style, spacing, icon treatment, and card hierarchy.
- Require a highly professional visual outcome: polished, balanced, and premium.
- Use the reference vibe: ${REFERENCE_VISUAL_VIBE}
- Use render quality vibe: ${REFERENCE_RENDER_QUALITY_VIBE}
- Prevent blandness: include layered depth, decorative motifs, focal subject, and intentional art direction.
- Ban generic output: do not describe plain white backgrounds or default template-like layouts.
- Keep final design elegant and feminine while preserving readability.
- Must keep typography integrated in the generated artwork itself.
- Do not suggest separate text overlays or external post-processing steps.
- No logos, no watermark, no UI chrome.
- Keep it concrete and image-model-friendly.
- No markdown, no prose outside JSON.`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.45,
      },
    });

    const parsed = parseJsonFromModel<{
      styleDirection?: string;
      imagePrompt?: string;
      altText?: string;
    }>(result.response.text()) || {};

    const draftImagePrompt = sanitizeEnglishText(parsed.imagePrompt, fallbackPrompt);
    const polishedImagePrompt = await polishSingleShotPrompt({
      draftPrompt: draftImagePrompt,
      pack,
      reasoningModel,
    });

    return {
      styleDirection: sanitizeEnglishText(
        parsed.styleDirection,
        "Premium brand-aligned dreamy editorial infographic with layered depth, decorative motifs, and high readability"
      ),
      imagePrompt: polishedImagePrompt,
      altText: sanitizeEnglishText(
        parsed.altText,
        `Pinterest infographic about ${pack.topic}`
      ),
    };
  } catch {
    return {
      styleDirection:
        "Premium brand-aligned dreamy editorial infographic with layered depth, decorative motifs, and high readability",
      imagePrompt: fallbackPrompt,
      altText: `Pinterest infographic about ${pack.topic}`,
    };
  }
}

export function normalizePinterestPinPack(value: unknown): PinterestPinPack | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const scriptRow =
    typeof row.script === "object" && row.script !== null
      ? (row.script as Record<string, unknown>)
      : null;

  if (!scriptRow) {
    const topic = asNonEmptyString(row.topic) || "Faith-aligned wellness routine";
    return fallbackPinPack(topic);
  }

  const topic = sanitizeEnglishText(row.topic, "Faith-aligned wellness routine");
  const fallback = fallbackPinPack(topic);
  const sections = sanitizeSections(scriptRow.sections);

  return {
    topic,
    angleRationale: sanitizeEnglishText(row.angleRationale, fallback.angleRationale),
    styleTheme: sanitizeEnglishText(row.styleTheme, fallback.styleTheme),
    styleDirection: sanitizeEnglishText(row.styleDirection, fallback.styleDirection),
    script: {
      targetAudience: sanitizeEnglishText(scriptRow.targetAudience, fallback.script.targetAudience),
      objective: sanitizeEnglishText(scriptRow.objective, fallback.script.objective),
      headline: truncateWords(sanitizeEnglishText(scriptRow.headline, fallback.script.headline), 12),
      supportingLine: truncateWords(sanitizeEnglishText(scriptRow.supportingLine, fallback.script.supportingLine), 20),
      valueProps: sanitizeStringArray(scriptRow.valueProps, 4).length > 0
        ? sanitizeStringArray(scriptRow.valueProps, 4)
        : fallback.script.valueProps,
      sections: sections.length > 0 ? sections : fallback.script.sections,
      cta: truncateWords(sanitizeEnglishText(scriptRow.cta, fallback.script.cta), 12),
      footerNote: truncateWords(sanitizeEnglishText(scriptRow.footerNote, fallback.script.footerNote), 16),
    },
    imagePrompt: sanitizeEnglishText(row.imagePrompt, buildFallbackImagePrompt(fallback)),
    altText: sanitizeEnglishText(row.altText, fallback.altText),
    imageUrl: asNonEmptyString(row.imageUrl) || undefined,
  };
}

export async function generatePinterestPinPack({
  appName,
  appContext,
  focus,
  reasoningModel,
}: {
  appName: string;
  appContext: string;
  focus?: string;
  reasoningModel?: ReasoningModel;
}): Promise<PinterestPinPack> {
  const scriptFirstPack = await decidePinterestScript({
    appName,
    appContext,
    focus,
    reasoningModel,
  });

  const promptData = await generateDetailedPinterestImagePrompt({
    pack: scriptFirstPack,
    appName,
    reasoningModel,
  });

  return {
    ...scriptFirstPack,
    ...promptData,
  };
}

export async function generatePinterestPinImage({
  pack,
  collectionId,
  generationId,
  imageModel,
}: {
  pack: PinterestPinPack;
  collectionId: string;
  generationId: string;
  imageModel?: ImageGenerationModel;
}): Promise<string> {
  const resolvedImageModel = imageModel || DEFAULT_PINTEREST_IMAGE_MODEL || DEFAULT_IMAGE_GENERATION_MODEL;

  if (!resolvedImageModel.startsWith("gemini-")) {
    throw new Error("Pinterest agent currently supports Gemini image models only.");
  }

  const prompt = `${pack.imagePrompt}

Final render requirements:
- Enforce brand palette: ${BRAND_COLOR_PRIMARY}, ${BRAND_COLOR_SECONDARY}, ${BRAND_COLOR_TERTIARY}, ${BRAND_COLOR_INK}, ${BRAND_COLOR_PAPER}.
- Keep the design premium, polished, and professionally typeset.
- Include visual depth and decorative motifs so the output is not flat or template-like.
- Keep one clear focal subject and a readable infographic text hierarchy.
- Typography must be integrated in-image with clean kerning and line spacing.
- Use text-safe composition so important words are never occluded by subject or ornament.
- Output image only, no extra commentary.`;
  const model = genAI.getGenerativeModel({ model: resolvedImageModel });

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      // @ts-expect-error responseModalities supported by API
      responseModalities: ["IMAGE", "TEXT"],
    },
  });

  const parts = ((result.response.candidates?.[0]?.content?.parts ?? []) as unknown) as Array<Record<string, unknown>>;
  const imagePart = parts.find((part) => "inlineData" in part) as PartWithInlineData | undefined;

  if (!imagePart?.inlineData?.data) {
    throw new Error("Image model returned no image bytes for Pinterest pin generation.");
  }

  const inputBuffer = Buffer.from(imagePart.inlineData.data, "base64");
  const normalized = await sharp(inputBuffer)
    .resize(PINTEREST_CANVAS.width, PINTEREST_CANVAS.height, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  const topicSlug = slugify(pack.topic);
  const key = `pinterest-agent/${collectionId}/${topicSlug}/${generationId}-${Date.now()}.png`;

  return uploadToR2(key, normalized, "image/png");
}
