import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  DEFAULT_REASONING_MODEL,
  isReasoningModel,
  type ReasoningModel,
} from "@/lib/reasoning-model";

export const BLOG_REASONING_MODEL = DEFAULT_REASONING_MODEL;

export const BLOG_CATEGORIES = [
  "islamic-guidance",
  "period-health",
  "pregnancy",
  "lifestyle",
  "app-updates",
  "general",
] as const;

export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

export interface BlogResearchSource {
  title: string;
  url: string;
  insight: string;
}

export interface BlogResearchBrief {
  researchSummary: string;
  targetAudience: string;
  primaryKeywords: string[];
  secondaryKeywords: string[];
  outline: string[];
  keyInsights: string[];
  faqQuestions: string[];
  sources: BlogResearchSource[];
}

export interface TrendingTopicCandidate {
  title: string;
  whyNow: string;
  seoPotential: string;
  audienceNeed: string;
}

export interface TrendingTopicPlan {
  selectedTopic: string;
  selectionRationale: string;
  trendSignals: string[];
  candidateTopics: TrendingTopicCandidate[];
  suggestedCategory: BlogCategory;
}

export interface GeneratedBlogDraft {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  category: BlogCategory;
  tags: string[];
  author: string;
  meta_title: string;
  meta_description: string;
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

const BLOG_MIN_WORDS = 2000;
const BLOG_MAX_WORDS = 5000;
const BLOG_MIN_EXTERNAL_LINKS = 5;

type GenerateContentResult = Awaited<
  ReturnType<ReturnType<typeof genAI.getGenerativeModel>["generateContent"]>
>;

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

function normalizeBlogModel(value: unknown): ReasoningModel {
  return isReasoningModel(value) ? value : BLOG_REASONING_MODEL;
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

function sanitizeStringArray(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const output: string[] = [];

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

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeSources(value: unknown, max = 12): BlogResearchSource[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const output: BlogResearchSource[] = [];

  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const url = normalizeUrl(row.url);
    if (!url || seen.has(url)) continue;

    seen.add(url);
    output.push({
      title: asNonEmptyString(row.title) || "Source",
      url,
      insight: asNonEmptyString(row.insight) || "",
    });

    if (output.length >= max) break;
  }

  return output;
}

function sanitizeTopicCandidates(value: unknown, max = 6): TrendingTopicCandidate[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const output: TrendingTopicCandidate[] = [];

  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const title = asNonEmptyString(row.title);
    if (!title) continue;

    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    output.push({
      title,
      whyNow: asNonEmptyString(row.whyNow) || "Timely and highly relevant to current Muslimah needs.",
      seoPotential: asNonEmptyString(row.seoPotential) || "Strong organic interest with actionable long-tail intent.",
      audienceNeed: asNonEmptyString(row.audienceNeed) || "Addresses a practical pain point for Muslim women.",
    });

    if (output.length >= max) break;
  }

  return output;
}

function extractGroundingSources(response: unknown): BlogResearchSource[] {
  if (typeof response !== "object" || response === null) return [];
  const row = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { title?: string; uri?: string } }>;
      };
    }>;
  };

  const chunks = row.candidates
    ?.flatMap((candidate) => candidate.groundingMetadata?.groundingChunks || [])
    .map((chunk) => chunk.web)
    .filter((web): web is { title?: string; uri?: string } => Boolean(web));

  if (!chunks || chunks.length === 0) return [];

  return sanitizeSources(
    chunks.map((web) => ({
      title: web.title || "Source",
      url: web.uri || "",
      insight: "",
    }))
  );
}

export function normalizeBlogCategory(value: unknown, fallback: BlogCategory = "general"): BlogCategory {
  if (typeof value !== "string") return fallback;
  const match = BLOG_CATEGORIES.find((category) => category === value.trim());
  return match || fallback;
}

function inferCategoryFromText(text: string): BlogCategory {
  const context = text.toLowerCase();

  if (/(period|menstrual|pms|cycle|menstruation|cramp)/i.test(context)) {
    return "period-health";
  }

  if (/(pregnan|postpartum|nifas|breastfeeding|trimester)/i.test(context)) {
    return "pregnancy";
  }

  if (/(update|release|feature|version|changelog|roadmap|announcement)/i.test(context)) {
    return "app-updates";
  }

  if (/(quran|hadith|sunnah|dua|fiqh|islam|islamic)/i.test(context)) {
    return "islamic-guidance";
  }

  if (/(routine|habit|wellbeing|wellness|mindset|productivity|self-care|lifestyle)/i.test(context)) {
    return "lifestyle";
  }

  return "general";
}

