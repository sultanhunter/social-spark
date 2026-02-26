import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";
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

export const DEFAULT_CAROUSEL_IMAGE_MODEL: ImageGenerationModel = "gemini-2.5-flash-image";

const CAROUSEL_CANVAS = { width: 1080, height: 1350 };
const CAROUSEL_STYLE_REFERENCE_PATHS = [
  "/Users/sultanibneusman/Downloads/TikVideo.App_7609400601004363030_1.jpeg",
  "/Users/sultanibneusman/Downloads/TikVideo.App_7609400601004363030_2.jpeg",
  "/Users/sultanibneusman/Downloads/TikVideo.App_7609400601004363030_3.jpeg",
  "/Users/sultanibneusman/Downloads/TikVideo.App_7609400601004363030_4.jpeg",
  "/Users/sultanibneusman/Downloads/TikVideo.App_7609400601004363030_5.jpeg",
  "/Users/sultanibneusman/Downloads/TikVideo.App_7609400601004363030_6.jpeg",
] as const;

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

type GenerateContentResult = Awaited<
  ReturnType<ReturnType<typeof genAI.getGenerativeModel>["generateContent"]>
>;

const HOOK_STRATEGY_SUMMARY = [
  "Slide 1 must be a pattern-break hook with safe friction.",
  "Slide 2 must be a second hook that stands alone.",
  "Pace reading by alternating dense and lighter slides.",
  "Use CAPS intentionally for emphasis, not everywhere.",
  "Write how humans talk; no robotic phrasing.",
  "Use dense value + bullets for saves and shares.",
  "Preserve negative space for readability and premium feel.",
  "Use respectful constructive controversy when useful.",
  "Multiply winning angles into follow-up ideas.",
] as const;

export interface CarouselSlide {
  slideNumber: number;
  role:
    | "primary_hook"
    | "secondary_hook"
    | "insight"
    | "action"
    | "proof"
    | "cta";
  density: "dense" | "light";
  overlayTitle: string;
  overlayLines: string[];
  headline: string;
  bodyBullets: string[];
  voiceScript: string;
  hookPurpose: string;
  capsWords: string[];
  visualDirection: string;
  imagePrompt: string;
  altText: string;
  imageUrl?: string;
}

export interface CarouselPack {
  topic: string;
  angleRationale: string;
  caption: string;
  cta: string;
  hashtags: string[];
  strategyChecklist: string[];
  spinOffAngles: string[];
  slides: CarouselSlide[];
}

interface TopicDiscoveryResult {
  selectedTopic: string;
  angleRationale: string;
  controversyLine: string;
  secondaryHook: string;
}

interface PartWithInlineData {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
}

type GeminiInlineImagePart = {
  inlineData: {
    data: string;
    mimeType: string;
  };
};

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

function sanitizeStringArray(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];

  const output: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") continue;
    const clean = item.trim();
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

