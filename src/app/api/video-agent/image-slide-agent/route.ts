import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateSlideDesignPlans, type SlideGenerationPlan } from "@/lib/gemini";
import { DEFAULT_REASONING_MODEL, isReasoningModel } from "@/lib/reasoning-model";

export const runtime = "nodejs";
export const maxDuration = 300;

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

const APP_BRAND_PRIMARY_COLOR = "#F36F97";
const APP_BRAND_GRADIENT = ["#F36F97", "#EEB4C3", "#F7DFD6"];

type ImageSlideCampaignType =
  | "widget_shock_hook_ugc"
  | "widget_stop_using_flo_ugc"
  | "widget_wait_muslim_women_tracking_app_ugc";

const IMAGE_SLIDE_CAMPAIGNS: Array<{
  id: ImageSlideCampaignType;
  label: string;
  description: string;
}> = [
  {
    id: "widget_shock_hook_ugc",
    label: "UGC Shock Hook (Halal Flo Alternative)",
    description:
      "Shocked-reaction TikTok image slides around halal alternative to Flo + Muslim women period/pregnancy tracking.",
  },
  {
    id: "widget_stop_using_flo_ugc",
    label: "UGC Stop Using Flo (Faith-first)",
    description:
      "6-slide UGC sequence: stop using Flo, faith-value concerns, prayer-status gap, then switch to Muslimah Pro with madhab-aware worship updates.",
  },
  {
    id: "widget_wait_muslim_women_tracking_app_ugc",
    label: "UGC Wait App For Muslim Women",
    description:
      "Hook-led UGC slides: 'wait, a period + pregnancy tracking app for Muslim women?', then faith-fit gap in other apps and how Muslimah Pro solves it.",
  },
];

type CollectionRow = {
  id: string;
  app_name: string | null;
  app_description: string | null;
  app_context?: string | null;
};

type VideoUgcCharacterRow = {
  id: string;
  character_name: string;
  persona_summary: string;
  visual_style: string;
  wardrobe_notes: string | null;
  voice_tone: string | null;
  prompt_template: string;
  reference_image_url: string | null;
  image_model: string | null;
  is_default?: boolean | null;
};

