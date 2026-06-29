import path from "node:path";
import sharp from "sharp";
import { createOpenAIImage, createStructuredOpenAIResponse } from "@/lib/openai-api";

export const MUSLIMAH_SCRIPT_MODEL = "gpt-5.5";
export const MUSLIMAH_IMAGE_MODEL = "gpt-image-2";
export const MUSLIMAH_IMAGE_SIZE = "1024x1536";
export const MUSLIMAH_IMAGE_QUALITY = "medium" as const;

const DEFAULT_REFERENCE_IMAGE_PATHS = [
  "/var/folders/xf/mkvdqt696lvgkn7ghm3x9r_w0000gn/T/codex-clipboard-d6fca347-80f0-40e2-aa69-d9f4ff8d6693.png",
  "/var/folders/xf/mkvdqt696lvgkn7ghm3x9r_w0000gn/T/codex-clipboard-070a2da9-40af-4b28-996b-0003c7144d2b.png",
] as const;

const HOOK_BACKGROUNDS = [
  "Quran",
  "pink satin",
  "flowers",
  "prayer mat",
  "hijab",
  "tea",
  "coffee",
  "iPhone",
  "journal",
  "window light",
  "desk",
  "bed",
  "morning sunlight",
] as const;

const ROTATABLE_FEATURES = [
  "Prayer",
  "Ghusl",
  "Hayd",
  "Istihada",
  "Spotting",
  "Fasting",
  "Nutrition tracking",
  "Workout tracking",
  "Skincare tracking",
  "Hydration",
  "Sleep",
  "Mood",
  "Energy",
  "Symptom logging",
  "Pregnancy insights",
  "Personalized cycle insights",
] as const;

export type MuslimahSlideType = "hook" | "chat" | "app_reveal" | "cta";
export type MuslimahSpeaker = "older_sister" | "user";

export interface MuslimahChatMessage {
  speaker: MuslimahSpeaker;
  text: string;
  timestamp: string;
}

export interface MuslimahCarouselSlide {
  slideNumber: number;
  slideType: MuslimahSlideType;
  visualNotes: string;
  messages: MuslimahChatMessage[];
  hookText?: string;
  subtitle?: string;
  appScreenState?: string;
}

export interface MuslimahCarouselScript {
  brand: "muslimah.health";
  hook: string;
  subtitle: string;
  hookBackground: string;
  freshTalkingPoints: string[];
  selectedFeatures: string[];
  slideOrder: number[];
  caption: string;
  slides: MuslimahCarouselSlide[];
}

export interface MuslimahGeneratedImage {
  slideNumber: number;
  slideType: MuslimahSlideType;
  imageUrl: string;
  prompt: string;
}

export interface MuslimahCarouselGeneration {
  scriptModel: string;
  imageModel: string;
  imageQuality: typeof MUSLIMAH_IMAGE_QUALITY;
  imageSize: typeof MUSLIMAH_IMAGE_SIZE;
  script: MuslimahCarouselScript;
  images: MuslimahGeneratedImage[];
}

interface GenerateScriptInput {
  previousHookBackground?: string;
  previousFeatures?: string[];
  focus?: string;
  scriptModel?: string;
}

interface GenerateImagesInput {
  script: MuslimahCarouselScript;
  referenceImagePaths?: string[];
  imageModel?: string;
  collectionId?: string;
}

interface GenerateCarouselInput extends GenerateScriptInput {
  script?: MuslimahCarouselScript;
  referenceImagePaths?: string[];
  imageModel?: string;
  collectionId?: string;
}

const MUSLIMAH_SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "brand",
    "hook",
    "subtitle",
    "hookBackground",
    "freshTalkingPoints",
    "selectedFeatures",
    "slideOrder",
    "caption",
    "slides",
  ],
  properties: {
    brand: { type: "string", enum: ["muslimah.health"] },
    hook: { type: "string" },
    subtitle: { type: "string" },
    hookBackground: { type: "string" },
    freshTalkingPoints: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: { type: "string" },
    },
    selectedFeatures: {
      type: "array",
      minItems: 6,
      maxItems: 10,
      items: { type: "string" },
    },
    slideOrder: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: { type: "integer", minimum: 1, maximum: 10 },
    },
    caption: { type: "string" },
    slides: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "slideNumber",
          "slideType",
          "visualNotes",
          "messages",
          "hookText",
          "subtitle",
          "appScreenState",
        ],
        properties: {
          slideNumber: { type: "integer", minimum: 1, maximum: 10 },
          slideType: { type: "string", enum: ["hook", "chat", "app_reveal", "cta"] },
          visualNotes: { type: "string" },
          messages: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["speaker", "text", "timestamp"],
              properties: {
                speaker: { type: "string", enum: ["older_sister", "user"] },
                text: { type: "string" },
                timestamp: { type: "string" },
              },
            },
          },
          hookText: { type: "string" },
          subtitle: { type: "string" },
          appScreenState: { type: "string" },
        },
      },
    },
  },
};

