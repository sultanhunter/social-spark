import sharp from "sharp";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { uploadToR2 } from "@/lib/r2";
import type { BlogResearchBrief } from "@/lib/blog-agent";
import type { ReasoningModel } from "@/lib/reasoning-model";

export const BLOG_IMAGE_MODEL = "gemini-3.1-flash-image-preview";

interface PartWithInlineData {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
}

interface BlogImagePromptPlan {
  coverPrompt: string;
  inlinePrompts: string[];
  inlineAltTexts: string[];
}

export interface GeneratedBlogImages {
  imageModel: string;
  coverImageUrl: string;
  inlineImages: Array<{ url: string; alt: string }>;
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

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

function sanitizeStringArray(value: unknown, max = 3): string[] {
  if (!Array.isArray(value)) return [];

  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const clean = item.trim();
    if (!clean) continue;
    output.push(clean);
    if (output.length >= max) break;
  }
  return output;
}

function sanitizeSlug(slug: string): string {
  const cleaned = slug.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return cleaned || `post-${Date.now()}`;
}

function fallbackPromptPlan(topic: string): BlogImagePromptPlan {
  return {
    coverPrompt:
      `Editorial hero image for an Islamic women's health article about "${topic}". ` +
      "Show a modest Muslim woman in a calm, uplifting setting with subtle wellness cues, warm natural lighting, " +
      "soft rose and neutral tones, clean composition, high detail, no text, no logo, no watermark.",
    inlinePrompts: [
      `Lifestyle scene illustrating practical Muslimah wellness habits connected to "${topic}", ` +
        "faith-aligned atmosphere, modern editorial photography style, no text, no watermark.",
      `Conceptual visual representing guidance and confidence for Muslim women related to "${topic}", ` +
        "gentle color palette, premium blog illustration look, no text, no watermark.",
    ],
    inlineAltTexts: [
      `Illustration related to ${topic}`,
      `Supportive visual for ${topic}`,
    ],
  };
}

async function planBlogImagePrompts({
  topic,
  title,
  research,
  reasoningModel,
}: {
  topic: string;
  title: string;
  research: BlogResearchBrief;
  reasoningModel?: ReasoningModel;
}): Promise<BlogImagePromptPlan> {
  const fallback = fallbackPromptPlan(topic);
  const model = genAI.getGenerativeModel({ model: reasoningModel || "gemini-3-pro-preview" });

  const prompt = `Create image prompts for an Islamic women's health blog post.

TOPIC: ${topic}
TITLE: ${title}
RESEARCH SUMMARY: ${research.researchSummary}
KEY INSIGHTS: ${research.keyInsights.slice(0, 5).join(" | ")}

Return JSON only:
{
  "coverPrompt": "single prompt for hero cover image",
  "inlinePrompts": ["prompt 1", "prompt 2"],
  "inlineAltTexts": ["alt text 1", "alt text 2"]
}

Rules:
- Visuals must be relevant to Muslim women and the topic.
- Beautiful, editorial, premium style.
- Absolutely no text, letters, logos, UI, or watermarks in images.
- Avoid revealing clothing and avoid insensitive depictions.
- Keep prompts specific, concrete, and image-model-friendly.`;

  const result = await model.generateContent(prompt);
  const parsed = parseJsonFromModel<Partial<BlogImagePromptPlan>>(result.response.text()) || {};

  const coverPrompt = asNonEmptyString(parsed.coverPrompt) || fallback.coverPrompt;
  const inlinePrompts = sanitizeStringArray(parsed.inlinePrompts, 2);
  const inlineAltTexts = sanitizeStringArray(parsed.inlineAltTexts, 2);

  return {
    coverPrompt,
    inlinePrompts: inlinePrompts.length > 0 ? inlinePrompts : fallback.inlinePrompts,
    inlineAltTexts: inlineAltTexts.length > 0 ? inlineAltTexts : fallback.inlineAltTexts,
  };
}