type ImageSlidePlanRow = {
  id: string;
  collection_id: string;
  plan_number: number;
  campaign_type: string;
  topic_brief: string | null;
  slide_count: number;
  reasoning_model: string | null;
  character_id: string | null;
  character_name: string | null;
  script: string;
  plan_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type CharacterProfile = {
  id: string;
  characterName: string;
  personaSummary: string;
  visualStyle: string;
  wardrobeNotes: string;
  voiceTone: string;
  promptTemplate: string;
  referenceImageUrl: string | null;
  imageModel: string | null;
};

type GeneratedImageAssetEntry = {
  slideIndex: number;
  assetIndex: number;
  imageUrl: string;
  prompt: string;
  description: string;
  imageModel: string;
  generatedAt: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  return row.code === "42P01";
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const message = typeof row.message === "string" ? row.message.toLowerCase() : "";
  const details = typeof row.details === "string" ? row.details.toLowerCase() : "";
  const combined = `${message} ${details}`;
  return combined.includes(columnName.toLowerCase()) && combined.includes("column");
}

function normalizeCampaignType(value: unknown): ImageSlideCampaignType {
  if (typeof value !== "string") return "widget_shock_hook_ugc";
  const cleaned = value.trim().toLowerCase();
  if (
    cleaned === "widget_shock_hook_ugc" ||
    cleaned === "widget-shock-hook-ugc" ||
    cleaned === "ugc_halal_flo_shock" ||
    cleaned === "ugc-halal-flo-shock"
  ) {
    return "widget_shock_hook_ugc";
  }
  if (
    cleaned === "widget_stop_using_flo_ugc" ||
    cleaned === "widget-stop-using-flo-ugc" ||
    cleaned === "stop_using_flo_ugc" ||
    cleaned === "stop-using-flo-ugc" ||
    cleaned === "ugc_stop_using_flo"
  ) {
    return "widget_stop_using_flo_ugc";
  }
  if (
    cleaned === "widget_wait_muslim_women_tracking_app_ugc" ||
    cleaned === "widget-wait-muslim-women-tracking-app-ugc" ||
    cleaned === "wait_muslim_women_tracking_app_ugc" ||
    cleaned === "wait-muslim-women-tracking-app-ugc" ||
    cleaned === "wait_period_pregnancy_muslim_women_ugc" ||
    cleaned === "wait-period-pregnancy-muslim-women-ugc"
  ) {
    return "widget_wait_muslim_women_tracking_app_ugc";
  }
  return "widget_shock_hook_ugc";
}

function toCharacterProfile(row: VideoUgcCharacterRow): CharacterProfile {
  return {
    id: row.id,
    characterName: row.character_name,
    personaSummary: row.persona_summary,
    visualStyle: row.visual_style,
    wardrobeNotes: row.wardrobe_notes || "",
    voiceTone: row.voice_tone || "",
    promptTemplate: row.prompt_template,
    referenceImageUrl: row.reference_image_url,
    imageModel: row.image_model,
  };
}

function extractSlideCountFromScript(script: string): number {
  const matches = script.match(/(?:^|\n)Slide\s+\d+\b/gi) || [];
  return matches.length;
}

function cleanScriptText(value: string): string {
  return value
    .trim()
    .replace(/^```[\w-]*\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function parseSlidePlans(value: unknown): SlideGenerationPlan[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): SlideGenerationPlan | null => {
      if (typeof item !== "object" || item === null) return null;
      const row = item as Record<string, unknown>;
      const headline = typeof row.headline === "string" ? row.headline : "";
      const supportingText = typeof row.supportingText === "string" ? row.supportingText : "";
      const figmaInstructions = Array.isArray(row.figmaInstructions)
        ? row.figmaInstructions.filter((step): step is string => typeof step === "string")
        : [];
      const assetPrompts = Array.isArray(row.assetPrompts)
        ? row.assetPrompts
          .filter((asset): asset is Record<string, unknown> => typeof asset === "object" && asset !== null)
          .map((asset) => ({
            prompt: typeof asset.prompt === "string" ? asset.prompt : "",
            description: typeof asset.description === "string" ? asset.description : "Asset",
          }))
          .filter((asset) => asset.prompt.trim().length > 0)
        : [];

      return {
        headline,
        supportingText,
        figmaInstructions,
        assetPrompts,
      };
    })
    .filter((plan): plan is SlideGenerationPlan => Boolean(plan));
}

function parseGeneratedAssets(value: unknown): GeneratedImageAssetEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): GeneratedImageAssetEntry | null => {
      if (typeof item !== "object" || item === null) return null;
      const row = item as Record<string, unknown>;
      const slideIndex = typeof row.slideIndex === "number" ? Math.max(0, Math.round(row.slideIndex)) : 0;
      const assetIndex = typeof row.assetIndex === "number" ? Math.max(0, Math.round(row.assetIndex)) : 0;
      const imageUrl = typeof row.imageUrl === "string" ? row.imageUrl.trim() : "";
      const prompt = typeof row.prompt === "string" ? row.prompt : "";
      const description = typeof row.description === "string" ? row.description : "Asset";
      const imageModel = typeof row.imageModel === "string" ? row.imageModel : "unknown";
      const generatedAt = typeof row.generatedAt === "string" ? row.generatedAt : new Date(0).toISOString();
      if (!imageUrl) return null;
      return {
        slideIndex,
        assetIndex,
        imageUrl,
        prompt,
        description,
        imageModel,
        generatedAt,
      };
    })
    .filter((asset): asset is GeneratedImageAssetEntry => Boolean(asset));
}

function buildFallbackScript({
  appName,
  campaignType,
  slideCount,
}: {
  appName: string;
  campaignType: ImageSlideCampaignType;
  slideCount: number;
}): string {
  const shockHookFallbackSlides = [
    {
      headline: "wait... there is a halal alternative to flo?",
      supporting: "i just found this today",
      body: `${appName} is for period + pregnancy tracking for muslim women`,
    },
    {
      headline: "i thought flo was the only option",
      supporting: "apparently not anymore",
      body: "this one actually feels made for us",
    },
    {
      headline: "what it looks like inside",
      supporting: "super simple dashboard",
      body: "cycle day, reminders, and helpful guidance without weird vibes",
    },
    {
      headline: "why it feels different",
      supporting: "not giving generic advice",
      body: "it actually matches how muslim women track and reflect",
    },
    {
      headline: "my favorite part",
      supporting: "everything in one place",
      body: "period, pregnancy, symptoms, habits... all in one flow",
    },
    {
      headline: "save this for later",
      supporting: "try both and compare",
      body: `if you wanted a halal alternative to flo, test ${appName} yourself`,
    },
  ];

  const stopUsingFloFallbackSlides = [
    {
      headline: "muslimah to muslimah: stop using flo",
      supporting: "seriously, i had to switch",
      body: "some of its guidance and lifestyle framing did not sit right with my deen",
    },
    {
      headline: "the content felt off for me",
      supporting: "not faith-sensitive at all",
      body: "i kept seeing themes that can conflict with islamic values, so i stopped trusting it",
    },
    {
      headline: "also... no real prayer-status help",
      supporting: "this part matters every single month",
      body: "it did not clearly guide my worship status through period, purity, and istihada moments",
    },
    {
      headline: "use muslimah pro instead",
      supporting: "built specifically for muslim women",
      body: `${appName} is made for period + pregnancy tracking with a faith-first experience`,
    },
    {
      headline: "the workflow is actually simple",
      supporting: "just log what you observe",
      body: "the app auto-updates worship statuses according to your madhab so you are not guessing",
    },
    {
      headline: "save this and switch today",
      supporting: "share with another muslim sister",
      body: `if you need a flo replacement that respects your deen, try ${appName}`,
    },
  ];

  const waitTrackingAppFallbackSlides = [
    {
      headline: "wait... a period + pregnancy app for muslim women?",
      supporting: "i did not know this existed",
      body: `${appName} is built specifically for muslim women who need faith-sensitive tracking`,
    },
    {
      headline: "most tracking apps were not made for us",
      supporting: "that is the real issue",
      body: "some include content and guidance that can feel misaligned with islamic values",
    },
    {
      headline: "and they miss worship-status clarity",
      supporting: "this part is essential",
      body: "many apps do not clearly help with prayer and fasting status through cycle changes",
    },
    {
      headline: "muslimah pro solves both",
      supporting: "faith-fit + practical tracking",
      body: `${appName} combines period and pregnancy tracking with worship-status support in one flow`,
    },
    {
      headline: "you log what you observe",
      supporting: "the app handles the status logic",
      body: "it updates cycle insights and worship guidance clearly, so you are not second-guessing",
    },
    {
      headline: "save this and share with a sister",
      supporting: "everyone should know this exists",
      body: `if you wanted a muslim-women-first tracking app, try ${appName}`,
    },
  ];

  const fallbackSlides =
    campaignType === "widget_stop_using_flo_ugc"
      ? stopUsingFloFallbackSlides
      : campaignType === "widget_wait_muslim_women_tracking_app_ugc"
        ? waitTrackingAppFallbackSlides
      : shockHookFallbackSlides;

  const total = clamp(slideCount, 5, 6);
  const selected = fallbackSlides.slice(0, total);

  return [
    "Adaptation Mode: app_context",
    ...selected.flatMap((slide, index) => [
      `Slide ${index + 1}`,
      `Headline: ${slide.headline}`,
      `Supporting: ${slide.supporting}`,
      `Body: ${slide.body}`,
    ]),
  ].join("\n");
}

function buildDesignPlannerContext({
  campaignType,
  appName,
  character,
}: {
  campaignType: ImageSlideCampaignType;
  appName: string;
  character: CharacterProfile | null;
}): string {
  const campaignDirective =
    campaignType === "widget_shock_hook_ugc"
      ? [
          "Campaign requirement: UGC shocked-reaction TikTok image-slide flow.",
          "Core hook angle: there is a halal alternative to Flo.",
          `App mention requirement: explicitly position ${appName} as a period and pregnancy tracking app for Muslim women.`,
          "Visual rhythm: first 1-2 slides are genuine shocked reaction hooks; then app showcase and practical explanation.",
        ].join("\n")
      : campaignType === "widget_stop_using_flo_ugc"
        ? [
            "Campaign requirement: UGC 'stop using Flo' TikTok image-slide flow.",
            "Core hook angle: stop using Flo as a Muslim woman, then explain why in a respectful faith-values framing.",
            `App mention requirement: explicitly position ${appName} as built specifically for Muslim women.`,
            "Narrative sequence requirement: Slide 1 hook, Slide 2 value-conflict concern, Slide 3 prayer-status gap, Slide 4 app intro, Slide 5 'log observations -> madhab-based worship auto-updates', Slide 6 save/share CTA.",
            "Visual rhythm: first 2 slides should feel personal and urgent; middle slides show practical app proof; final slide closes with a soft CTA.",
          ].join("\n")
      : campaignType === "widget_wait_muslim_women_tracking_app_ugc"
        ? [
            "Campaign requirement: UGC 'wait, a period + pregnancy tracking app for Muslim women?' TikTok image-slide flow.",
            "Core hook angle: surprised discovery that a Muslim-women-first tracking app exists.",
            `App mention requirement: position ${appName} as built for Muslim women with faith-sensitive support.`,
            "Narrative sequence requirement: Slide 1 surprise hook, Slide 2-3 explain other-app fit gaps (haram-leaning content + missing worship-status guidance), Slide 4-5 show how Muslimah Pro solves both, Slide 6 soft save/share CTA.",
            "Tone requirement: educational and respectful, not insulting toward competitors.",
          ].join("\n")
      : "Campaign requirement: UGC image-slide flow.";

  const characterDirective = character
    ? [
        `Character consistency: use one recurring UGC woman identity across all slides named ${character.characterName}.`,
        `Persona: ${character.personaSummary}.`,
        `Visual style: ${character.visualStyle}.`,
        character.wardrobeNotes ? `Wardrobe notes: ${character.wardrobeNotes}.` : "",
        character.referenceImageUrl
          ? `Reference image URL for matching look: ${character.referenceImageUrl}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "Character consistency: keep one recurring modest UGC woman identity across all slides.";

  return [
    "Additional design-only requirements for Figma planner (not on-slide copy):",
    campaignDirective,
    characterDirective,
    "Text style direction (critical):",
    "- Text should look like native TikTok UGC slideshow overlays, not polished brand campaign typography.",
    "- Keep text short and conversational, mostly lowercase, with social-native phrasing.",
    "- Prefer either: (a) simple white overlay text near top/center, or (b) soft rounded sticker labels with short lines.",
    "- Avoid formal title/subtitle corporate layout and avoid long explanatory paragraphs on-slide.",
    "- Each slide should feel like a candid personal note, not a designed ad deck.",
    "Include app showcase moments naturally:",
    "- At least 2 slides should include app screenshot containers (dashboard, cycle calendar, symptom or pregnancy tracker).",
    "- At least 1 slide should include a widget-style close-up panel.",
    "- Keep screenshot frames realistic as mobile UI cards in-hand or over-shoulder contexts.",
    "UGC vibe requirements:",
    "- Selfie-like composition, real home/desk/bedroom environments, candid expressions.",
    "- Avoid glossy corporate ads; keep native TikTok image-slide realism.",
  ].join("\n");
}

async function fetchCollectionRow(collectionId: string): Promise<CollectionRow | null> {
  const primary = await supabase
    .from("collections")
    .select("id, app_name, app_description, app_context")
    .eq("id", collectionId)
    .single();

  if (!primary.error && primary.data) {
    return primary.data as CollectionRow;
  }

  if (primary.error && isMissingColumnError(primary.error, "app_context")) {
    const fallback = await supabase
      .from("collections")
      .select("id, app_name, app_description")
      .eq("id", collectionId)
      .single();

    if (!fallback.error && fallback.data) {
      return fallback.data as CollectionRow;
    }
  }

  return null;
}

async function resolveCharacter({
  collectionId,
  selectedCharacterId,
}: {
  collectionId: string;
  selectedCharacterId: string;
}): Promise<CharacterProfile | null> {
  const fullSelect =
    "id, character_name, persona_summary, visual_style, wardrobe_notes, voice_tone, prompt_template, reference_image_url, image_model, is_default";

  let result = selectedCharacterId
    ? await supabase
      .from("video_ugc_characters")
      .select(fullSelect)
      .eq("collection_id", collectionId)
      .eq("id", selectedCharacterId)
      .maybeSingle()
    : await supabase
      .from("video_ugc_characters")
      .select(fullSelect)
      .eq("collection_id", collectionId)
      .eq("is_default", true)
      .maybeSingle();

  if (result.error && isMissingColumnError(result.error, "is_default")) {
    result = selectedCharacterId
      ? await supabase
        .from("video_ugc_characters")
        .select(
          "id, character_name, persona_summary, visual_style, wardrobe_notes, voice_tone, prompt_template, reference_image_url, image_model"
        )
        .eq("collection_id", collectionId)
        .eq("id", selectedCharacterId)
        .maybeSingle()
      : await supabase
        .from("video_ugc_characters")
        .select(
          "id, character_name, persona_summary, visual_style, wardrobe_notes, voice_tone, prompt_template, reference_image_url, image_model"
        )
        .eq("collection_id", collectionId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
  }

  if (result.error) {
    throw result.error;
  }

  if (!result.data) return null;
  return toCharacterProfile(result.data as unknown as VideoUgcCharacterRow);
}

async function generateCampaignScript({
  appName,
  appContext,
  campaignType,
  topicBrief,
  slideCount,
  character,
  reasoningModel,
}: {
  appName: string;
  appContext: string;
  campaignType: ImageSlideCampaignType;
  topicBrief: string;
  slideCount: number;
  character: CharacterProfile | null;
  reasoningModel: string;
}): Promise<string> {
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const characterBlock = character
    ? [
        `Character profile for consistent UGC vibe:`,
        `- Name: ${character.characterName}`,
        `- Persona: ${character.personaSummary}`,
        `- Visual style: ${character.visualStyle}`,
        character.wardrobeNotes ? `- Wardrobe notes: ${character.wardrobeNotes}` : "",
        character.voiceTone ? `- Voice tone: ${character.voiceTone}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "Use one consistent modest Muslimah UGC character across all slides with natural selfie-style reactions.";

  const campaignBlock =
    campaignType === "widget_shock_hook_ugc"
      ? [
          "Campaign mode: shocked-reaction UGC TikTok image slides.",
          "Mandatory message to weave naturally in hook slides:",
          "- There is a halal alternative to Flo.",
          "- There is a period and pregnancy tracking app for Muslim women.",
          "Hook structure:",
          "- Slide 1: strongest shocked reaction hook.",
          "- Slide 2: second hook that stands alone and deepens curiosity.",
          "- Remaining slides: app showcase + practical proof + soft CTA.",
        ].join("\n")
      : campaignType === "widget_stop_using_flo_ugc"
        ? [
            "Campaign mode: around 6-slide UGC 'stop using Flo' TikTok image slides for Muslim women.",
            "Mandatory narrative points to include naturally and respectfully:",
            "- Slide 1 hook: stop using Flo as a Muslim woman.",
            "- Slide 2 concern: mention faith-value conflicts (haram-leaning content, normalization of relationships or actions that may not align with Islamic guidance).",
            "- Slide 3 concern: Flo does not clearly guide prayer/worship status transitions for Muslim women.",
            "- Slide 4 shift: recommend Muslimah Pro and state it is built specifically for Muslim women.",
            "- Slide 5 practical proof: user only logs observations and app auto-updates worship statuses according to her madhab.",
            "- Slide 6: soft CTA to save/share/try.",
          ].join("\n")
      : campaignType === "widget_wait_muslim_women_tracking_app_ugc"
        ? [
            "Campaign mode: around 6-slide UGC 'wait, period + pregnancy tracking app for Muslim women?' image slides.",
            "Mandatory narrative points to include naturally:",
            "- Slide 1 hook: surprised discovery that a Muslim-women-focused period and pregnancy tracking app exists.",
            "- Slide 2 concern: other apps can include content/guidance that may not align with Islamic values.",
            "- Slide 3 concern: other apps often miss clear worship-status tracking guidance for Muslim women.",
            "- Slide 4 shift: introduce Muslimah Pro as built specifically for Muslim women.",
            "- Slide 5 practical proof: explain how Muslimah Pro solves both faith-fit content concerns and worship-status clarity.",
            "- Slide 6: soft CTA to save/share/try.",
          ].join("\n")
      : "Campaign mode: UGC image slides.";

  const topicBriefFallback =
    campaignType === "widget_stop_using_flo_ugc"
      ? "Use the 'stop using Flo' hook with faith-value concerns, prayer-status gap, then Muslimah Pro + madhab-aware worship update workflow."
      : campaignType === "widget_wait_muslim_women_tracking_app_ugc"
        ? "Use a surprise hook about a period and pregnancy tracking app built for Muslim women, then show other-app faith-fit gaps and how Muslimah Pro solves both."
      : "Use the core shocked-reaction halal alternative to Flo angle.";

  const prompt = `You are a TikTok image-slide scriptwriter for ${appName}.

App context:
${appContext || "Period and pregnancy tracking app for Muslim women with faith-sensitive guidance."}

${campaignBlock}

${characterBlock}

Optional user topic/focus:
${topicBrief || topicBriefFallback}

Task:
- Generate exactly ${slideCount} slides.
- Output as plain text script with this exact structure:
Adaptation Mode: app_context
Slide 1
Headline: ...
Supporting: ...
Body: ...
Slide 2
Headline: ...
Supporting: ...
Body: ...
...

Rules:
- Keep tone natural, punchy, and UGC-like (not corporate).
- Write in social-native phrasing, mostly lower-case friendly, like candid TikTok slideshow text.
- Avoid formal/professional marketing language like "comprehensive", "solution", "platform", "optimize", "seamless experience".
- Keep primary line short and emotional (around 4-12 words), with optional second short line.
- Use max one emoji burst when it feels natural; do not overuse emojis.
- It should feel like a personal confession/reaction style, not a brand brochure.
- Each slide should have concise copy, but complete thoughts.
- Keep language English only.
- Keep content faith-sensitive and respectful.
- Include at least one explicit mention of ${appName}.
- Avoid insults, slurs, or hateful framing. Keep criticism focused on product-fit and faith-alignment concerns.
- Do not include markdown, bullet lists, or JSON. Just the script text block.`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
    },
  });

  const rawText = cleanScriptText(result.response.text());
  if (!rawText) {
    return buildFallbackScript({ appName, campaignType, slideCount });
  }

  const detectedSlides = extractSlideCountFromScript(rawText);
  if (detectedSlides === 0) {
    return buildFallbackScript({ appName, campaignType, slideCount });
  }

  return rawText;
}

export async function GET(request: NextRequest) {
  try {
    const collectionId = asText(request.nextUrl.searchParams.get("collectionId"));
    const planId = asText(request.nextUrl.searchParams.get("planId"));
    const limitParam = Number(request.nextUrl.searchParams.get("limit") || "20");
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, Math.round(limitParam))) : 20;

    if (!collectionId) {
      return NextResponse.json({
        campaigns: IMAGE_SLIDE_CAMPAIGNS,
        savedPlans: [],
      });
    }

    if (planId) {
      const detailResult = await supabase
        .from("video_image_slide_plans")
        .select(
          "id, collection_id, plan_number, campaign_type, topic_brief, slide_count, reasoning_model, character_id, character_name, script, plan_payload, created_at, updated_at"
        )
        .eq("collection_id", collectionId)
        .eq("id", planId)
        .maybeSingle();

      if (detailResult.error) {
        if (isMissingTableError(detailResult.error)) {
          return NextResponse.json(
            { error: "Table video_image_slide_plans is missing. Run latest Supabase migration." },
            { status: 500 }
          );
        }
        throw detailResult.error;
      }

      if (!detailResult.data) {
        return NextResponse.json({ error: "Image-slide plan not found." }, { status: 404 });
      }

      const typed = detailResult.data as unknown as ImageSlidePlanRow;
      const payload = typed.plan_payload || {};
      const payloadRow = payload as Record<string, unknown>;

      return NextResponse.json({
        plan: {
          id: typed.id,
          planNumber: typed.plan_number,
          campaignType: typed.campaign_type,
          topicBrief: typed.topic_brief,
          slideCount: typed.slide_count,
          reasoningModel: typed.reasoning_model,
          characterId: typed.character_id,
          characterName: typed.character_name,
          script: typed.script,
          slidePlans: parseSlidePlans(payloadRow.slidePlans),
          generatedAssets: parseGeneratedAssets(payloadRow.generatedAssets),
          createdAt: typed.created_at,
          updatedAt: typed.updated_at,
        },
      });
    }

    const result = await supabase
      .from("video_image_slide_plans")
      .select(
        "id, collection_id, plan_number, campaign_type, topic_brief, slide_count, reasoning_model, character_id, character_name, script, plan_payload, created_at, updated_at"
      )
      .eq("collection_id", collectionId)
      .order("plan_number", { ascending: false })
      .limit(limit);

    if (result.error) {
      if (isMissingTableError(result.error)) {
        return NextResponse.json({
          campaigns: IMAGE_SLIDE_CAMPAIGNS,
          savedPlans: [],
          warning: "Table video_image_slide_plans is missing. Run latest Supabase migration.",
        });
      }
      throw result.error;
    }

    const savedPlans = (result.data || []).map((row) => {
      const typed = row as unknown as ImageSlidePlanRow;
      const payload = typed.plan_payload || {};
      const script = typeof typed.script === "string" ? typed.script : "";
      const previewLine = script.split("\n").find((line) => line.trim().length > 0) || "";

      return {
        id: typed.id,
        planNumber: typed.plan_number,
        campaignType: typed.campaign_type,
        topicBrief: typed.topic_brief,
        slideCount: typed.slide_count,
        reasoningModel: typed.reasoning_model,
        characterId: typed.character_id,
        characterName: typed.character_name,
        scriptPreview: previewLine,
        slidePlanCount:
          Array.isArray((payload as Record<string, unknown>).slidePlans)
            ? ((payload as Record<string, unknown>).slidePlans as unknown[]).length
            : null,
        createdAt: typed.created_at,
        updatedAt: typed.updated_at,
      };
    });

    return NextResponse.json({
      campaigns: IMAGE_SLIDE_CAMPAIGNS,
      savedPlans,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load image-slide agent metadata." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const campaignType = normalizeCampaignType(body.campaignType);
    const selectedCharacterId = asText(body.characterId);
    const topicBrief = asText(body.topicBrief);
    const requestedSlideCount = asFiniteNumber(body.slideCount);
    const slideCount = clamp(Math.round(requestedSlideCount ?? 6), 5, 6);
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : DEFAULT_REASONING_MODEL;

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    const collection = await fetchCollectionRow(collectionId);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found." }, { status: 404 });
    }

    const character = await resolveCharacter({
      collectionId,
      selectedCharacterId,
    });

    if (selectedCharacterId && !character) {
      return NextResponse.json(
        { error: "Selected UGC character was not found for this collection." },
        { status: 404 }
      );
    }

    const latestPlanResult = await supabase
      .from("video_image_slide_plans")
      .select("plan_number")
      .eq("collection_id", collectionId)
      .order("plan_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestPlanResult.error) {
      if (isMissingTableError(latestPlanResult.error)) {
        return NextResponse.json(
          { error: "Table video_image_slide_plans is missing. Run latest Supabase migration first." },
          { status: 500 }
        );
      }
      throw latestPlanResult.error;
    }

    const appName = (collection.app_name || "Muslimah Pro").trim() || "Muslimah Pro";
    const appContext = (collection.app_description || collection.app_context || "").trim();

    const script = await generateCampaignScript({
      appName,
      appContext,
      campaignType,
      topicBrief,
      slideCount,
      character,
      reasoningModel,
    });

    const scriptSlideCount = extractSlideCountFromScript(script);
    const resolvedSlideCount = clamp(scriptSlideCount || slideCount, 5, 6);

    const designPlannerContext = buildDesignPlannerContext({
      campaignType,
      appName,
      character,
    });

    const planningScript = `${script}\n\n${designPlannerContext}`;

    const slidePlans = await generateSlideDesignPlans(
      [],
      planningScript,
      "tiktok",
      APP_BRAND_PRIMARY_COLOR,
      APP_BRAND_GRADIENT,
      appName,
      "ugc_real",
      true,
      reasoningModel,
      resolvedSlideCount
    );

    const normalizedSlidePlans: SlideGenerationPlan[] = slidePlans.map((plan) => ({
      headline: plan.headline || "",
      supportingText: plan.supportingText || "",
      figmaInstructions: Array.isArray(plan.figmaInstructions) ? plan.figmaInstructions : [],
      assetPrompts: Array.isArray(plan.assetPrompts) ? plan.assetPrompts : [],
    }));

    const nextPlanNumber = (latestPlanResult.data?.plan_number || 0) + 1;

    const inserted = await supabase
      .from("video_image_slide_plans")
      .insert({
        collection_id: collectionId,
        plan_number: nextPlanNumber,
        campaign_type: campaignType,
        topic_brief: topicBrief || null,
        slide_count: resolvedSlideCount,
        reasoning_model: reasoningModel,
        character_id: character?.id || null,
        character_name: character?.characterName || null,
        script,
        plan_payload: {
          generatedAt: new Date().toISOString(),
          appName,
          appContext,
          campaignType,
          topicBrief: topicBrief || null,
          slideCount: resolvedSlideCount,
          character,
          slidePlans: normalizedSlidePlans,
        },
      })
      .select("id, plan_number, created_at")
      .single();

    if (inserted.error || !inserted.data) {
      throw inserted.error || new Error("Failed to save image-slide agent plan.");
    }

    return NextResponse.json({
      campaignType,
      script,
      slidePlans: normalizedSlidePlans,
      meta: {
        topicBrief,
        reasoningModel,
        slideCount: resolvedSlideCount,
        characterId: character?.id || null,
        characterName: character?.characterName || null,
      },
      saved: {
        id: (inserted.data as { id: string }).id,
        planNumber: (inserted.data as { plan_number: number }).plan_number,
        createdAt: (inserted.data as { created_at: string }).created_at,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate image-slide agent plan." },
      { status: 500 }
    );
  }
}