function compactText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function cleanArray(value: unknown, fallback: string[], maxItems: number): string[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems);
  return items.length > 0 ? items : fallback;
}

function pickHookBackground(previousHookBackground?: string): string {
  const options = HOOK_BACKGROUNDS.filter(
    (background) => background.toLowerCase() !== previousHookBackground?.toLowerCase()
  );
  return options[Math.floor(Math.random() * options.length)] || "pink satin";
}

function pickFeatureSeed(previousFeatures: string[] = []): string[] {
  const overused = new Set(previousFeatures.map((feature) => feature.toLowerCase()));
  const fresh = ROTATABLE_FEATURES.filter((feature) => !overused.has(feature.toLowerCase()));
  const source = fresh.length >= 8 ? fresh : ROTATABLE_FEATURES;
  return [...source].sort(() => Math.random() - 0.5).slice(0, 8);
}

function normalizeScript(raw: MuslimahCarouselScript, fallbackBackground: string): MuslimahCarouselScript {
  const slides = Array.isArray(raw.slides) ? raw.slides.slice(0, 10) : [];
  const normalizedSlides: MuslimahCarouselSlide[] = Array.from({ length: 10 }, (_, index) => {
    const slide = slides[index] || ({} as MuslimahCarouselSlide);
    const slideNumber = index + 1;
    const slideType: MuslimahSlideType =
      slideNumber === 1
        ? "hook"
        : slideNumber === 10
          ? "cta"
          : slideNumber === 9
            ? "app_reveal"
            : "chat";

    return {
      slideNumber,
      slideType,
      visualNotes: compactText(slide.visualNotes, "Match the provided reference carousel style exactly."),
      messages: Array.isArray(slide.messages)
        ? slide.messages
            .slice(0, 5)
            .map((message): MuslimahChatMessage => ({
              speaker: message.speaker === "older_sister" ? "older_sister" : "user",
              text: compactText(message.text, ""),
              timestamp: compactText(message.timestamp, `10:${42 + slideNumber} AM`),
            }))
            .filter((message) => message.text.length > 0)
        : [],
      hookText:
        slideNumber === 1
          ? "Why I stopped using Flo as a Muslim woman."
          : compactText(slide.hookText, ""),
      subtitle:
        slideNumber === 1
          ? "It tracked my cycle... not my worship."
          : compactText(slide.subtitle, ""),
      appScreenState: compactText(slide.appScreenState, ""),
    };
  });

  return {
    brand: "muslimah.health",
    hook: "Why I stopped using Flo as a Muslim woman.",
    subtitle: "It tracked my cycle... not my worship.",
    hookBackground: compactText(raw.hookBackground, fallbackBackground),
    freshTalkingPoints: cleanArray(raw.freshTalkingPoints, ["Ghusl clarity", "Skincare tracking"], 4),
    selectedFeatures: cleanArray(raw.selectedFeatures, ["Prayer", "Ghusl", "Nutrition tracking", "Workout tracking", "Skincare tracking"], 10),
    slideOrder: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    caption: compactText(
      raw.caption,
      "Basic period apps can track a cycle. muslimah.health helps Muslim women connect cycle, worship, nutrition, workouts, skincare, and personal insights in one place."
    ),
    slides: normalizedSlides,
  };
}