async function generateSingleImage({
  prompt,
  slug,
  kind,
  index,
}: {
  prompt: string;
  slug: string;
  kind: "cover" | "inline";
  index: number;
}): Promise<string> {
  const model = genAI.getGenerativeModel({ model: BLOG_IMAGE_MODEL });

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `${prompt}\n\n` +
              "Output requirement: return image only. No text, no typography, no logos, no watermark.",
          },
        ],
      },
    ],
    generationConfig: {
      // @ts-expect-error SDK typing lag for responseModalities
      responseModalities: ["IMAGE", "TEXT"],
    },
  });

  const parts = ((result.response.candidates?.[0]?.content?.parts ?? []) as unknown) as Array<
    Record<string, unknown>
  >;
  const imagePart = parts.find((part) => "inlineData" in part) as PartWithInlineData | undefined;

  if (!imagePart?.inlineData?.data) {
    throw new Error(`No image bytes returned for ${kind} image generation.`);
  }

  const rawBuffer = Buffer.from(imagePart.inlineData.data, "base64");
  const normalizedBuffer = await sharp(rawBuffer)
    .resize(kind === "cover" ? 1600 : 1400, kind === "cover" ? 900 : 875, {
      fit: "cover",
      position: "center",
    })
    .jpeg({ quality: 90 })
    .toBuffer();

  const safeSlug = sanitizeSlug(slug);
  const key = `blog-agent/${safeSlug}/${Date.now()}-${kind}-${index + 1}.jpg`;

  return uploadToR2(key, normalizedBuffer, "image/jpeg");
}

export async function generateBlogImages({
  topic,
  title,
  slug,
  research,
  reasoningModel,
}: {
  topic: string;
  title: string;
  slug: string;
  research: BlogResearchBrief;
  reasoningModel?: ReasoningModel;
}): Promise<GeneratedBlogImages> {
  const promptPlan = await planBlogImagePrompts({
    topic,
    title,
    research,
    reasoningModel,
  });

  const coverImageUrl = await generateSingleImage({
    prompt: promptPlan.coverPrompt,
    slug,
    kind: "cover",
    index: 0,
  });

  const inlineImageUrls = await Promise.all(
    promptPlan.inlinePrompts.slice(0, 2).map((prompt, index) =>
      generateSingleImage({
        prompt,
        slug,
        kind: "inline",
        index,
      })
    )
  );

  const inlineImages = inlineImageUrls.map((url, index) => ({
    url,
    alt: promptPlan.inlineAltTexts[index] || `Supporting image ${index + 1} for ${topic}`,
  }));

  return {
    imageModel: BLOG_IMAGE_MODEL,
    coverImageUrl,
    inlineImages,
  };
}

export function injectBlogImagesIntoMarkdown({
  markdown,
  title,
  coverImageUrl,
  inlineImages,
}: {
  markdown: string;
  title: string;
  coverImageUrl: string;
  inlineImages: Array<{ url: string; alt: string }>;
}): string {
  const safeTitle = title.trim() || "Blog post";
  let output = markdown.trim();

  const coverMarkdown = `![${safeTitle} cover image](${coverImageUrl})`;

  if (output.startsWith("# ")) {
    const firstLineBreak = output.indexOf("\n");
    if (firstLineBreak > -1) {
      output = `${output.slice(0, firstLineBreak + 1)}\n${coverMarkdown}\n${output.slice(firstLineBreak + 1).trimStart()}`;
    } else {
      output = `${output}\n\n${coverMarkdown}`;
    }
  } else {
    output = `${coverMarkdown}\n\n${output}`;
  }

  if (inlineImages.length === 0) return output;

  const sections = output.split(/\n(?=##\s)/);
  if (sections.length <= 1) {
    const appended = inlineImages
      .map((image) => `![${image.alt}](${image.url})`)
      .join("\n\n");
    return `${output}\n\n${appended}`;
  }

  const rebuilt: string[] = [sections[0].trimEnd()];

  for (let i = 1; i < sections.length; i += 1) {
    rebuilt.push(sections[i].trimEnd());
    const inline = inlineImages[i - 1];
    if (inline) {
      rebuilt.push(`![${inline.alt}](${inline.url})`);
    }
  }

  return rebuilt.join("\n\n").trim();
}