function normalizeSentenceCase(text: string): string {
  const clean = text.trim();
  if (!clean) return clean;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function enforceOverlayTextConstraints(title: string, lines: string[]): { overlayTitle: string; overlayLines: string[] } {
  const safeTitle = truncateWords(stripArabic(title), 5).slice(0, 34) || "Swipe for this";

  const safeLines = lines
    .map((line) => truncateWords(stripArabic(line), 6))
    .map((line) => line.slice(0, 38))
    .map((line) => normalizeSentenceCase(line))
    .filter((line) => line.length > 0)
    .slice(0, 1);

  return {
    overlayTitle: safeTitle,
    overlayLines: safeLines.length > 0 ? safeLines : ["Simple practical steps"],
  };
}

function stripArabic(text: string): string {
  return text
    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeEnglishText(value: unknown, fallback: string): string {
  const raw = asNonEmptyString(value) || fallback;
  const clean = stripArabic(raw);
  return clean || fallback;
}

function sanitizeSlideDensity(value: unknown): "dense" | "light" {
  return value === "dense" ? "dense" : "light";
}

function sanitizeRole(value: unknown, index: number): CarouselSlide["role"] {
  const valid: CarouselSlide["role"][] = [
    "primary_hook",
    "secondary_hook",
    "insight",
    "action",
    "proof",
    "cta",
  ];
  if (typeof value === "string" && valid.includes(value as CarouselSlide["role"])) {
    return value as CarouselSlide["role"];
  }
  if (index === 0) return "primary_hook";
  if (index === 1) return "secondary_hook";
  return index >= 7 ? "cta" : "insight";
}

function sanitizeSlides(value: unknown, topic: string): CarouselSlide[] {
  if (!Array.isArray(value)) return [];

  const slides = value
    .map((item, index): CarouselSlide | null => {
      if (typeof item !== "object" || item === null) return null;
      const row = item as Record<string, unknown>;

      const headline = truncateWords(
        sanitizeEnglishText(row.headline, `Slide ${index + 1}: ${topic}`),
        9
      );
      const bodyBullets = sanitizeStringArray(row.bodyBullets, 3)
        .map((bullet) => normalizeSentenceCase(truncateWords(stripArabic(bullet), 8)))
        .slice(0, 2);
      const voiceScript = sanitizeEnglishText(
        row.voiceScript,
        `${headline}${bodyBullets.length > 0 ? ` - ${bodyBullets.join(" ")}` : ""}`
      );
      const overlaySeedLines = sanitizeStringArray(row.overlayLines, 2).map((line) => stripArabic(line));
      const overlay = enforceOverlayTextConstraints(
        sanitizeEnglishText(row.overlayTitle, headline),
        overlaySeedLines.length > 0 ? overlaySeedLines : bodyBullets.slice(0, 2)
      );

      return {
        slideNumber: index + 1,
        role: sanitizeRole(row.role, index),
        density: sanitizeSlideDensity(row.density),
        overlayTitle: overlay.overlayTitle,
        overlayLines: overlay.overlayLines,
        headline,
        bodyBullets,
        voiceScript: truncateWords(voiceScript, 20),
        hookPurpose: truncateWords(
          sanitizeEnglishText(row.hookPurpose, "Drive curiosity and encourage the next swipe."),
          14
        ),
        capsWords: sanitizeStringArray(row.capsWords, 2)
          .map((word) => stripArabic(word.toUpperCase()))
          .map((word) => word.split(/\s+/)[0])
          .filter(Boolean),
        visualDirection: sanitizeEnglishText(
          truncateWords(
            sanitizeEnglishText(
              row.visualDirection,
              "Clean editorial layout with generous negative space and high readability."
            ),
            18
          ),
          "Clean editorial layout with generous negative space and high readability."
        ),
        imagePrompt: sanitizeEnglishText(
          truncateWords(
            sanitizeEnglishText(
              row.imagePrompt,
              `Instagram carousel slide about ${topic}, premium editorial style, English text only.`
            ),
            48
          ),
          `Instagram carousel slide about ${topic}, premium editorial style, English text only.`
        ),
        altText: sanitizeEnglishText(row.altText, `Carousel slide ${index + 1} for ${topic}`),
      };
    })
    .filter((slide): slide is CarouselSlide => Boolean(slide))
    .slice(0, 12);

  return slides;
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return slug || `carousel-${Date.now()}`;
}

function ensureSlideRhythm(slides: CarouselSlide[]): CarouselSlide[] {
  return slides.map((slide, index) => {
    const density = index % 2 === 0 ? "dense" : "light";
    return {
      ...slide,
      slideNumber: index + 1,
      density,
      role:
        index === 0
          ? "primary_hook"
          : index === 1
            ? "secondary_hook"
            : index === slides.length - 1
              ? "cta"
              : slide.role,
    };
  });
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

async function discoverCarouselTopic({
  appName,
  appContext,
  focus,
  reasoningModel,
}: {
  appName: string;
  appContext: string;
  focus?: string;
  reasoningModel?: ReasoningModel;
}): Promise<TopicDiscoveryResult> {
  const prompt = `You are a growth strategist for ${appName}.

App context:
${appContext}

Optional focus:
${focus?.trim() || "None"}

Task:
Research timely, high-engagement Instagram carousel opportunities for Muslim women in the space of Islam + period/pregnancy/wellness.

Return only valid JSON:
{
  "selectedTopic": "",
  "angleRationale": "2-3 sentence rationale",
  "controversyLine": "respectful challenge line that creates curiosity",
  "secondaryHook": "slide-2 hook line"
}

Rules:
- Keep it practical and faith-aligned.
- Avoid unsafe or offensive phrasing.
- No markdown outside JSON.`;

  const result = await generateWithSearchFallback(
    reasoningModel || DEFAULT_REASONING_MODEL,
    prompt
  );
  const parsed = parseJsonFromModel<Partial<TopicDiscoveryResult>>(result.response.text()) || {};

  return {
    selectedTopic: sanitizeEnglishText(
      parsed.selectedTopic,
      "7 Ramadan habits that reduce period and pregnancy overwhelm"
    ),
    angleRationale: sanitizeEnglishText(
      parsed.angleRationale,
      "This angle blends curiosity with practical value and aligns with what Muslim women are actively searching for."
    ),
    controversyLine: sanitizeEnglishText(
      parsed.controversyLine,
      "Most women are told to just push through Ramadan fatigue, but that advice often backfires."
    ),
    secondaryHook: sanitizeEnglishText(
      parsed.secondaryHook,
      "If slide one did not convince you, this one will: your current routine may be increasing your brain fog."
    ),
  };
}

export async function generateCarouselPack({
  appName,
  appContext,
  focus,
  reasoningModel,
}: {
  appName: string;
  appContext: string;
  focus?: string;
  reasoningModel?: ReasoningModel;
}): Promise<CarouselPack> {
  const topicData = await discoverCarouselTopic({
    appName,
    appContext,
    focus,
    reasoningModel,
  });

  const model = genAI.getGenerativeModel({ model: reasoningModel || DEFAULT_REASONING_MODEL });

  const prompt = `You are an elite Instagram carousel strategist and copywriter for ${appName}.

TOPIC:
${topicData.selectedTopic}

ANGLE RATIONALE:
${topicData.angleRationale}

HOOK STRATEGY RULES:
${HOOK_STRATEGY_SUMMARY.map((rule) => `- ${rule}`).join("\n")}

MANDATORY REQUIREMENTS:
- 8-10 slides.
- Slide 1 must be the strongest pattern-break hook.
- Slide 2 must be a second hook and cannot be filler.
- Alternate dense and light slide pacing.
- Use selective CAPS words where attention matters.
- Voice must be conversational and human.
- Include bullets on value-dense slides.
- Use negative space guidance in visual direction.
- Include respectful constructive controversy where useful.
- All writing must be English only.
- Never include Arabic script or non-Latin text in any slide copy or image prompt.
- Keep on-image text minimal and readable:
  - overlayTitle: max 5 words
  - overlayLines: 0-1 line, each max 6 words
  - Avoid long paragraphs on image.
- Image prompts must describe BACKGROUND ONLY (no rendered text) for each slide.
- Visual style: hyperrealistic modest hijabi woman, premium editorial, text block area at top with negative space.
- Each slide must include script text (voice-over or written narration).

Return JSON only with this exact schema:
{
  "topic": "",
  "angleRationale": "",
  "caption": "",
  "cta": "",
  "hashtags": [""],
  "strategyChecklist": [""],
  "spinOffAngles": [""],
  "slides": [
    {
      "slideNumber": 1,
      "role": "primary_hook|secondary_hook|insight|action|proof|cta",
      "density": "dense|light",
      "overlayTitle": "short top text, <=8 words",
      "overlayLines": ["short line", "short line"],
      "headline": "",
      "bodyBullets": [""],
      "voiceScript": "",
      "hookPurpose": "",
      "capsWords": [""],
      "visualDirection": "",
      "imagePrompt": "",
      "altText": ""
    }
  ]
}

Use this line idea for friction where relevant:
${topicData.controversyLine}

Use this line idea for slide 2 hook:
${topicData.secondaryHook}`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
    },
  });

  const parsed = parseJsonFromModel<Partial<CarouselPack>>(result.response.text()) || {};
  const slides = ensureSlideRhythm(
    sanitizeSlides(parsed.slides, topicData.selectedTopic).slice(0, 10)
  );

  const finalSlides =
    slides.length >= 8
      ? slides
      : ensureSlideRhythm(
        [...slides, ...buildFallbackSlides(topicData.selectedTopic)].slice(0, 9)
      );

  return {
    topic: sanitizeEnglishText(parsed.topic, topicData.selectedTopic),
    angleRationale: sanitizeEnglishText(parsed.angleRationale, topicData.angleRationale),
    caption: sanitizeEnglishText(
      parsed.caption,
      `If you want a faith-aligned routine that actually works, start with slide 1 and save this carousel for Ramadan prep.`
    ),
    cta: sanitizeEnglishText(parsed.cta, "Save this post and send it to a Muslimah who needs this today."),
    hashtags: sanitizeStringArray(parsed.hashtags, 15),
    strategyChecklist:
      sanitizeStringArray(parsed.strategyChecklist, 12).length > 0
        ? sanitizeStringArray(parsed.strategyChecklist, 12)
        : [...HOOK_STRATEGY_SUMMARY],
    spinOffAngles: sanitizeStringArray(parsed.spinOffAngles, 8),
    slides: finalSlides,
  };
}