function inferCategoryFromContext(topic: string, research: BlogResearchBrief): BlogCategory {
  const context = `${topic} ${research.researchSummary} ${research.primaryKeywords.join(" ")} ${research.secondaryKeywords.join(" ")}`
    .toLowerCase();

  return inferCategoryFromText(context);
}

function normalizeTopicFingerprint(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeTopic(topic: string): Set<string> {
  const stopWords = new Set([
    "the", "and", "for", "with", "your", "from", "into", "about", "that", "this", "what", "how", "why", "guide",
    "tips", "best", "women", "muslim", "muslimah", "pro", "to", "of", "in", "on", "a", "an",
  ]);

  const tokens = normalizeTopicFingerprint(topic)
    .split(" ")
    .filter((token) => token.length >= 3 && !stopWords.has(token));

  return new Set(tokens);
}

function overlapScore(topicA: string, topicB: string): number {
  const a = tokenizeTopic(topicA);
  const b = tokenizeTopic(topicB);
  if (a.size === 0 || b.size === 0) return 0;

  let matches = 0;
  for (const token of a) {
    if (b.has(token)) matches += 1;
  }

  return matches / Math.max(a.size, b.size);
}

function isTopicTooSimilar(topic: string, blockedTopics: string[]): boolean {
  const normalizedTopic = normalizeTopicFingerprint(topic);
  if (!normalizedTopic) return false;

  return blockedTopics.some((blocked) => {
    const normalizedBlocked = normalizeTopicFingerprint(blocked);
    if (!normalizedBlocked) return false;
    if (normalizedTopic === normalizedBlocked) return true;
    return overlapScore(normalizedTopic, normalizedBlocked) >= 0.58;
  });
}

function pickDistinctTopic(
  selectedTopic: string,
  candidates: TrendingTopicCandidate[],
  blockedTopics: string[]
): string {
  if (!isTopicTooSimilar(selectedTopic, blockedTopics)) return selectedTopic;

  for (const candidate of candidates) {
    if (!isTopicTooSimilar(candidate.title, blockedTopics)) {
      return candidate.title;
    }
  }

  return selectedTopic;
}

export async function discoverTrendingBlogTopic({
  appName,
  appContext,
  reasoningModel,
  recentTopics,
}: {
  appName: string;
  appContext: string;
  reasoningModel?: ReasoningModel;
  recentTopics?: string[];
}): Promise<TrendingTopicPlan> {
  const now = new Date().toISOString().slice(0, 10);
  const blockedTopics = sanitizeStringArray(recentTopics, 18);
  const blockedTopicPrompt = blockedTopics.length > 0
    ? `
TOPIC DIVERSITY CONSTRAINTS
- Do not repeat or closely paraphrase these recent topics:
${blockedTopics.map((topic) => `  - ${topic}`).join("\n")}
- If many recent topics are Ramadan-focused, choose a different high-demand angle unless explicitly requested.
- Prefer a fresh user intent (new pain point, stage, or question cluster).`
    : "";

  const prompt = `You are a Muslimah-focused SEO strategist.

TODAY: ${now}

APP CONTEXT
- App: ${appName}
- Context: ${appContext}

TASK
Find trending and timely blog opportunities for Muslim women at the intersection of Islam + women + period/pregnancy/lifestyle guidance.
${blockedTopicPrompt}

Return only valid JSON with this exact schema:
{
  "selectedTopic": "single best topic to publish now",
  "selectionRationale": "2-3 sentences",
  "trendSignals": ["5-8 concrete trend signals or seasonal triggers"],
  "candidateTopics": [
    {
      "title": "topic title",
      "whyNow": "what makes this timely now",
      "seoPotential": "search opportunity summary",
      "audienceNeed": "problem this solves"
    }
  ],
  "suggestedCategory": "islamic-guidance|period-health|pregnancy|lifestyle|app-updates|general"
}

Rules:
- Prioritize topics with clear demand and practical value.
- Favor service-style topics and questions people actually search for.
- Keep relevance strictly to Muslim women.
- Do not default to Ramadan topics if a non-seasonal topic currently has strong demand.
- Do not output markdown or explanations outside JSON.`;

  const requestPayload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
    },
  };

  const result = await generateWithSearchFallback(normalizeBlogModel(reasoningModel), requestPayload);

  const parsed = parseJsonFromModel<Partial<TrendingTopicPlan>>(result.response.text()) || {};
  const candidateTopics = sanitizeTopicCandidates(parsed.candidateTopics, 6);
  const selectedTopicRaw =
    asNonEmptyString(parsed.selectedTopic) ||
    candidateTopics[0]?.title ||
    "How Muslim Women Can Manage Period and Worship with Confidence";
  const selectedTopic = pickDistinctTopic(selectedTopicRaw, candidateTopics, blockedTopics);
  const trendSignals = sanitizeStringArray(parsed.trendSignals, 8);
  const derivedCategory = inferCategoryFromText(
    `${selectedTopic} ${trendSignals.join(" ")} ${candidateTopics.map((item) => item.title).join(" ")}`
  );

  return {
    selectedTopic,
    selectionRationale:
      asNonEmptyString(parsed.selectionRationale) ||
      "This topic balances timely search demand with practical faith-based value for Muslim women.",
    trendSignals,
    candidateTopics,
    suggestedCategory: normalizeBlogCategory(parsed.suggestedCategory, derivedCategory),
  };
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);

  return slug || `muslimah-pro-${Date.now()}`;
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(markdown: string): number {
  const plain = stripMarkdown(markdown);
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

function countExternalMarkdownLinks(markdown: string): number {
  const links = markdown.match(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/gi);
  return links ? links.length : 0;
}

function hasTableOfContents(markdown: string): boolean {
  return /(^|\n)##\s+(table of contents|contents)\b/i.test(markdown);
}

function toAnchorSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureTableOfContents(markdown: string): string {
  if (hasTableOfContents(markdown)) return markdown;

  const lines = markdown.split("\n");
  const headings = lines
    .map((line) => {
      const h2 = line.match(/^##\s+(.+)/);
      if (h2) return { level: 2, text: h2[1].trim() };

      const h3 = line.match(/^###\s+(.+)/);
      if (h3) return { level: 3, text: h3[1].trim() };

      return null;
    })
    .filter((row): row is { level: 2 | 3; text: string } => Boolean(row));

  if (headings.length < 3) return markdown;

  const tocLines = ["## Table of Contents"];
  for (const heading of headings) {
    const prefix = heading.level === 3 ? "  -" : "-";
    tocLines.push(`${prefix} [${heading.text}](#${toAnchorSlug(heading.text)})`);
  }

  const tocBlock = `${tocLines.join("\n")}\n`;

  const h1Index = lines.findIndex((line) => /^#\s+/.test(line));
  if (h1Index >= 0) {
    const before = lines.slice(0, h1Index + 1).join("\n").trimEnd();
    const after = lines.slice(h1Index + 1).join("\n").trimStart();
    return `${before}\n\n${tocBlock}\n${after}`.trim();
  }

  return `${tocBlock}\n${markdown}`.trim();
}

function ensureExternalReferenceLinks(markdown: string, sources: BlogResearchSource[]): string {
  if (countExternalMarkdownLinks(markdown) >= BLOG_MIN_EXTERNAL_LINKS) {
    return markdown;
  }

  const linksInContent = new Set(
    (markdown.match(/https?:\/\/[^)\s]+/g) || []).map((url) => url.toLowerCase())
  );

  const extraSources = sources.filter((source) => !linksInContent.has(source.url.toLowerCase()));
  if (extraSources.length === 0) return markdown;

  const needed = Math.max(0, BLOG_MIN_EXTERNAL_LINKS - countExternalMarkdownLinks(markdown));
  const bullets = extraSources.slice(0, Math.max(needed, 3)).map((source) => {
    const insight = source.insight ? ` - ${source.insight}` : "";
    return `- [${source.title}](${source.url})${insight}`;
  });

  if (bullets.length === 0) return markdown;

  return `${markdown.trim()}\n\n## Trusted External Resources\n${bullets.join("\n")}`;
}

function cleanMarkdownFromModel(text: string): string {
  return text
    .trim()
    .replace(/^```markdown\s*/i, "")
    .replace(/^```md\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function buildExcerpt(content: string): string {
  const plain = stripMarkdown(content);
  if (plain.length <= 180) return plain;
  return `${plain.slice(0, 177).trimEnd()}...`;
}

function clampMetaTitle(title: string): string {
  const clean = title.trim();
  if (clean.length <= 60) return clean;
  return `${clean.slice(0, 57).trimEnd()}...`;
}

function clampMetaDescription(metaDescription: string, excerpt: string): string {
  const fallback = excerpt || "Learn practical Islamic guidance and Muslimah wellness insights from Muslimah Pro.";
  let output = (metaDescription || fallback).trim();

  if (output.length < 150) {
    const tail = " Discover practical faith-aligned tips, authentic references, and action steps tailored for Muslim women.";
    output = `${output}${output.endsWith(".") ? "" : "."}${tail}`.trim();
  }

  if (output.length > 160) {
    output = `${output.slice(0, 157).trimEnd()}...`;
  }

  return output;
}

async function rewriteBlogForDepthAndSeo({
  model,
  topic,
  appName,
  appContext,
  research,
  title,
  currentMarkdown,
}: {
  model: ReturnType<typeof genAI.getGenerativeModel>;
  topic: string;
  appName: string;
  appContext: string;
  research: BlogResearchBrief;
  title: string;
  currentMarkdown: string;
}): Promise<string> {
  const prompt = `You are a senior SEO editor for ${appName}.

Revise and expand the markdown blog post below so it becomes highly useful, deeply comprehensive, and engaging for Muslim women.

TOPIC: ${topic}
APP CONTEXT: ${appContext}

RESEARCH BRIEF (JSON):
${JSON.stringify(research, null, 2)}

CURRENT DRAFT MARKDOWN:
${currentMarkdown}

MANDATORY REQUIREMENTS:
- Keep the title as: ${title}
- Keep output in markdown only (no HTML).
- Word count must be between ${BLOG_MIN_WORDS} and ${BLOG_MAX_WORDS} words.
- Add "## Table of Contents" near the top with markdown anchor links.
- Cover the topic end-to-end: fundamentals, Islamic perspective, practical steps, common mistakes, FAQ, and actionable checklists.
- Naturally include primary and secondary keywords for SEO.
- Include at least ${BLOG_MIN_EXTERNAL_LINKS} credible external links in markdown format to relevant authorities and resources.
- Write in a warm, practical, and trustworthy tone.
- Make each section genuinely useful, not fluffy.

Return markdown only.`;

  const response = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.45,
    },
  });

  return cleanMarkdownFromModel(response.response.text());
}

export async function createTopicResearchBrief({
  topic,
  appName,
  appContext,
  reasoningModel,
}: {
  topic: string;
  appName: string;
  appContext: string;
  reasoningModel?: ReasoningModel;
}): Promise<BlogResearchBrief> {
  const prompt = `You are a senior Muslimah-content researcher and SEO strategist.

APP CONTEXT
- App: ${appName}
- Context: ${appContext}

TOPIC
- ${topic}

TASK
Research this topic with web-grounded context and return only valid JSON with this exact schema:
{
  "researchSummary": "2-4 sentence synthesis of what matters most right now",
  "targetAudience": "who this should help",
  "primaryKeywords": ["5-8 SEO keywords"],
  "secondaryKeywords": ["6-12 long-tail/supporting keywords"],
  "outline": ["H2/H3 section plan in order"],
  "keyInsights": ["8-12 factual insights that should shape the article"],
  "faqQuestions": ["5-8 real user questions worth answering"],
  "sources": [
    { "title": "Source title", "url": "https://...", "insight": "what this source contributes" }
  ]
}

Rules:
- Focus on Muslim women, Islamic guidance, period/pregnancy wellness, and practical faith-based lifestyle when relevant.
- Keep sources recent and credible where possible.
- Do not output markdown or prose outside JSON.`;

  const requestPayload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.35,
    },
  };

  const result = await generateWithSearchFallback(normalizeBlogModel(reasoningModel), requestPayload);

  const parsed = parseJsonFromModel<Partial<BlogResearchBrief>>(result.response.text()) || {};
  const parsedSources = sanitizeSources(parsed.sources);
  const groundedSources = extractGroundingSources(result.response);
  const mergedSources = sanitizeSources([...parsedSources, ...groundedSources], 12);

  const keyInsights = sanitizeStringArray(parsed.keyInsights, 12);
  const outline = sanitizeStringArray(parsed.outline, 12);
  const faqQuestions = sanitizeStringArray(parsed.faqQuestions, 10);
  const primaryKeywords = sanitizeStringArray(parsed.primaryKeywords, 8);
  const secondaryKeywords = sanitizeStringArray(parsed.secondaryKeywords, 14);

  return {
    researchSummary:
      asNonEmptyString(parsed.researchSummary) ||
      "This topic matters to Muslim women seeking practical, faith-aligned guidance grounded in reliable information.",
    targetAudience:
      asNonEmptyString(parsed.targetAudience) ||
      "Muslim women looking for trustworthy Islamic and wellness guidance.",
    primaryKeywords: primaryKeywords.length > 0 ? primaryKeywords : [topic.trim()],
    secondaryKeywords,
    outline:
      outline.length > 0
        ? outline
        : [
            `Why ${topic} matters for Muslim women`,
            "Islamic perspective and practical guidance",
            "Action steps and daily implementation",
            "Frequently asked questions",
          ],
    keyInsights:
      keyInsights.length > 0
        ? keyInsights
        : [
            "Readers need practical and credible guidance they can apply right away.",
            "Combining Islamic context with health literacy increases trust and usefulness.",
          ],
    faqQuestions:
      faqQuestions.length > 0
        ? faqQuestions
        : [
            `What should Muslim women know about ${topic}?`,
            `How can I apply ${topic} in daily life?`,
          ],
    sources: mergedSources,
  };
}