function buildScriptUserPrompt({
  previousHookBackground,
  previousFeatures,
  focus,
}: Required<Pick<GenerateScriptInput, "previousFeatures">> & Omit<GenerateScriptInput, "scriptModel">): string {
  const hookBackground = pickHookBackground(previousHookBackground);
  const featureSeed = pickFeatureSeed(previousFeatures);

  return `Create today's 10-slide Instagram carousel JSON for muslimah.health.

Mandatory hook:
Why I stopped using Flo as a Muslim woman.

Mandatory subtitle:
It tracked my cycle... not my worship.

Chosen hook background for today:
${hookBackground}

Fresh feature seed for today:
${featureSeed.join(", ")}

Optional content focus from operator:
${focus?.trim() || "None"}

Conversation sequence, in this exact order:
1. Hook.
2. Older sister: "I thought you liked Flo?"
3. User: "It tracked my cycle..."
4. User or older sister: "But something was missing."
5. First reveal worship pain: prayer, ghusl, spotting, hayd, istihada, purity.
6. Then reveal health tracking: nutrition, workout, skincare, sleep, hydration, mood, energy.
7. Reveal muslimah.health.
8. Explain why it solves health and worship needs together.
9. Show realistic iPhone mockup with muslimah.health app UI.
10. Soft emotional CTA ending.

Positioning:
- Do not attack Flo.
- Say basic period apps mainly track the cycle.
- muslimah.health helps Muslim women manage cycle, worship, nutrition, workouts, skincare, and personalized insights together.

Writing style:
- Write like a real Muslim woman texting her older sister.
- Emotional, natural, short chat bubbles.
- No corporate tone and no obvious advertising.
- Never generate images in this step.
- Use at least 2 fresh talking points from the feature seed that are not generic.

Slide content rules:
- Exactly 10 slides.
- Slide 1 type hook, slides 2-8 type chat, slide 9 type app_reveal, slide 10 type cta.
- Chat slides should contain 2-5 messages each, short enough to render inside a phone screenshot.
- Include visualNotes for each slide for the image step.
- Keep all visible text in English.
- Return JSON only.`;
}

export async function generateMuslimahCarouselScript(input: GenerateScriptInput = {}): Promise<MuslimahCarouselScript> {
  const fallbackBackground = pickHookBackground(input.previousHookBackground);
  const result = await createStructuredOpenAIResponse<MuslimahCarouselScript>({
    model: input.scriptModel || MUSLIMAH_SCRIPT_MODEL,
    system:
      "You generate structured Instagram carousel scripts for muslimah.health. You never generate images. You preserve the requested JSON schema exactly.",
    user: buildScriptUserPrompt({
      previousHookBackground: input.previousHookBackground,
      previousFeatures: input.previousFeatures || [],
      focus: input.focus,
    }),
    format: {
      type: "json_schema",
      name: "muslimah_health_carousel_script",
      strict: true,
      schema: MUSLIMAH_SCRIPT_SCHEMA,
    },
  });

  return normalizeScript(result, fallbackBackground);
}

function renderChatMessages(messages: MuslimahChatMessage[]): string {
  if (messages.length === 0) return "No chat messages on this slide.";
  return messages
    .map((message) => `${message.speaker === "older_sister" ? "Incoming white bubble" : "Outgoing light green bubble"}: "${message.text}" (${message.timestamp})`)
    .join("\n");
}