function buildFallbackSlides(topic: string): CarouselSlide[] {
  const fallbackHeadlines = [
    `STOP guessing: ${topic}`,
    "Most women miss this second signal",
    "Why your current routine drains you",
    "Use this 3-step framework",
    "COMMON mistakes to avoid",
    "What to do this week",
    "Save this checklist",
    "Your next best angle",
    "Do this now",
  ];

  return fallbackHeadlines.map((headline, index) => {
    const overlay = enforceOverlayTextConstraints(
      headline,
      index % 2 === 0
        ? ["Faith aligned plan", "Simple steps you can apply"]
        : ["One clear takeaway"]
    );

    return {
      slideNumber: index + 1,
      role: index === 0 ? "primary_hook" : index === 1 ? "secondary_hook" : index === 8 ? "cta" : "insight",
      density: index % 2 === 0 ? "dense" : "light",
      overlayTitle: overlay.overlayTitle,
      overlayLines: overlay.overlayLines,
      headline,
      bodyBullets:
        index % 2 === 0
          ? [
              "Practical and faith-aligned guidance.",
              "Simple actions you can apply today.",
              "Built for Muslim women with real schedules.",
            ]
          : ["Clear one-step takeaway."],
      voiceScript: `Slide ${index + 1}: ${headline}. Practical and faith-aligned guidance in plain English.`,
      hookPurpose: "Keep the reader swiping with clear and useful progression.",
      capsWords: index === 0 ? ["STOP"] : index === 4 ? ["COMMON"] : [],
      visualDirection: "Editorial layout with clear hierarchy and generous negative space.",
      imagePrompt:
        `Instagram carousel slide in a premium editorial style about ${topic}. ` +
        `Hyperrealistic modest hijabi woman scene, no rendered text, warm blush and neutral tones, clear negative space.`,
      altText: `Slide ${index + 1} about ${topic}`,
    };
  });
}