export async function generateSeoBlogDraft({
  topic,
  appName,
  appContext,
  research,
  reasoningModel,
}: {
  topic: string;
  appName: string;
  appContext: string;
  research: BlogResearchBrief;
  reasoningModel?: ReasoningModel;
}): Promise<GeneratedBlogDraft> {
  const model = genAI.getGenerativeModel({ model: normalizeBlogModel(reasoningModel) });

  const prompt = `You are an expert SEO writer for ${appName}.

Write a deeply useful, well-researched blog post in markdown for this topic: "${topic}".

APP CONTEXT
- ${appContext}

RESEARCH BRIEF (JSON)
${JSON.stringify(research, null, 2)}

MANDATORY REQUIREMENTS
- Audience: Muslim women.
- Tone: warm, credible, practical, and faith-aligned.
- Length: ${BLOG_MIN_WORDS} to ${BLOG_MAX_WORDS} words.
- Structure: compelling intro, clear H2/H3 sections, practical takeaways, and FAQ.
- Add a "## Table of Contents" section near the top with markdown anchor links for easy navigation.
- Cover the topic comprehensively from basics to advanced practical guidance.
- SEO: naturally include primary and secondary keywords.
- Citations: include at least ${BLOG_MIN_EXTERNAL_LINKS} inline markdown links to credible external resources.
- Use markdown only (no raw HTML).
- Include Islamic references carefully and responsibly.

Return JSON only with this exact schema:
{
  "title": "",
  "slug": "",
  "excerpt": "",
  "content": "",
  "category": "",
  "tags": [""],
  "author": "Muslimah Pro Team",
  "meta_title": "",
  "meta_description": ""
}

Rules:
- category must be one of: islamic-guidance, period-health, pregnancy, lifestyle, app-updates, general.
- slug must be lowercase with numbers/hyphens only.
- meta_title must be <= 60 chars.
- meta_description should target 150-160 chars.
- Ensure content is genuinely useful, practical, and engaging for someone who wants complete guidance.
- Do not wrap JSON in markdown.`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.55,
    },
  });

  const parsed = parseJsonFromModel<Partial<GeneratedBlogDraft>>(result.response.text()) || {};

  const title = asNonEmptyString(parsed.title) || `${topic.trim()} - A Practical Muslimah Guide`;
  let content = asNonEmptyString(parsed.content) || `# ${title}\n\n${research.researchSummary}`;
  content = cleanMarkdownFromModel(content);

  if (!content.startsWith("# ")) {
    content = `# ${title}\n\n${content}`;
  }

  content = ensureTableOfContents(content);
  content = ensureExternalReferenceLinks(content, research.sources);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const words = countWords(content);
    const links = countExternalMarkdownLinks(content);
    const needsImprovement =
      words < BLOG_MIN_WORDS ||
      words > BLOG_MAX_WORDS ||
      !hasTableOfContents(content) ||
      links < BLOG_MIN_EXTERNAL_LINKS;

    if (!needsImprovement) break;

    const revised = await rewriteBlogForDepthAndSeo({
      model,
      topic,
      appName,
      appContext,
      research,
      title,
      currentMarkdown: content,
    });

    content = revised || content;
    content = ensureTableOfContents(content);
    content = ensureExternalReferenceLinks(content, research.sources);
  }

  const excerpt = asNonEmptyString(parsed.excerpt) || buildExcerpt(content);
  const category = normalizeBlogCategory(parsed.category, inferCategoryFromContext(topic, research));
  const tags = sanitizeStringArray(parsed.tags, 10);
  const fallbackTags = sanitizeStringArray([
    ...research.primaryKeywords,
    ...research.secondaryKeywords.slice(0, 4),
  ], 10);

  return {
    title,
    slug: slugify(asNonEmptyString(parsed.slug) || title),
    excerpt,
    content,
    category,
    tags: tags.length > 0 ? tags : fallbackTags,
    author: asNonEmptyString(parsed.author) || "Muslimah Pro Team",
    meta_title: clampMetaTitle(asNonEmptyString(parsed.meta_title) || title),
    meta_description: clampMetaDescription(
      asNonEmptyString(parsed.meta_description) || excerpt,
      excerpt
    ),
  };
}