function buildSlidePrompt(script: MuslimahCarouselScript, slide: MuslimahCarouselSlide): string {
  if (slide.slideType === "hook") {
    return `Generate slide 1 of a 10-slide 9:16 Instagram carousel for muslimah.health.

Use the attached hook-slide reference as the primary style reference.

Render this exact text:
"Why I stopped using
Flo as a Muslim woman"

Render this exact subtitle:
"it tracked my cycle... not my worship"

Typography:
- Match the reference hook typography as closely as possible: large bold rounded white sans-serif letters, medium black outline/stroke, centered, strong drop shadow only if needed for readability.
- Subtitle is smaller white rounded sans-serif with black outline.
- Add a bright pink underline only under "not my worship".
- No username, no slide number, no watermark.

Background:
- Use ${script.hookBackground}.
- Premium warm pink Muslim lifestyle flat-lay, soft sunlight, realistic photo, Quran/prayer-safe modest styling when relevant.
- Keep exact 9:16 portrait composition with text centered in the middle-lower third like the reference.
- No extra words.`;
  }

  if (slide.slideType === "app_reveal") {
    return `Generate slide ${slide.slideNumber} of a 10-slide 9:16 Instagram carousel for muslimah.health.

Use the attached chat-slide reference for header, wallpaper, colors, rounded bubbles, input bar, footer, and Apple-style typography.

Create a premium realistic iPhone mockup inside the phone screenshot. Show the muslimah.health app UI in a soft pink Apple-quality interface.
App screen state to show: ${slide.appScreenState || "cycle dashboard with worship, nutrition, workout, skincare, and personalized insights modules"}.

Chat screenshot details:
- Header text: Big Sis 💗
- Status: online
- Pink back/video/phone/menu icons
- Soft cream wallpaper with tiny floral Islamic pattern.
- Bottom input bar.
- Footer text exactly: Muslimah.health 💗
- Preserve the same spacing, bubble style, timestamps, checkmarks, and proportions as the reference.

Messages:
${renderChatMessages(slide.messages)}

Do not invent random app UI. Keep the UI realistic: cycle day card, prayer/purity status, ghusl reminder, nutrition, workout, skincare, and insights tiles only.`;
  }

  return `Generate slide ${slide.slideNumber} of a 10-slide 9:16 Instagram carousel for muslimah.health.

Use the attached chat-slide reference as the primary visual style reference.

This must look like a real premium WhatsApp/iMessage-style phone screenshot, consistent with every other chat slide:
- Header: Big Sis 💗
- Status: online
- Pink back/video/phone/menu icons
- Wallpaper: soft cream with tiny floral Islamic pattern.
- Incoming bubbles: white.
- Outgoing bubbles: light green.
- Apple-style typography.
- Include timestamps and double checkmarks on outgoing messages.
- Include bottom input bar.
- Footer text exactly: Muslimah.health 💗
- Same colors, fonts, spacing, header, icons, wallpaper, bubble style, footer, and proportions as the reference.

Messages to render exactly:
${renderChatMessages(slide.messages)}

Slide visual notes:
${slide.visualNotes}

No username other than Big Sis 💗. No slide number. No extra marketing copy.`;
}

function getReferenceImagePaths(inputPaths?: string[]): string[] {
  const envPaths = process.env.MUSLIMAH_CAROUSEL_REFERENCE_IMAGE_PATHS
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return inputPaths && inputPaths.length > 0
    ? inputPaths
    : envPaths && envPaths.length > 0
      ? envPaths
      : [...DEFAULT_REFERENCE_IMAGE_PATHS];
}

async function normalizePortraitPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(1080, 1920, { fit: "cover", position: "center" })
    .png()
    .toBuffer();
}

export async function generateMuslimahCarouselImages({
  script,
  referenceImagePaths,
  imageModel = MUSLIMAH_IMAGE_MODEL,
  collectionId = "muslimah-health",
}: GenerateImagesInput): Promise<MuslimahGeneratedImage[]> {
  const { uploadToR2 } = await import("@/lib/r2");
  const references = getReferenceImagePaths(referenceImagePaths);
  const slug = script.hook
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);

  const images: MuslimahGeneratedImage[] = [];

  for (const slide of script.slides) {
    const prompt = buildSlidePrompt(script, slide);
    const rawImage = await createOpenAIImage({
      model: imageModel,
      prompt,
      size: MUSLIMAH_IMAGE_SIZE,
      quality: MUSLIMAH_IMAGE_QUALITY,
      referenceImagePaths: references,
    });
    const normalized = await normalizePortraitPng(rawImage);
    const key = path.posix.join(
      "muslimah-health-carousels",
      collectionId,
      slug || "flo-muslim-woman",
      `${Date.now()}-slide-${slide.slideNumber}.png`
    );

    images.push({
      slideNumber: slide.slideNumber,
      slideType: slide.slideType,
      prompt,
      imageUrl: await uploadToR2(key, normalized, "image/png"),
    });
  }

  return images;
}

export async function generateMuslimahCarousel(input: GenerateCarouselInput = {}): Promise<MuslimahCarouselGeneration> {
  const script = input.script || (await generateMuslimahCarouselScript(input));
  const images = await generateMuslimahCarouselImages({
    script,
    referenceImagePaths: input.referenceImagePaths,
    imageModel: input.imageModel || MUSLIMAH_IMAGE_MODEL,
    collectionId: input.collectionId,
  });

  return {
    scriptModel: input.scriptModel || MUSLIMAH_SCRIPT_MODEL,
    imageModel: input.imageModel || MUSLIMAH_IMAGE_MODEL,
    imageQuality: MUSLIMAH_IMAGE_QUALITY,
    imageSize: MUSLIMAH_IMAGE_SIZE,
    script,
    images,
  };
}