function buildImageGenerationPrompt(slide: CarouselSlide, topic: string, totalSlides: number): string {
  const textLines = [slide.overlayTitle, ...slide.overlayLines].filter((line) => line.trim().length > 0);

  return `Create a fully finished Instagram carousel slide image (${slide.slideNumber}/${totalSlides}) for Muslimah Pro.

TOPIC: ${topic}
ROLE: ${slide.role}
DENSITY: ${slide.density}

DESIGN GOAL:
- Hyperrealistic modest hijabi woman in a real-world selfie-like shot.
- Hyperrealistic environments similar to real home, car, or public place contexts.
- Modern editorial social style, natural lighting, realistic skin and fabric textures.
- 4:5 portrait composition.
- Match the framing language and realism quality of the attached reference examples.
- Reserve clean negative space in top area for later text overlay.

TEXT CONTEXT FOR PLANNING ONLY (DO NOT RENDER THIS TEXT):
${textLines.map((line) => `- ${line}`).join("\n") || "- Keep text minimal"}

SAFE AREA RULES:
- Do not render any words, letters, numbers, typographic glyphs, labels, logos, or signs.
- Keep the top 42% visually simpler so text can be added later.
- Keep subject and key objects away from 10% page margins on all sides.

CRITICAL RULES:
- Use ENGLISH text only.
- DO NOT include Arabic letters or other non-Latin scripts.
- No gibberish text, no logos, no watermark, no UI chrome.
- Keep subject respectful and faith-aligned.

Slide direction:
${slide.visualDirection}

Additional guidance:
${slide.imagePrompt}`;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildTextOverlaySvg(slide: CarouselSlide): Buffer {
  const title = escapeSvgText(slide.overlayTitle.toUpperCase());
  const line = escapeSvgText((slide.overlayLines[0] || "").trim());
  const hasLine = line.length > 0;
  const panelHeight = hasLine ? 300 : 230;
  const titleFontSize = title.length > 24 ? 62 : title.length > 16 ? 72 : 82;
  const lineFontSize = line.length > 28 ? 44 : 54;

  const lineMarkup = hasLine
    ? `<text x="96" y="290" fill="#F8FAFC" font-family="Inter, Arial, sans-serif" font-size="${lineFontSize}" font-weight="600">${line}</text>`
    : "";

  const svg = `<svg width="1080" height="1350" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="overlayGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgba(15, 23, 42, 0.86)"/>
      <stop offset="100%" stop-color="rgba(30, 41, 59, 0.62)"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="952" height="${panelHeight}" rx="34" fill="url(#overlayGradient)"/>
  <text x="96" y="190" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="${titleFontSize}" font-weight="800">${title}</text>
  ${lineMarkup}
</svg>`;

  return Buffer.from(svg);
}

function mimeTypeFromPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
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

async function getStyleReferenceImageParts(): Promise<GeminiInlineImagePart[]> {
  const loaded = await Promise.all(
    CAROUSEL_STYLE_REFERENCE_PATHS.slice(0, 3).map((filePath) => loadLocalImagePart(filePath))
  );
  return loaded.filter((item): item is GeminiInlineImagePart => Boolean(item));
}

async function generateSlideImage({
  slide,
  prompt,
  key,
  imageModel,
}: {
  slide: CarouselSlide;
  prompt: string;
  key: string;
  imageModel: ImageGenerationModel;
}): Promise<string> {
  if (!imageModel.startsWith("gemini-")) {
    throw new Error("Carousel agent currently supports Gemini image models only.");
  }

  const styleReferenceParts = await getStyleReferenceImageParts();
  const model = genAI.getGenerativeModel({ model: imageModel });
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }, ...styleReferenceParts] }],
    generationConfig: {
      // @ts-expect-error responseModalities supported by API
      responseModalities: ["IMAGE", "TEXT"],
    },
  });

  const parts = ((result.response.candidates?.[0]?.content?.parts ?? []) as unknown) as Array<Record<string, unknown>>;
  const imagePart = parts.find((part) => "inlineData" in part) as PartWithInlineData | undefined;

  if (!imagePart?.inlineData?.data) {
    throw new Error("Image model returned no image bytes.");
  }

  const inputBuffer = Buffer.from(imagePart.inlineData.data, "base64");
  const normalized = await sharp(inputBuffer)
    .resize(CAROUSEL_CANVAS.width, CAROUSEL_CANVAS.height, { fit: "cover", position: "center" })
    .png()
    .toBuffer();

  const overlaid = await sharp(normalized)
    .composite([{ input: buildTextOverlaySvg(slide), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return uploadToR2(key, overlaid, "image/png");
}

export async function generateCarouselImages({
  pack,
  collectionId,
  imageModel,
}: {
  pack: CarouselPack;
  collectionId: string;
  imageModel?: ImageGenerationModel;
}): Promise<CarouselPack> {
  const resolvedImageModel = imageModel || DEFAULT_CAROUSEL_IMAGE_MODEL || DEFAULT_IMAGE_GENERATION_MODEL;
  const generationId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const slidesWithImages: CarouselSlide[] = [];

  for (let i = 0; i < pack.slides.length; i += 1) {
    const slide = pack.slides[i];
    const imageUrl = await generateSingleCarouselSlideImage({
      collectionId,
      generationId,
      topic: pack.topic,
      totalSlides: pack.slides.length,
      slide,
      imageModel: resolvedImageModel,
    });

    slidesWithImages.push({
      ...slide,
      imageUrl,
    });
  }

  return {
    ...pack,
    slides: slidesWithImages,
  };
}

export async function generateSingleCarouselSlideImage({
  collectionId,
  generationId,
  topic,
  totalSlides,
  slide,
  imageModel,
}: {
  collectionId: string;
  generationId: string;
  topic: string;
  totalSlides: number;
  slide: CarouselSlide;
  imageModel?: ImageGenerationModel;
}): Promise<string> {
  const resolvedImageModel = imageModel || DEFAULT_CAROUSEL_IMAGE_MODEL || DEFAULT_IMAGE_GENERATION_MODEL;
  const topicSlug = slugify(topic);
  const prompt = buildImageGenerationPrompt(slide, topic, totalSlides);
  const key = `carousel-agent/${collectionId}/${topicSlug}/${generationId}/slide-${slide.slideNumber}-${Date.now()}.png`;

  return generateSlideImage({
    slide,
    prompt,
    key,
    imageModel: resolvedImageModel,
  });
}
