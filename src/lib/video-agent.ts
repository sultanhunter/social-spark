import { randomUUID } from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { fetchWithProxy } from "@/lib/proxy-fetch";
import { extractPlatform } from "@/lib/utils";
import { DEFAULT_REASONING_MODEL, type ReasoningModel } from "@/lib/reasoning-model";
import { extractVideoFrames } from "@/lib/social-extractor";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || "");

type NormalizedFormatType = "ugc" | "ai_video" | "hybrid" | "editorial";
type AnalysisMethod = "frame_aware";
type InlineImagePart = { inlineData: { data: string; mimeType: string } };
const MAX_SINGLE_VIDEO_CLIP_SECONDS = 8;

type VideoContentCategory =
  | "islamic_only"
  | "islamic_period_pregnancy"
  | "period_pregnancy_only";

interface VideoContentClassification {
  category: VideoContentCategory;
  confidence: number;
  reason: string;
}

export interface VideoSourceMetadata {
  url: string;
  platform: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  userNotes?: string | null;
  transcriptSummary?: string | null;
  transcriptText?: string | null;
  sourceDurationSeconds?: number | null;
}

export interface VideoFormatAnalysis {
  formatName: string;
  formatType: NormalizedFormatType;
  formatSignature: string;
  analysisMethod: AnalysisMethod;
  sourceDurationSeconds: number | null;
  sampledFrameCount: number;
  sampledFrameSources: string[];
  directMediaUrl: string | null;
  r2VideoUrl: string | null;
  transcriptAvailable: boolean;
  transcriptSummary: string;
  transcriptText: string;
  transcriptHighlights: string[];
  visualSignals: string[];
  onScreenTextPatterns: string[];
  summary: string;
  whyItWorks: string[];
  hookPatterns: string[];
  shotPattern: string[];
  editingStyle: string[];
  scriptScaffold: string;
  higgsfieldPromptTemplate: string;
  recreationChecklist: string[];
  durationGuidance: string;
  confidence: number;
}

export interface ExistingFormatCandidate {
  id: string;
  formatName: string;
  formatType: string;
  formatSignature: string;
  summary: string;
  hookPatterns: string[];
  editingStyle: string[];
}

export interface FormatMatchDecision {
  matchedFormatId: string | null;
  confidence: number;
  reason: string;
}

type PlanBeat = {
  timecode: string;
  visual: string;
  narration: string;
  onScreenText: string;
  editNote: string;
};

type SegmentScriptShot = {
  shotId: string;
  visual: string;
  narration: string;
  onScreenText: string;
  editNote: string;
};

type MultiShotPrompt = {
  shotId: string;
  generationType: "base_ai_video" | "ugc_video" | "ai_broll" | "product_ui_overlay" | "transition_fx";
  scene: string;
  prompt: string;
  shotDuration: string;
};

export interface VideoStartFrame {
  imageUrl?: string;
  prompt?: string;
  generatedAt?: string;
  characterId?: string | null;
  imageModel?: string;
}

export interface MotionControlSegment {
  segmentId: number;
  timecode: string;
  durationSeconds: number;
  startFramePrompt: string;
  script?: {
    hook: string;
    shots: SegmentScriptShot[];
    cta: string;
  };
  veoPrompt?: string;
  multiShotPrompts?: MultiShotPrompt[];
  startFrame?: VideoStartFrame;
}

export interface VideoRecreationPlan {
  title: string;
  strategy: string;
  objective: string;
  klingMotionControlOnly?: boolean;
  contentClassification?: VideoContentClassification;
  maxSingleClipDurationSeconds?: number;
  useMotionControl?: boolean;
  motionControlSegments?: MotionControlSegment[];
  integrationMode: "standard_adaptation" | "public_figure_overlay_only";
  publicFigureNotes: string;
  overlayOpportunities: string[];
  deliverableSpec: {
    duration: string;
    aspectRatio: string;
    platforms: string[];
    voiceStyle: string;
  };
  script: {
    hook: string;
    beats: PlanBeat[];
    cta: string;
  };
  socialCaption: {
    caption: string;
    hashtags: string[];
  };
  seedanceSinglePrompt?: {
    model: string;
    prompt: string;
    targetDuration: string;
  };
  higgsfieldPrompts?: MultiShotPrompt[];
  finalCutProSteps: string[];
  productionSteps: string[];
  editingTimeline: string[];
  assetsChecklist: string[];
  qaChecklist: string[];
}

export interface UGCCharacterProfile {
  id?: string;
  characterName: string;
  personaSummary: string;
  visualStyle: string;
  wardrobeNotes: string;
  voiceTone: string;
  promptTemplate: string;
  referenceImageUrl?: string | null;
  imageModel?: string | null;
}

export type ScriptAgentVideoType = "ugc" | "ai_animation" | "faceless_broll" | "hybrid";
export type ScriptAgentTopicCategory = "period_pregnancy" | "islamic_period_pregnancy";
export type ScriptAgentCampaignMode =
  | "standard"
  | "widget_reaction_ugc"
  | "widget_shock_hook_ugc"
  | "widget_late_period_reaction_hook_ugc"
  | "ai_objects_educational_explainer"
  | "mixed_media_relatable_pov"
  | "static_photoreal_avatar_meme"
  | "daily_ugc_quran_journey";

export interface VideoScriptIdeationPlan {
  title: string;
  objective: string;
  campaignMode: ScriptAgentCampaignMode;
  topicCategory: ScriptAgentTopicCategory;
  selectedVideoType: ScriptAgentVideoType;
  videoTypeReason: string;
  appHookStrategy: string;
  targetDurationSeconds: number;
  maxSingleClipDurationSeconds: number;
  script: {
    hook: string;
    beats: PlanBeat[];
    cta: string;
  };
  motionControlSegments: MotionControlSegment[];
  socialCaption: {
    caption: string;
    hashtags: string[];
  };
  productionSteps: string[];
  qaChecklist: string[];
}

export function stripMultiShotPromptsFromIdeationPlan(plan: VideoScriptIdeationPlan): VideoScriptIdeationPlan {
  return {
    ...plan,
    motionControlSegments: (plan.motionControlSegments || []).map((segment) => {
      const { multiShotPrompts, ...rest } = segment;
      void multiShotPrompts;
      return rest;
    }),
  };
}

function requireGeminiKey(): void {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    throw new Error("GOOGLE_GEMINI_API_KEY is missing. Add it before running the video pipeline.");
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function sanitizeString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const cleaned = cleanText(value);
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];

  const output: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") continue;
    const cleaned = cleanText(item);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= max) break;
  }

  return output;
}

function sanitizeHashtagArray(value: unknown, max = 8): string[] {
  const base = sanitizeStringArray(value, max * 2);
  const output: string[] = [];
  const seen = new Set<string>();

  for (const item of base) {
    const compact = item.replace(/\s+/g, "").replace(/^#+/, "").trim();
    if (!compact) continue;
    const tag = `#${compact}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(tag);
    if (output.length >= max) break;
  }

  return output;
}

function sanitizeNumber(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return value;
}

function sanitizePlanBeats(value: unknown, maxBeats: number): PlanBeat[] {
  const beatsRaw = Array.isArray(value) ? value : [];
  return beatsRaw
    .map((beat) => {
      if (!isRecord(beat)) return null;
      return {
        timecode: sanitizeString(beat.timecode, "0:00-0:04"),
        visual: sanitizeString(beat.visual, "Match source format visual pacing."),
        narration: sanitizeString(beat.narration, ""),
        onScreenText: sanitizeString(beat.onScreenText, ""),
        editNote: sanitizeString(beat.editNote, ""),
      };
    })
    .filter((beat): beat is PlanBeat => Boolean(beat))
    .slice(0, maxBeats);
}

function closeOpenEndedLine(text: string): string {
  const cleaned = cleanText(text);
  if (!cleaned) return "";

  const danglingEndPattern = /(\b(and|but|so|because|then|or)\s*)$/i;
  const withoutDangling = cleaned.replace(danglingEndPattern, "").trim();
  const candidate = withoutDangling || cleaned;

  if (/[.!?]$/.test(candidate)) return candidate;
  return `${candidate}.`;
}

function sanitizeSegmentScriptShots(value: unknown, maxShots: number): SegmentScriptShot[] {
  const shotsRaw = Array.isArray(value) ? value : [];
  return shotsRaw
    .map((shot, index) => {
      if (!isRecord(shot)) return null;
      const shotIdRaw = sanitizeString(shot.shotId, "");
      const shotId =
        shotIdRaw || sanitizeString(shot.timecode, "") || `shot${index + 1}`;
      return {
        shotId: /^shot\d+$/i.test(shotId) ? shotId.toLowerCase() : `shot${index + 1}`,
        visual: sanitizeString(shot.visual, "Match source format visual pacing."),
        narration: closeOpenEndedLine(sanitizeString(shot.narration, "")),
        onScreenText: closeOpenEndedLine(sanitizeString(shot.onScreenText, "")),
        editNote: sanitizeString(shot.editNote, ""),
      };
    })
    .filter((shot): shot is SegmentScriptShot => Boolean(shot))
    .slice(0, maxShots);
}

function planBeatsToSegmentShots(beats: PlanBeat[]): SegmentScriptShot[] {
  return beats.map((beat, index) => ({
    shotId: `shot${index + 1}`,
    visual: beat.visual,
    narration: closeOpenEndedLine(beat.narration),
    onScreenText: closeOpenEndedLine(beat.onScreenText),
    editNote: beat.editNote,
  }));
}

function enforceSegmentBoundaryTransitions(segments: MotionControlSegment[]): MotionControlSegment[] {
  return segments;
}

function enforceWidgetReactionSeriesPattern(segments: MotionControlSegment[], appName: string): MotionControlSegment[] {
  const overlayTemplates = [
    '"I did not know an app like this existed."',
    '"I just found the perfect widget for tracking cycles."',
    '"Finally clear worship status for each cycle phase."',
  ];

  return segments.map((segment, index, all) => {
    const shots = [...(segment.script?.shots || [])];
    if (shots.length === 0) {
      shots.push({
        shotId: "shot1",
        visual: "UGC talking-head reaction in a real home setting, natural daylight.",
        narration: "I wish I had this earlier.",
        onScreenText: overlayTemplates[index % overlayTemplates.length],
        editNote: "Strong surprised-to-happy expression.",
      });
    }

    const firstShot = shots[0];
    shots[0] = {
      ...firstShot,
      visual: cleanText(`${firstShot.visual} Real UGC reaction beat: initial surprise, then happy relief.`),
      onScreenText: cleanText(firstShot.onScreenText) || overlayTemplates[index % overlayTemplates.length],
      editNote: cleanText(
        `${firstShot.editNote || ""} Keep this as a genuine reaction moment, not salesy delivery.`
      ),
    };

    const overlayShotIndex = Math.min(1, shots.length - 1);
    const overlayShot = shots[overlayShotIndex];
    shots[overlayShotIndex] = {
      ...overlayShot,
      onScreenText:
        cleanText(overlayShot.onScreenText) ||
        "Widget shows current cycle phase and worship status (prayer, fasting, Quran: permissible or paused).",
      editNote: cleanText(
        `${overlayShot.editNote || ""} Emphasize lock-screen/home-screen widget utility in text overlay.`
      ),
    };

    const isLastSegment = index === all.length - 1;
    const lastShotIndex = shots.length - 1;
    const lastShot = shots[lastShotIndex];
    shots[lastShotIndex] = {
      ...lastShot,
      narration: closeOpenEndedLine(lastShot.narration),
      onScreenText: closeOpenEndedLine(lastShot.onScreenText),
      editNote: cleanText(
        `${lastShot.editNote || ""} End with 0.5s visual hold. In final edit, append full-screen ${appName} screen recording showing home and lock-screen widgets.`
      ),
    };

    return {
      ...segment,
      script: {
        hook: segment.script?.hook || "",
        shots,
        cta: isLastSegment
          ? closeOpenEndedLine(segment.script?.cta || "Save this and try the widget setup today.")
          : closeOpenEndedLine(segment.script?.cta || ""),
      },
    };
  });
}

function enforceWidgetShockHookSeriesPattern(segments: MotionControlSegment[], appName: string): MotionControlSegment[] {
  return segments.map((segment, index, all) => {
    let shots = [...(segment.script?.shots || [])];
    if (shots.length === 0) {
      shots.push({
        shotId: "shot1",
        visual: "UGC selfie reaction at home, character notices phone screen and is visibly shocked.",
        narration: "Wait... I just found this and I'm shocked.",
        onScreenText: "Hook title",
        editNote: "Open with sharp shocked reaction then a smile of relief.",
      });
    }

    const firstShot = shots[0];
    const secondShot = shots[1] || null;
    const aiGeneratedHookTitleOne = closeOpenEndedLine(
      cleanText(firstShot.onScreenText) ||
      cleanText(segment.script?.hook) ||
      "Flo for Muslim women"
    );
    const aiGeneratedHookTitleTwo = closeOpenEndedLine(
      cleanText(secondShot?.onScreenText) ||
      cleanText(secondShot?.narration) ||
      "No more period tracking app with haram contents"
    );

    if (index === 0) {
      shots = [
        {
          shotId: "shot1",
          visual: cleanText(
            `${firstShot.visual || "UGC selfie reaction shot"} Shocked reaction only. Keep expression strong, silent, and emotionally clear.`
          ),
          narration: "",
          onScreenText: aiGeneratedHookTitleOne,
          editNote:
            "0-4 seconds only: reaction-only hook. No app explanation, no dialogue. Title 1 overlay is added in post.",
        },
        {
          shotId: "shot2",
          visual: cleanText(
            `${secondShot?.visual || firstShot.visual || "Same framing continuation"} Continue shock-to-relief expression with slight head movement.`
          ),
          narration: "",
          onScreenText: aiGeneratedHookTitleTwo,
          editNote:
            "4-8 seconds only: reaction-only continuation. No dialogue. Title 2 overlay is added in post.",
        },
      ];
    } else {
      shots[0] = {
        ...firstShot,
        visual: cleanText(
          `${firstShot.visual} Character now starts talking about the app and why it is a halal alternative for Muslim women.`
        ),
        narration: closeOpenEndedLine(
          firstShot.narration ||
          "I just found this app and it feels like a halal alternative built for Muslim women."
        ),
        onScreenText: closeOpenEndedLine(cleanText(firstShot.onScreenText) || "Halal alternative for Muslim women"),
        editNote: cleanText(
          `${firstShot.editNote || ""} From this segment onward, character can speak and explain the app quickly.`
        ),
      };
    }

    const showcaseShotIndex = Math.min(1, shots.length - 1);
    const showcaseShot = shots[showcaseShotIndex];
    if (index !== 0) {
      shots[showcaseShotIndex] = {
        ...showcaseShot,
        visual: cleanText(
          `${showcaseShot.visual || "Phone close-up"} Quick app showcase: lock-screen/home-screen widget plus one fast app dashboard glance.`
        ),
        onScreenText:
          cleanText(showcaseShot.onScreenText) ||
          "Quick showcase: cycle phase + worship status widget in seconds",
        editNote: cleanText(
          `${showcaseShot.editNote || ""} Keep app showcase quick (about 1-2 seconds) and clear.`
        ),
      };
    }

    const prompts = (segment.multiShotPrompts || []).map((promptItem) => {
      if (promptItem.generationType === "product_ui_overlay") return promptItem;
      return {
        ...promptItem,
        generationType: "ugc_video" as const,
      };
    });

    const isLastSegment = index === all.length - 1;
    const lastShotIndex = shots.length - 1;
    const lastShot = shots[lastShotIndex];
    shots[lastShotIndex] = {
      ...lastShot,
      narration: closeOpenEndedLine(lastShot.narration),
      onScreenText: closeOpenEndedLine(lastShot.onScreenText),
      editNote: cleanText(
        `${lastShot.editNote || ""} End with a brief visual hold. In final edit, append quick full-screen ${appName} app showcase.`
      ),
    };

    return {
      ...segment,
      startFramePrompt: cleanText(
        segment.startFramePrompt ||
        `UGC shocked reaction opening frame with phone visible, then quick transition to ${appName} widget showcase.`
      ),
      script: {
        hook: segment.script?.hook || "",
        shots,
        cta: isLastSegment
          ? closeOpenEndedLine(segment.script?.cta || "I just found this. Save and try the widget setup today.")
          : closeOpenEndedLine(segment.script?.cta || ""),
      },
      multiShotPrompts: prompts,
    };
  });
}

function enforceWidgetLatePeriodReactionHookPattern(segments: MotionControlSegment[]): MotionControlSegment[] {
  const firstSegment = segments[0];
  const firstShot = firstSegment?.script?.shots?.[0];
  const secondShot = firstSegment?.script?.shots?.[1];

  const hookTextOne = closeOpenEndedLine(
    cleanText(firstShot?.onScreenText) || "is everyone's period late in march?"
  );
  const hookTextTwo = closeOpenEndedLine(
    cleanText(secondShot?.onScreenText) ||
    "raise your hand if it's march and your period still hasn't shown up"
  );

  const reactionVisualBase = cleanText(
    firstShot?.visual ||
    firstSegment?.startFramePrompt ||
    "Medium close-up of a young woman indoors, thinking pose, then gentle head shake with slight disappointment."
  );

  const reactionShotOneVisual = cleanText(
    `${reactionVisualBase} Keep it simple and light, with a relatable expression.`
  );
  const reactionShotTwoVisual = cleanText(
    `${secondShot?.visual || reactionVisualBase} Continue same framing and lighting with another gentle head shake and slight disappointed look.`
  );

  return [
    {
      segmentId: 1,
      timecode: "0:00-0:08",
      durationSeconds: 8,
      startFramePrompt: reactionVisualBase,
      script: {
        hook: hookTextOne,
        shots: [
          {
            shotId: "shot1",
            visual: reactionShotOneVisual,
            narration: "",
            onScreenText: hookTextOne,
            editNote:
              "0-4 seconds only. Pure reaction hook. No dialogue. Overlay text is added in post.",
          },
          {
            shotId: "shot2",
            visual: reactionShotTwoVisual,
            narration: "",
            onScreenText: hookTextTwo,
            editNote:
              "4-8 seconds only. Continue simple reaction with gentle head shake. No dialogue. Overlay text is added in post.",
          },
        ],
        cta: "",
      },
      multiShotPrompts: [
        {
          shotId: "group1_shot1",
          generationType: "ugc_video",
          scene: "Simple late-period reaction hook",
          prompt:
            "Medium close-up indoors, young woman in a thinking pose, then gentle head shake with slight disappointment, light and relatable mood, realistic UGC smartphone framing, natural room lighting. No dialogue: reaction only.",
          shotDuration: "4s",
        },
        {
          shotId: "group1_shot2",
          generationType: "ugc_video",
          scene: "Simple reaction continuation",
          prompt:
            "Same medium close-up and lighting, she stays in thinking pose and gives one more gentle head shake with slight disappointed expression, natural breathing and micro-expressions, authentic UGC realism. No dialogue: reaction only.",
          shotDuration: "4s",
        },
      ],
    },
  ];
}

function enforceAiObjectsEducationalExplainerPattern(
  segments: MotionControlSegment[],
  appName: string
): MotionControlSegment[] {
  const normalizedAppName = cleanText(appName);
  const appPattern = normalizedAppName ? new RegExp(escapeRegExp(normalizedAppName), "i") : null;
  const appAlreadyMentioned = appPattern
    ? segments.some((segment) => {
      const script = segment.script;
      const text = [
        script?.hook || "",
        script?.cta || "",
        ...(script?.shots || []).map((shot) => `${shot.narration || ""} ${shot.onScreenText || ""}`),
      ].join(" ");
      return appPattern.test(text);
    })
    : false;

  let appHookInjected = appAlreadyMentioned;
  const appHookSegmentIndex = Math.max(1, Math.floor(segments.length * 0.6));

  return segments.map((segment, index, all) => {
    const shots = [...(segment.script?.shots || [])];
    if (shots.length === 0) {
      shots.push({
        shotId: "shot1",
        visual: "High-quality animated living objects with feminine styling explain a practical cycle-health concept with warm and cute expressions.",
        narration: "Let us break this down in a simple way.",
        onScreenText: "Simple object explainer",
        editNote: "Keep educational pacing with expressive object acting.",
      });
    }

    const firstShot = shots[0];
    shots[0] = {
      ...firstShot,
      visual: cleanText(
        `${firstShot.visual} Premium stylized 3D animation: cute anthropomorphic everyday objects with feminine-coded design cues (soft silhouettes, gentle expressions, graceful gestures) explain the concept clearly.`
      ),
      editNote: cleanText(
        `${firstShot.editNote || ""} Keep the look polished, cinematic, educational, and feminine-friendly with gentle humor.`
      ),
    };

    const shouldInjectAppHook = !appHookInjected && index >= appHookSegmentIndex;
    if (shouldInjectAppHook && normalizedAppName) {
      const appHookShotIndex = Math.min(1, shots.length - 1);
      const appHookShot = shots[appHookShotIndex];
      shots[appHookShotIndex] = {
        ...appHookShot,
        narration: closeOpenEndedLine(
          cleanText(appHookShot.narration) ||
            `Quick practical step: check ${normalizedAppName} to confirm cycle and worship status before deciding what to do next.`
        ),
        onScreenText:
          cleanText(appHookShot.onScreenText) ||
          "Quick status check inside app",
        editNote: cleanText(
          `${appHookShot.editNote || ""} Keep app mention subtle and practical, never salesy.`
        ),
      };
      appHookInjected = true;
    }

    const prompts = (segment.multiShotPrompts || []).map((promptItem) => {
      const shouldPreserveType =
        promptItem.generationType === "product_ui_overlay" || promptItem.generationType === "transition_fx";
      return {
        ...promptItem,
        generationType: shouldPreserveType ? promptItem.generationType : "base_ai_video",
        prompt: cleanText(
          `${promptItem.prompt} Premium stylized 3D CGI, cute anthropomorphic everyday objects with feminine styling, expressive faces and limbs, educational storytelling clarity.`
        ),
      };
    });

    const isLastSegment = index === all.length - 1;

    return {
      ...segment,
      startFramePrompt: cleanText(
        segment.startFramePrompt ||
          "Premium stylized 3D animated scene: cute feminine-styled living objects begin explaining a practical health concept in a warm educational tone."
      ),
      script: {
        hook: segment.script?.hook || "",
        shots,
        cta: isLastSegment
          ? closeOpenEndedLine(
            segment.script?.cta || "Save this explainer for later and share it with someone who needs it."
          )
          : closeOpenEndedLine(segment.script?.cta || ""),
      },
      multiShotPrompts: prompts,
    };
  });
}

function enforceMixedMediaRelatablePovPattern(
  segments: MotionControlSegment[],
  appName: string
): MotionControlSegment[] {
  const phaseLabels = [
    "the week before my period",
    "the week of my period",
    "the week after my period",
  ];
  const memeOverlayFallbacks = [
    "pov: is it me or my hormones?",
    "the week before my period",
    "the week of my period",
    "the week after my period",
    "me trying to be normal",
    "back to baseline... for now",
  ];
  const heroSegmentIndex = Math.min(
    Math.max(0, segments.length - 1),
    Math.max(1, Math.floor(segments.length * 0.55))
  );

  return segments.map((segment, index, all) => {
    const shots = [...(segment.script?.shots || [])];
    if (shots.length === 0) {
      shots.push({
        shotId: "shot1",
        visual:
          "Stylized 3D animated woman avatar in a real-world home environment, expressive and relatable body language.",
        narration: "",
        onScreenText: phaseLabels[Math.min(index, phaseLabels.length - 1)],
        editNote: "No dialogue. Keep acting subtle but relatable with meme-like comedic exaggeration.",
      });
    }

    const phaseLabel = phaseLabels[Math.min(index, phaseLabels.length - 1)];
    const firstShot = shots[0];
    shots[0] = {
      ...firstShot,
      visual: cleanText(
        `${firstShot.visual} Mixed-media direction: stylized chibi-like 3D female avatar composited into a photoreal real-world environment with matched perspective, contact shadows, and scene-consistent lighting. Scale lock: avatar is NOT miniature/toy-sized in the world; keep normal human-relative scale while framing slightly wider so she appears smaller in frame.`
      ),
      onScreenText: cleanText(firstShot.onScreenText) || phaseLabel,
      editNote: cleanText(
        `${firstShot.editNote || ""} Keep overlays minimal and lowercase in post: white rounded text label with soft shadow near upper-middle frame.`
      ),
    };

    if (index === heroSegmentIndex) {
      if (shots.length < 2) {
        shots.push({
          shotId: `shot${shots.length + 1}`,
          visual: "Phone hero moment in the avatar's hand.",
          narration: "",
          onScreenText: "quick app check",
          editNote: "",
        });
      }

      const appShotIndex = Math.min(1, shots.length - 1);
      const appShot = shots[appShotIndex];
      shots[appShotIndex] = {
        ...appShot,
        visual: cleanText(
          `${appShot.visual || "Phone close-up"} Hero app shot: avatar checks ${appName} on phone in-frame with a realistic 2D UI treatment and subtle screen reflections.`
        ),
        onScreenText: cleanText(appShot.onScreenText) || "quick app check",
        editNote: cleanText(
          `${appShot.editNote || ""} Keep this beat utility-first and tangible. Add real app UI in post/composite, not baked into generated render.`
        ),
      };
    }

    const prompts = (segment.multiShotPrompts || []).map((promptItem) => {
      const isUiOrFx =
        promptItem.generationType === "product_ui_overlay" ||
        promptItem.generationType === "transition_fx";

      const noDialoguePrompt = cleanText(
        promptItem.prompt.replace(/Dialogue\s*:\s*"[^"]*"/gi, "No dialogue: performance-only.")
      );

      return {
        ...promptItem,
        generationType: isUiOrFx ? promptItem.generationType : "base_ai_video",
        prompt: cleanText(
          `${noDialoguePrompt} No dialogue: expressive meme-style performance only. Mixed-media look: stylized chibi-like 3D avatar integrated into photoreal real-world background with matched lighting and perspective. Keep avatar normal world scale (not miniature), but use wider composition so she reads smaller in frame. Action-only performance direction: clear body actions per shot (walk, sit, head turn, hand gesture, phone check, shrug) with mouth relaxed/closed and zero speech articulation. Keep performance funny, relatable, and slightly exaggerated for short-form retention.`
        ),
      };
    });

    const normalizedShots = shots.map((shot, shotIndex) => {
      const overlayText =
        cleanText(shot.onScreenText) ||
        memeOverlayFallbacks[Math.min(shotIndex + index, memeOverlayFallbacks.length - 1)];

      return {
        ...shot,
        narration: "",
        onScreenText: overlayText,
        editNote: cleanText(
          `${shot.editNote || ""} No spoken dialogue or lip-sync. Storytelling must come from explicit physical actions + text overlays added in editing. Keep mouth in non-speaking state.`
        ),
      };
    });

    const isLastSegment = index === all.length - 1;

    return {
      ...segment,
      startFramePrompt: cleanText(
        segment.startFramePrompt ||
          "Mixed-media opening frame: stylized 3D avatar grounded in a realistic everyday scene with matching light and camera perspective."
      ),
      script: {
        hook: segment.script?.hook || "",
        shots: normalizedShots,
        cta: isLastSegment
          ? closeOpenEndedLine(
            segment.script?.cta ||
              `If this feels too real, save this and check ${appName} for today's cycle + worship status.`
          )
          : closeOpenEndedLine(segment.script?.cta || ""),
      },
      multiShotPrompts: prompts,
    };
  });
}

function enforceStaticPhotorealAvatarMemePattern(
  segments: MotionControlSegment[],
  appName: string
): MotionControlSegment[] {
  const memeOverlayFallbacks = [
    "pov: me checking if this mood is me or hormones",
    "the week before my period",
    "the week of my period",
    "the week after my period",
    "trying to stay calm",
    "back to normal... maybe",
  ];
  const heroSegmentIndex = Math.min(
    Math.max(0, segments.length - 1),
    Math.max(1, Math.floor(segments.length * 0.55))
  );

  return segments.map((segment, index, all) => {
    const shots = [...(segment.script?.shots || [])];
    if (shots.length === 0) {
      shots.push({
        shotId: "shot1",
        visual:
          "Stylized 3D cartoon-like Muslimah avatar in a photoreal home environment, expressive and relatable body language.",
        narration: "",
        onScreenText: memeOverlayFallbacks[Math.min(index, memeOverlayFallbacks.length - 1)],
        editNote: "No dialogue. Meme-style acting and text-overlay storytelling in post.",
      });
    }

    const firstShot = shots[0];
    shots[0] = {
      ...firstShot,
      visual: cleanText(
        `${firstShot.visual} Style direction: one recurring stylized 3D cartoon-like female avatar composited into an ultra-photoreal location. Keep avatar normal world scale (not miniature/toy-sized), but compose wider so she appears modestly smaller in frame than a typical close social video. Keep background mostly static with locked camera and only subtle natural environmental movement.`
      ),
      onScreenText: cleanText(firstShot.onScreenText) || memeOverlayFallbacks[Math.min(index, memeOverlayFallbacks.length - 1)],
      editNote: cleanText(
        `${firstShot.editNote || ""} Keep meme pacing funny and engaging with expressive micro-reactions. Overlay text added in edit only.`
      ),
    };

    if (index === heroSegmentIndex) {
      if (shots.length < 2) {
        shots.push({
          shotId: `shot${shots.length + 1}`,
          visual: "Phone utility beat in avatar's hand.",
          narration: "",
          onScreenText: "quick app check",
          editNote: "",
        });
      }

      const appShotIndex = Math.min(1, shots.length - 1);
      const appShot = shots[appShotIndex];
      shots[appShotIndex] = {
        ...appShot,
        visual: cleanText(
          `${appShot.visual || "Phone close-up"} Utility beat: avatar checks ${appName} on phone. Keep generated screen neutral and replace with real app UI in edit.`
        ),
        onScreenText: cleanText(appShot.onScreenText) || "quick app check",
        editNote: cleanText(`${appShot.editNote || ""} Keep this beat practical and brief, not salesy.`),
      };
    }

    const prompts = (segment.multiShotPrompts || []).map((promptItem) => {
      const isUiOrFx =
        promptItem.generationType === "product_ui_overlay" ||
        promptItem.generationType === "transition_fx";
      const noDialoguePrompt = cleanText(
        promptItem.prompt.replace(/Dialogue\s*:\s*"[^"]*"/gi, "No dialogue: expressive performance only.")
      );

      return {
        ...promptItem,
        generationType: isUiOrFx ? promptItem.generationType : "base_ai_video",
        prompt: cleanText(
          `${noDialoguePrompt} No dialogue. 3D cartoon-like avatar in ultra-photoreal environment. Keep avatar normal world scale (not miniature), and make her appear smaller through wider framing only. Keep background mostly static, camera locked, lighting physically plausible, avatar grounded with contact shadows and matched perspective. Action-only performance: clear physical action in each shot (walking, turning, sitting, checking phone, hand-on-stomach, shrug, reaction pose) and no speech mouth shapes. Funny, engaging meme-style acting with subtle exaggeration.`
        ),
      };
    });

    const normalizedShots = shots.map((shot, shotIndex) => ({
      ...shot,
      narration: "",
      onScreenText:
        cleanText(shot.onScreenText) ||
        memeOverlayFallbacks[Math.min(shotIndex + index, memeOverlayFallbacks.length - 1)],
      editNote: cleanText(
        `${shot.editNote || ""} No spoken dialogue or lip-sync. Storytelling comes from explicit body actions + text overlays added in post. Keep mouth in non-speaking state.`
      ),
    }));

    const isLastSegment = index === all.length - 1;

    return {
      ...segment,
      startFramePrompt: cleanText(
        segment.startFramePrompt ||
          "Opening frame: stylized 3D cartoon-like avatar grounded in an ultra-photoreal everyday location, normal world scale (not miniature), with a mostly static background and locked camera."
      ),
      script: {
        hook: segment.script?.hook || "",
        shots: normalizedShots,
        cta: isLastSegment
          ? closeOpenEndedLine(
            segment.script?.cta ||
              `If this feels too real, save this and check ${appName} for today's cycle + worship status.`
          )
          : closeOpenEndedLine(segment.script?.cta || ""),
      },
      multiShotPrompts: prompts,
    };
  });
}

function enforceDailyUgcQuranJourneyPattern(segments: MotionControlSegment[], appName: string): MotionControlSegment[] {
  const totalSegments = segments.length;
  const quranDeepDiveStartIndex = Math.max(1, totalSegments - 3);

  return segments.map((segment, index, all) => {
    const shots = [...(segment.script?.shots || [])];
    if (shots.length === 0) {
      shots.push({
        shotId: "shot1",
        visual: "Stylized 3D animated day-in-the-life shot in a warm home environment.",
        narration: "Bismillah. Let me share my day with you.",
        onScreenText: "Daily update",
        editNote: "Warm cinematic animation pacing with expressive but natural acting.",
      });
    }

    const firstShot = shots[0];
    const isOpening = index === 0;
    const isQuranDeepDive = index >= quranDeepDiveStartIndex;

    if (isOpening) {
      shots[0] = {
        ...firstShot,
        visual: cleanText(
          `${firstShot.visual} 3D animated cold-open with recurring character checking ${appName} and showing today's date, cycle day, and worship status card.`
        ),
        narration: closeOpenEndedLine(
          firstShot.narration ||
          "Today is [calendar date], it's my cycle day [X], and my worship status in the app is [status]."
        ),
        onScreenText:
          cleanText(firstShot.onScreenText) ||
          "Today: 28 March 2026 | Cycle day X | Worship status from app",
        editNote: cleanText(
          `${firstShot.editNote || ""} Begin as an animated episodic hook and show app UI close-ups for date, cycle phase, and worship status.`
        ),
      };

      const appOverlayShotIndex = Math.min(1, shots.length - 1);
      const appOverlayShot = shots[appOverlayShotIndex];
      shots[appOverlayShotIndex] = {
        ...appOverlayShot,
        onScreenText:
          cleanText(appOverlayShot.onScreenText) ||
          "Prayer and Quran status shown inside app before ibadah plans",
        editNote: cleanText(
          `${appOverlayShot.editNote || ""} Show app status while she explains her day plan in animated mentor style.`
        ),
      };
    } else if (isQuranDeepDive) {
      shots[0] = {
        ...firstShot,
        visual: cleanText(
          `${firstShot.visual} 3D animated teacher-to-camera setup in her room at night: character facing camera, warm desk-lamp glow, low-key soothing lighting, closed Quran on desk as prop.`
        ),
        narration: closeOpenEndedLine(
          firstShot.narration ||
          "Here is the deeper context of today's verses, with revelation background and key lessons."
        ),
        onScreenText:
          cleanText(firstShot.onScreenText) ||
          "Verse deep dive: revelation context, hadith links, and tafsir notes",
        editNote: cleanText(
          `${firstShot.editNote || ""} Keep character looking at camera like a teacher while explaining clearly and warmly.`
        ),
      };

      const lastShotIndex = shots.length - 1;
      const lastShot = shots[lastShotIndex];
      shots[lastShotIndex] = {
        ...lastShot,
        onScreenText:
          cleanText(lastShot.onScreenText) ||
          "Include: when revealed, related hadith, and one trusted scholar interpretation",
        editNote: cleanText(
          `${lastShot.editNote || ""} Finish with direct-to-camera teacher recap and gentle reflection prompt.`
        ),
      };
    } else {
      shots[0] = {
        ...firstShot,
        visual: cleanText(
          `${firstShot.visual} 3D animated daily-life continuation: chores, meals, or worship-check transition with playful but grounded realism.`
        ),
        editNote: cleanText(
          `${firstShot.editNote || ""} Keep it episodic, expressive, and coherent with practical worship check-ins.`
        ),
      };
    }

    const prompts = (segment.multiShotPrompts || []).map((promptItem, promptIndex) => {
      if (isOpening && promptIndex === 0) {
        return {
          ...promptItem,
          generationType: "base_ai_video" as const,
        };
      }

      if (isQuranDeepDive && promptItem.generationType !== "product_ui_overlay") {
        return {
          ...promptItem,
          generationType: "base_ai_video" as const,
        };
      }

      if (promptItem.generationType !== "product_ui_overlay") {
        return {
          ...promptItem,
          generationType: "base_ai_video" as const,
        };
      }

      return promptItem;
    });

    const isLastSegment = index === all.length - 1;

    return {
      ...segment,
      startFramePrompt: isOpening
        ? cleanText(
          segment.startFramePrompt ||
          `Stylized 3D animated opening frame: character checking ${appName} daily dashboard with date, cycle day, and worship status.`
        )
        : isQuranDeepDive
          ? cleanText(
            segment.startFramePrompt ||
            "3D animated teacher-to-camera Quran reflection frame in her room at night with warm desk-lamp glow, soft low-key soothing lighting, and a closed Quran prop on desk."
          )
          : cleanText(
            segment.startFramePrompt ||
            "Stylized 3D animated day-in-the-life frame with practical routine moment and subtle app check-in."
          ),
      script: {
        hook: segment.script?.hook || "",
        shots,
        cta: isLastSegment
          ? closeOpenEndedLine(
            segment.script?.cta ||
            "See you tomorrow, inshaAllah. Open the app for today's verse context, hadith links, and tafsir notes."
          )
          : closeOpenEndedLine(segment.script?.cta || ""),
      },
      multiShotPrompts: prompts,
    };
  });
}

function hasWorshipGestureCue(...values: unknown[]): boolean {
  const combined = values
    .map((value) => cleanText(typeof value === "string" ? value : ""))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!combined) return false;
  return /\b(dua|du'a|supplication|prayer|salah|salat|dhikr|adhkar|gratitude|shukr)\b/i.test(combined);
}

function buildVeo31SegmentPrompt(args: {
  segment: MotionControlSegment;
  nextSegment?: MotionControlSegment;
  styleHint: string;
  appName: string;
  ugcCharacter?: UGCCharacterProfile | null;
}): string {
  const { segment, styleHint, appName, ugcCharacter } = args;
  const isAnimatedStyle = /animated|animation|cgi/i.test(styleHint);
  const isUgcLikeStyle = /ugc|hybrid|vlog|social/i.test(styleHint);
  const durationSeconds = Math.max(2, Math.round(segment.durationSeconds || MAX_SINGLE_VIDEO_CLIP_SECONDS));
  const shots = segment.script?.shots || [];

  const resolvedShots = shots.length > 0
    ? shots
    : [
      {
        shotId: "shot1",
        visual: segment.startFramePrompt,
        narration: segment.script?.hook || "",
        onScreenText: "",
        editNote: "",
      },
    ];

  const shotDurationSeconds = Math.max(1, Math.round(durationSeconds / Math.max(1, resolvedShots.length)));
  const worshipPoseInstruction = hasWorshipGestureCue(
    segment.startFramePrompt,
    segment.script?.hook,
    segment.script?.cta,
    ...resolvedShots.map((shot) => `${shot.visual || ""} ${shot.narration || ""} ${shot.editNote || ""}`)
  )
    ? "If worship or gratitude gesture appears, use authentic Muslim dua posture: both hands open with palms facing upward near chest level, never clasped-hands or namaste-style gesture."
    : "";

  const voiceStyleInstruction = isAnimatedStyle
    ? "Speech delivery: clear and expressive, emotionally natural, no robotic cadence, medium pacing."
    : isUgcLikeStyle
      ? "Speech delivery: warm first-person day-in-the-life tone, conversational, medium pace, gentle pauses, clear diction."
      : "Speech delivery: calm, confident, natural, medium pacing with clear emphasis on key words.";

  const shotLines = resolvedShots
    .map((shot, index) => {
      const narration = closeOpenEndedLine(shot.narration);
      const dialogue = narration
        ? `Spoken line: "${narration.replace(/"/g, "'")}". ${voiceStyleInstruction}`
        : isAnimatedStyle
          ? "No spoken line. Performance relies on expressive but natural visual acting and subtle emotion transitions."
          : "No spoken line. Keep natural breathing rhythm and believable body language.";
      const editCue = cleanText(shot.editNote) ? `Performance note: ${closeOpenEndedLine(shot.editNote)}` : "";
      return `Shot ${index + 1} (${shotDurationSeconds}s): ${closeOpenEndedLine(shot.visual || segment.startFramePrompt)}. ${dialogue} ${editCue}`;
    })
    .join(" ");

  const characterLock = ugcCharacter
    ? `Character lock: ${ugcCharacter.characterName}. ${cleanText(ugcCharacter.promptTemplate)}.`
    : isAnimatedStyle
      ? "Character consistency: keep same animated character silhouette, face shape language, color palette, and costume continuity throughout this segment."
      : "Character consistency: keep same person identity, face geometry, and wardrobe continuity throughout this segment.";

  const scriptHook = closeOpenEndedLine(segment.script?.hook || "");
  const scriptCta = closeOpenEndedLine(segment.script?.cta || "");

  return cleanText(
    [
      `Veo 3.1 single prompt for segment ${segment.segmentId} (${segment.timecode}). Generate one continuous ${durationSeconds}-second vertical 9:16 ${styleHint} video clip.`,
      isAnimatedStyle
        ? "Quality target: high-end CGI animation look, stylized but premium 3D rendering, clean topology, stable shading, smooth deformation, expressive eyes and lips, coherent lighting, no uncanny artifacts, no texture flicker, no muddy frames."
        : "Quality target: photorealistic, true-to-life UGC realism, natural skin texture and pores, realistic fabric physics, authentic handheld smartphone camera behavior, physically plausible lighting, no waxy skin, no plastic look, no AI artifacts or uncanny facial motion.",
      `Environment continuity: keep location, camera axis, lens feel, and light direction stable across all shots in this segment.`,
      characterLock,
      `App integration: if app is referenced, show practical phone interaction with ${appName}, subtle and natural to the scene.`,
      `Do not render text overlays, captions, subtitles, logos, or watermarks in the generated video.`,
      worshipPoseInstruction,
      scriptHook ? `Segment hook intent: ${scriptHook}` : "",
      `Shot plan: ${shotLines}`,
      scriptCta ? `Segment close intent: ${scriptCta}` : "",
      `Audio mix: prioritize clear spoken voice and natural room tone; keep any background sound subtle and non-distracting.`,
    ].join(" ")
  );
}

function buildWidgetShockHookCompactVeoPrompt(args: {
  segment: MotionControlSegment;
  segmentIndex: number;
  appName: string;
}): string {
  const { segment, segmentIndex, appName } = args;
  const durationSeconds = Math.max(2, Math.round(segment.durationSeconds || MAX_SINGLE_VIDEO_CLIP_SECONDS));
  const shots = segment.script?.shots || [];

  if (segmentIndex === 0) {
    const titleOne = closeOpenEndedLine(cleanText(shots[0]?.onScreenText) || "Flo for Muslim women");
    const titleTwo = closeOpenEndedLine(
      cleanText(shots[1]?.onScreenText) || "No more period tracking app with haram contents"
    );

    return cleanText(
      [
        `Veo 3.1 prompt for segment ${segment.segmentId}. Generate one continuous ${durationSeconds}-second vertical 9:16 UGC reaction clip.`,
        "This first segment is hook-only. No spoken dialogue, no app explanation, no lip-sync.",
        `0-4 seconds: shocked facial reaction only with subtle hand movement. Overlay reference for post edit: "${titleOne}".`,
        `4-8 seconds: continue shocked-to-relieved reaction in same framing. Overlay reference for post edit: "${titleTwo}".`,
        "Keep camera mostly static selfie framing, natural home realism, and consistent lighting.",
        `Do not render text overlays, captions, subtitles, logos, or watermarks in the generated video.`,
      ].join(" ")
    );
  }

  const spokenLines = shots
    .map((shot) => closeOpenEndedLine(shot.narration || ""))
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  const visualFocus = closeOpenEndedLine(cleanText(shots[0]?.visual) || segment.startFramePrompt);

  return cleanText(
    [
      `Veo 3.1 prompt for segment ${segment.segmentId}. Generate one continuous ${durationSeconds}-second vertical 9:16 UGC clip.`,
      `From this segment onward, character talks about ${appName} as a halal alternative for Muslim women (period + pregnancy tracking without haram content).`,
      `Visual focus: ${visualFocus}`,
      spokenLines ? `Spoken lines: ${spokenLines}` : "Spoken line: quick app explanation with excited relief tone.",
      "Include quick app showcase beats (widget + one app dashboard glance) while keeping pacing concise.",
      "Natural UGC realism, clear facial performance, clean audio focus.",
      `Do not render text overlays, captions, subtitles, logos, or watermarks in the generated video.`,
    ].join(" ")
  );
}

function buildWidgetLatePeriodReactionHookVeoPrompt(args: {
  segment: MotionControlSegment;
}): string {
  const { segment } = args;
  const durationSeconds = Math.max(2, Math.round(segment.durationSeconds || MAX_SINGLE_VIDEO_CLIP_SECONDS));
  const shots = segment.script?.shots || [];
  const hookTextOne = closeOpenEndedLine(cleanText(shots[0]?.onScreenText) || "is everyone's period late in march?");
  const hookTextTwo = closeOpenEndedLine(
    cleanText(shots[1]?.onScreenText) ||
    "raise your hand if it's march and your period still hasn't shown up"
  );

  return cleanText(
    [
      `Veo 3.1 prompt for segment ${segment.segmentId}. Generate one continuous ${durationSeconds}-second vertical 9:16 UGC reaction clip.`,
      "No spoken dialogue. No app explanation. No lip-sync.",
      "Core performance: medium close-up of a young woman indoors, thinking pose, then gentle head shake with slight disappointment. Keep it light and relatable.",
      `0-4 seconds: simple thinking pose + gentle head shake start. Overlay reference for post edit: \"${hookTextOne}\".`,
      `4-8 seconds: continue same framing with another gentle head shake and slight disappointed expression. Overlay reference for post edit: \"${hookTextTwo}\".`,
      "Natural smartphone UGC realism, stable indoor lighting, believable micro-expressions.",
      "Do not render text overlays, captions, subtitles, logos, or watermarks in generated video.",
    ].join(" ")
  );
}

function buildMixedMediaRelatablePovVeoPrompt(args: {
  segment: MotionControlSegment;
  nextSegment?: MotionControlSegment;
  appName: string;
  ugcCharacter?: UGCCharacterProfile | null;
}): string {
  const { segment, nextSegment, appName, ugcCharacter } = args;

  const basePrompt = buildVeo31SegmentPrompt({
    segment,
    nextSegment,
    styleHint: "mixed-media stylized 3D avatar in photoreal real-world environments",
    appName,
    ugcCharacter,
  });

  const overlayRefs = (segment.script?.shots || [])
    .map((shot, index) => {
      const text = cleanText(shot.onScreenText);
      if (!text) return "";
      return `Shot ${index + 1} overlay reference for edit: "${text.replace(/"/g, "'")}".`;
    })
    .filter(Boolean)
    .join(" ");

  return cleanText(
    `${basePrompt} No spoken dialogue, no voiceover, and no lip-sync in any shot. This is a silent meme-style video driven by expressive acting. Mixed-media directive: keep one recurring stylized chibi-like 3D female avatar composited into real-world photoreal backgrounds. Scale lock: avatar is normal world scale (not miniature/toy-sized); use wider framing to keep her less dominant in frame. Match lighting temperature, shadow direction, floor contact, camera perspective, and lens depth so the avatar feels grounded. Action lock: every shot must include a clear physical action beat (walk, pause, turn, sit, phone check, shrug, head tilt, reaction pose) with mouth relaxed/closed and zero speech articulation. Performance style: funny, engaging POV micro-drama with slightly exaggerated reactions. Do not render text overlays in generation; overlays are added in edit as lowercase white rounded labels with subtle shadow. ${overlayRefs}`
  );
}

function buildStaticPhotorealAvatarMemeVeoPrompt(args: {
  segment: MotionControlSegment;
  nextSegment?: MotionControlSegment;
  appName: string;
  ugcCharacter?: UGCCharacterProfile | null;
}): string {
  const { segment, nextSegment, appName, ugcCharacter } = args;

  const basePrompt = buildVeo31SegmentPrompt({
    segment,
    nextSegment,
    styleHint: "animated stylized 3D cartoon-like avatar composited into ultra-photoreal mostly-static environments",
    appName,
    ugcCharacter,
  });

  const overlayRefs = (segment.script?.shots || [])
    .map((shot, index) => {
      const text = cleanText(shot.onScreenText);
      if (!text) return "";
      return `Shot ${index + 1} overlay reference for edit: "${text.replace(/"/g, "'")}".`;
    })
    .filter(Boolean)
    .join(" ");

  return cleanText(
    `${basePrompt} No spoken dialogue, no voiceover, and no lip-sync in any shot. Keep one recurring stylized 3D cartoon-like female avatar. Scale lock: avatar is normal world scale (not miniature/toy-sized), while framing stays wide enough that she appears less dominant in the frame. Background and environment must feel ultra-photoreal with mostly static composition, locked-off camera, and only subtle natural movement. Match avatar lighting, floor contact shadows, and perspective to the real scene. Action lock: every shot must show a clear body action beat (entering, walking, turning, sitting, checking phone, hand gesture, reaction pose) and keep mouth relaxed/closed with no speech phoneme motion. Performance style: funny, engaging, meme-like micro-drama with expressive reactions. Do not render text overlays in generation; text overlays are added during editing. ${overlayRefs}`
  );
}

function ensureVeoPromptQuality(prompt: string, fallback: string, styleHint: string): string {
  const cleaned = cleanText(prompt);
  if (!cleaned) return fallback;

  const hasShotStructure = /\bshot\s*1\b/i.test(cleaned);
  const isAnimatedStyle = /animated|animation|cgi/i.test(styleHint);
  const hasStyleCue = isAnimatedStyle
    ? /\b(animated|animation|cgi|stylized|3d|render|shading|deformation)\b/i.test(cleaned)
    : /\b(photoreal|realistic|natural skin|micro-expression|handheld|no ai artifacts|no uncanny)\b/i.test(cleaned);

  if (!hasShotStructure || !hasStyleCue) {
    return fallback;
  }

  return cleaned;
}

function parseClockToSeconds(value: string): number | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;

  const parts = cleaned.split(":").map((token) => Number(token));
  if (parts.some((part) => Number.isNaN(part))) return null;

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

function parseTimecodeRange(timecode: string): { start: number; end: number } | null {
  const cleaned = cleanText(timecode);
  if (!cleaned) return null;
  const [startRaw, endRaw] = cleaned.split("-").map((token) => token.trim());
  const start = startRaw ? parseClockToSeconds(startRaw) : null;
  const end = endRaw ? parseClockToSeconds(endRaw) : null;

  if (typeof start !== "number") return null;
  if (typeof end === "number" && end > start) {
    return { start, end };
  }

  return { start, end: start + 4 };
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function splitBeatsIntoShotGroups(args: {
  beats: PlanBeat[];
  totalDurationSeconds: number;
  maxSegmentSeconds: number;
  hook: string;
  cta: string;
}): MotionControlSegment[] {
  const { beats, totalDurationSeconds, maxSegmentSeconds, hook, cta } = args;
  const safeTotal = Math.max(maxSegmentSeconds, Math.round(totalDurationSeconds));
  const segmentCount = Math.max(1, Math.ceil(safeTotal / maxSegmentSeconds));
  const beatChunkSize = Math.max(1, Math.ceil(Math.max(1, beats.length) / segmentCount));

  return Array.from({ length: segmentCount }, (_, index): MotionControlSegment => {
    const start = index * maxSegmentSeconds;
    const end = Math.min(safeTotal, start + maxSegmentSeconds);

    const rangedBeats = beats.filter((beat) => {
      const range = parseTimecodeRange(beat.timecode);
      if (!range) return false;
      return range.start >= start && range.start < end;
    });

    const chunkStart = index * beatChunkSize;
    const chunkEnd = chunkStart + beatChunkSize;
    const fallbackChunk = beats.slice(chunkStart, chunkEnd);
    const segmentBeats = rangedBeats.length > 0 ? rangedBeats : fallbackChunk;
    const leadBeat = segmentBeats[0] || beats[0];

    return {
      segmentId: index + 1,
      timecode: `${formatClock(start)}-${formatClock(end)}`,
      durationSeconds: Math.max(1, end - start),
      startFramePrompt: cleanText(
        leadBeat?.visual || leadBeat?.onScreenText || leadBeat?.narration || `Open shot for segment ${index + 1}.`
      ),
      script: {
        hook: index === 0 ? cleanText(hook) : "",
        shots: planBeatsToSegmentShots(segmentBeats),
        cta: index === segmentCount - 1 ? cleanText(cta) : "",
      },
    };
  });
}

function normalizeBeatsToTargetDuration(args: {
  beats: PlanBeat[];
  targetDurationSeconds: number;
  minBeatCount: number;
  hook: string;
}): PlanBeat[] {
  const { beats, targetDurationSeconds, minBeatCount, hook } = args;
  const safeDuration = Math.max(MAX_SINGLE_VIDEO_CLIP_SECONDS, Math.round(targetDurationSeconds));
  const safeMinBeats = Math.max(1, minBeatCount);

  const seedBeats = beats.length > 0
    ? [...beats]
    : [{
      timecode: "0:00-0:04",
      visual: cleanText(hook) || "Open with the source style hook scene.",
      narration: cleanText(hook),
      onScreenText: cleanText(hook),
      editNote: "",
    }];

  const expanded: PlanBeat[] = [...seedBeats];
  while (expanded.length < safeMinBeats) {
    const base = seedBeats[expanded.length % seedBeats.length];
    expanded.push({
      ...base,
      editNote: cleanText(`${base.editNote || ""} Continue this progression naturally.`),
    });
  }

  const totalBeats = expanded.length;
  const step = safeDuration / totalBeats;

  return expanded.map((beat, index) => {
    const start = Math.max(0, Math.round(index * step));
    const nextRaw = index === totalBeats - 1 ? safeDuration : Math.round((index + 1) * step);
    const end = Math.max(start + 1, nextRaw);
    return {
      ...beat,
      timecode: `${formatClock(start)}-${formatClock(end)}`,
    };
  });
}

function sanitizeMultiShotPrompts(value: unknown, max = 8): MultiShotPrompt[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((item, index): MultiShotPrompt | null => {
      if (!isRecord(item)) return null;
      const generationType = sanitizeHiggsfieldGenerationType(item.generationType);
      const scene = sanitizeString(item.scene, `Segment scene ${index + 1}`);
      const basePrompt = sanitizeString(
        item.prompt,
        "Create a high-retention vertical 9:16 scene with natural motion continuity, realistic textures, clean lighting, and faithful emotional tone from the script."
      );
      const withPerformance = ensureHiggsfieldPromptHasPerformanceInstruction(
        stripPromptMetaTags(basePrompt)
      );
      const withScreenCue = needsAppScreenReplacementCue(generationType, scene, withPerformance)
        ? ensureAppScreenReplacementDirective(withPerformance)
        : withPerformance;

      return {
        shotId: sanitizeKlingShotId(item.shotId, index),
        generationType,
        scene,
        prompt: enforceKlingPromptWordLimit(withScreenCue, 77),
        shotDuration: sanitizeString(item.shotDuration, "4s"),
      };
    })
    .filter((item): item is MultiShotPrompt => Boolean(item))
    .slice(0, max);
}

function buildFallbackMultiShotPrompts(segment: MotionControlSegment, segmentIndex: number): MultiShotPrompt[] {
  const shots = segment.script?.shots || [];
  const source = shots.length > 0 ? shots : [
    {
      shotId: "shot1",
      visual: segment.startFramePrompt,
      narration: segment.script?.hook || "",
      onScreenText: "",
      editNote: "",
    },
  ];

  const perShotDuration = Math.max(2, Math.round(segment.durationSeconds / Math.max(1, source.length)));
  const prompts = source.slice(0, 6).map((shot: SegmentScriptShot, shotIndex): MultiShotPrompt => {
    const duration = perShotDuration;
    const scene = cleanText(shot.visual) || `Segment ${segment.segmentId} scene ${shotIndex + 1}`;
    const prompt = cleanText(
      [
        scene,
        shot.narration ? `Narration intent: ${shot.narration}.` : "",
        shot.onScreenText ? `On-screen text direction: ${shot.onScreenText}.` : "",
        "Vertical 9:16, cinematic but natural realism, smooth temporal continuity, clean transitions, no visual artifacts.",
      ].join(" ")
    );

    return {
      shotId: `group${segmentIndex + 1}_shot${shotIndex + 1}`,
      generationType: "ai_broll",
      scene,
      prompt: enforceKlingPromptWordLimit(ensureHiggsfieldPromptHasPerformanceInstruction(prompt), 77),
      shotDuration: `${duration}s`,
    };
  });

  return prompts.length > 0 ? prompts : [
    {
      shotId: `group${segmentIndex + 1}_shot1`,
      generationType: "ai_broll",
      scene: `Segment ${segment.segmentId} opening scene`,
      prompt: enforceKlingPromptWordLimit(
        ensureHiggsfieldPromptHasPerformanceInstruction(
          `${segment.startFramePrompt}. Vertical 9:16, realistic motion, coherent lighting, no artifacts.`
        ),
        77
      ),
      shotDuration: `${Math.max(3, Math.min(6, segment.durationSeconds))}s`,
    },
  ];
}

function truncateToWordLimit(text: string, maxWords: number): string {
  const cleaned = cleanText(text);
  if (!cleaned) return "";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return cleaned;
  return words.slice(0, maxWords).join(" ").trim();
}

function enforceKlingPromptWordLimit(prompt: string, maxWords = 77): string {
  return truncateToWordLimit(prompt, maxWords);
}

function ensureHiggsfieldPromptHasPerformanceInstruction(prompt: string): string {
  const normalized = cleanText(prompt);
  if (!normalized) {
    return "Create a vertical 9:16 AI influencer shot with realistic movement. No dialogue: character expresses the emotion silently through facial expression and body language.";
  }

  const hasPerformanceCue =
    /\bdialogue\b/i.test(normalized) ||
    /\bno dialogue\b/i.test(normalized) ||
    /\bsilent\b/i.test(normalized) ||
    /\bvoiceover\b/i.test(normalized) ||
    /\bsays\b/i.test(normalized) ||
    /\bspeaks\b/i.test(normalized) ||
    /"[^"]+"/.test(normalized);

  if (hasPerformanceCue) {
    return normalized;
  }

  return `${normalized} No dialogue: character expresses the intended emotion and intent silently.`;
}

function stripPromptMetaTags(prompt: string): string {
  const cleaned = prompt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      return !/^(model|recommendedmodel|duration|shotduration|why|reason)\s*:/i.test(line);
    })
    .join(" ")
    .trim();

  return cleaned;
}

function sourceDurationHint(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "unknown";
  }

  const rounded = Math.round(seconds);
  return `${rounded}s`;
}

function sourceMatchedDurationFallback(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "45-60 seconds";
  }

  const base = Math.max(10, Math.round(seconds));
  const min = Math.max(8, Math.round(base * 0.9));
  const max = Math.max(min + 2, Math.round(base * 1.1));
  return `${min}-${max} seconds (match source around ${base}s)`;
}

function sanitizeHiggsfieldGenerationType(value: unknown): MultiShotPrompt["generationType"] {
  const cleaned = sanitizeString(value, "").toLowerCase();
  if (cleaned === "base_ai_video") return "base_ai_video";
  if (cleaned === "ugc_video") return "ugc_video";
  if (cleaned === "ai_broll") return "ai_broll";
  if (cleaned === "product_ui_overlay") return "product_ui_overlay";
  if (cleaned === "transition_fx") return "transition_fx";
  return "ai_broll";
}

function sanitizeKlingShotId(value: unknown, fallbackIndex: number): string {
  const cleaned = sanitizeString(value, "").toLowerCase();
  if (/^shot\s*\d+$/.test(cleaned)) {
    return cleaned.replace(/\s+/g, "");
  }

  const numeric = cleaned.match(/\d+/)?.[0];
  if (numeric) return `shot${numeric}`;

  return `shot${fallbackIndex + 1}`;
}

function buildFinalCutProFallbackSteps(sourceDurationSeconds: number | null | undefined): string[] {
  const targetDuration = sourceMatchedDurationFallback(sourceDurationSeconds);
  return [
    "Create a new Final Cut Pro library and event; set project to vertical 1080x1920, 30fps, Rec.709 color space.",
    `Set project duration target to ${targetDuration} and create primary timeline markers for hook, body beats, and CTA.`,
    "Import all generated multi-shot clips, app screen recordings, source overlays, SFX, and music into organized keyword collections.",
    "Build the rough cut on the primary storyline following script timecodes; trim clips on motion/action to keep retention pacing.",
    "Place UGC/talking-head shots on primary storyline and keep framing continuity between adjacent cuts.",
    "Add AI B-roll and cutaway layers above primary clips (connected clips) to visually support each narration beat.",
    "Insert app UI overlays and screen-recording callouts using transform/opacity keyframes for subtle integrations.",
    "Add on-screen text titles matching hook and beat copy; enforce safe margins and consistent type scale hierarchy.",
    "Apply speed ramps and transitions only where necessary for rhythm (avoid overuse); keep most cuts clean and direct.",
    "Run primary color correction (white balance, exposure, contrast), then secondary skin tone balancing for human shots.",
    "Mix audio: dialogue/VO at consistent LUFS target, duck music under speech, and add light ambience/SFX for realism.",
    "Add captions/subtitles, proofread every line, and ensure subtitle timing aligns to spoken phrases.",
    "Perform QA pass for pacing, visual continuity, faith-positive framing, and accurate app overlay timing.",
    "Export H.264 master (vertical, high quality), then render platform-ready upload version and verify playback on mobile.",
  ];
}

function needsAppScreenReplacementCue(
  generationType: MultiShotPrompt["generationType"],
  scene: string,
  prompt: string
): boolean {
  if (generationType === "product_ui_overlay") return true;
  const combined = `${scene} ${prompt}`.toLowerCase();
  return /\b(app|ui|screen|phone screen|mobile screen|dashboard|tap|swipe|onscreen app|screen recording)\b/i.test(
    combined
  );
}

function ensureAppScreenReplacementDirective(prompt: string): string {
  const cleaned = cleanText(prompt);
  if (!cleaned) return cleaned;

  const hasChromaCue = /\b(chroma|green\s*screen|#00ff00|keyable|for\s+replacement)\b/i.test(cleaned);
  const hasStaticCameraCue =
    /\b(static|locked\s*-?\s*off|tripod|no\s+camera\s+movement|no\s+pan|no\s+tilt|no\s+zoom|no\s+dolly|handheld)\b/i.test(
      cleaned
    );

  if (hasChromaCue && hasStaticCameraCue) {
    return cleaned;
  }

  const directives: string[] = [];

  if (!hasChromaCue) {
    directives.push("Phone screen pure chroma green (#00FF00), no UI/text, minimal glare for replacement.");
  }

  if (!hasStaticCameraCue) {
    directives.push(
      "Static locked-off camera, tripod framing, no pan/tilt/zoom/dolly/handheld movement for clean post screen replacement."
    );
  }

  return `${directives.join(" ")} ${cleaned}`.trim();
}

function toCharacterLockToken(characterName: string): string {
  const cleaned = characterName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return cleaned || "character";
}

function promptNeedsCharacterLock(prompt: string, generationType: MultiShotPrompt["generationType"]): boolean {
  if (generationType === "ugc_video" || generationType === "base_ai_video") return true;
  return /\b(woman|female|girl|lady|muslimah|hijab|she|her|talking[-\s]?head|portrait|face|creator|influencer)\b/i.test(
    prompt
  );
}

function applyUgcCharacterLock(prompt: string, character: UGCCharacterProfile): string {
  const cleanedPrompt = cleanText(prompt);
  const lockLine = `Character Lock: $${toCharacterLockToken(character.characterName)}.`;

  const strippedExistingLock = cleanText(
    cleanedPrompt.replace(/character\s*lock\s*:[^.;\n]+[.;]?/gi, " ")
  );

  if (!strippedExistingLock) {
    return `${lockLine} No dialogue: character expresses calm confidence with natural eye contact.`;
  }

  return `${lockLine} ${strippedExistingLock}`;
}

function toFormatSignature(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");

  if (!normalized) {
    return "hybrid_social_format";
  }

  return normalized.split("_").slice(0, 6).join("_");
}

function normalizeFormatType(value: unknown): NormalizedFormatType {
  if (typeof value !== "string") return "hybrid";

  const cleaned = value.trim().toLowerCase();
  if (cleaned === "ugc") return "ugc";
  if (cleaned === "ai_video" || cleaned === "aivideo" || cleaned === "ai-generated") return "ai_video";
  if (cleaned === "editorial") return "editorial";
  return "hybrid";
}

function sanitizeScriptAgentVideoType(value: unknown): ScriptAgentVideoType {
  if (typeof value !== "string") return "hybrid";
  const cleaned = value.trim().toLowerCase();
  if (cleaned === "ugc") return "ugc";
  if (cleaned === "ai_animation" || cleaned === "animation" || cleaned === "ai-animation") return "ai_animation";
  if (cleaned === "faceless_broll" || cleaned === "faceless" || cleaned === "broll" || cleaned === "b-roll") {
    return "faceless_broll";
  }
  return "hybrid";
}

function sanitizeScriptAgentTopicCategory(value: unknown): ScriptAgentTopicCategory {
  if (typeof value !== "string") return "period_pregnancy";
  const cleaned = value.trim().toLowerCase();
  if (cleaned === "islamic_period_pregnancy" || cleaned === "islamic+period_pregnancy") {
    return "islamic_period_pregnancy";
  }
  return "period_pregnancy";
}

function sanitizeScriptAgentCampaignMode(value: unknown): ScriptAgentCampaignMode {
  if (typeof value !== "string") return "standard";
  const cleaned = value.trim().toLowerCase();
  if (cleaned === "widget_reaction_ugc" || cleaned === "widget-reaction-ugc") {
    return "widget_reaction_ugc";
  }
  if (
    cleaned === "widget_shock_hook_ugc" ||
    cleaned === "widget-shock-hook-ugc" ||
    cleaned === "shock_widget_reaction_ugc" ||
    cleaned === "shock-widget-reaction-ugc"
  ) {
    return "widget_shock_hook_ugc";
  }
  if (
    cleaned === "widget_late_period_reaction_hook_ugc" ||
    cleaned === "widget-late-period-reaction-hook-ugc" ||
    cleaned === "late_period_reaction_hook_ugc" ||
    cleaned === "late-period-reaction-hook-ugc" ||
    cleaned === "late_period_reaction_ugc" ||
    cleaned === "late-period-reaction-ugc"
  ) {
    return "widget_late_period_reaction_hook_ugc";
  }
  if (
    cleaned === "ai_objects_educational_explainer" ||
    cleaned === "ai-objects-educational-explainer" ||
    cleaned === "ai_objects_explainer" ||
    cleaned === "ai-objects-explainer" ||
    cleaned === "cute_ai_objects_explainer" ||
    cleaned === "cute-ai-objects-explainer"
  ) {
    return "ai_objects_educational_explainer";
  }
  if (
    cleaned === "mixed_media_relatable_pov" ||
    cleaned === "mixed-media-relatable-pov" ||
    cleaned === "mixed_media_pov" ||
    cleaned === "mixed-media-pov" ||
    cleaned === "mixed_media_relatable" ||
    cleaned === "mixed-media-relatable"
  ) {
    return "mixed_media_relatable_pov";
  }
  if (
    cleaned === "static_photoreal_avatar_meme" ||
    cleaned === "static-photoreal-avatar-meme" ||
    cleaned === "photoreal_background_avatar_meme" ||
    cleaned === "photoreal-background-avatar-meme" ||
    cleaned === "static_chibi_meme" ||
    cleaned === "static-chibi-meme"
  ) {
    return "static_photoreal_avatar_meme";
  }
  if (
    cleaned === "daily_ugc_quran_journey" ||
    cleaned === "daily-ugc-quran-journey" ||
    cleaned === "daily_ugc_quran" ||
    cleaned === "daily-ugc-quran"
  ) {
    return "daily_ugc_quran_journey";
  }
  return "standard";
}

function parseJsonFromModel(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;

    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function limitAppNameMentions(text: string, appName: string, state: { count: number }): string {
  const normalizedAppName = cleanText(appName);
  if (!normalizedAppName) return text;

  const pattern = new RegExp(escapeRegExp(normalizedAppName), "gi");

  return text.replace(pattern, (match) => {
    state.count += 1;
    return state.count <= 1 ? match : "your tracker";
  });
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function extractMetaContent(html: string, key: string): string | null {
  const escapedKey = escapeRegExp(key);

  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapedKey}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match || !match[1]) continue;
    const value = decodeHtmlEntities(match[1]).trim();
    if (value) return value;
  }

  return null;
}

async function buildVisualEvidence(source: VideoSourceMetadata, collectionId?: string): Promise<{
  method: AnalysisMethod;
  sourceDurationSeconds: number | null;
  parts: InlineImagePart[];
  sampledFrameSources: string[];
  directMediaUrl: string | null;
  r2VideoUrl: string | null;
  transcript: {
    available: boolean;
    summary: string | null;
    fullText: string | null;
    highlights: string[];
  };
}> {
  if (source.platform !== "instagram" && source.platform !== "tiktok") {
    throw new Error(
      `Strict frame-aware analysis is currently supported only for Instagram/TikTok links. Received platform: ${source.platform}`
    );
  }

  const sessionId = randomUUID().slice(0, 8);
  const frameExtraction = await extractVideoFrames(source.url, source.platform, {
    sessionId,
    frameWidth: 960,
    includeTranscript: true,
    collectionId,
  });

  const frameParts = frameExtraction.frames
    .filter((frame) => typeof frame.data === "string" && frame.data.length > 0)
    .map((frame) => ({
      inlineData: {
        data: frame.data,
        mimeType: frame.mimeType || "image/jpeg",
      },
    }));

  if (frameParts.length === 0) {
    throw new Error(
      "No frames were extracted by remote extractor. Strict frame-aware analysis requires at least one sampled frame."
    );
  }

  const transcriptHighlights = frameExtraction.transcript.segments
    .map((segment) => cleanText(segment.text))
    .filter(Boolean)
    .slice(0, 8);

  return {
    method: "frame_aware",
    sourceDurationSeconds:
      typeof frameExtraction.durationSeconds === "number" && Number.isFinite(frameExtraction.durationSeconds)
        ? frameExtraction.durationSeconds
        : null,
    parts: frameParts,
    sampledFrameSources: ["remote_extractor_frames"],
    directMediaUrl: frameExtraction.videoUrl,
    r2VideoUrl: frameExtraction.r2VideoUrl || null,
    transcript: {
      available: frameExtraction.transcript.available,
      summary: frameExtraction.transcript.summary,
      fullText: frameExtraction.transcript.fullText,
      highlights: transcriptHighlights,
    },
  };
}

function inferVideoContentCategoryFallback(sourceVideo: BuildRecreationPlanArgs["sourceVideo"]): VideoContentCategory {
  const text = cleanText(
    [
      sourceVideo.title,
      sourceVideo.description,
      sourceVideo.userNotes,
      sourceVideo.transcriptSummary,
      sourceVideo.transcriptText,
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();

  const hasIslamicSignal = /(allah|dua|quran|hadith|salah|islam|islamic|deen|ramadan|hijab|muslim)/i.test(text);
  const hasPeriodPregnancySignal =
    /(period|menstrual|cycle|ovulation|pms|pcos|pregnan|fertility|postpartum|trimester|breastfeed|conception)/i.test(text);

  if (hasIslamicSignal && hasPeriodPregnancySignal) return "islamic_period_pregnancy";
  if (hasIslamicSignal) return "islamic_only";
  return "period_pregnancy_only";
}

async function classifyVideoContentCategory(args: {
  model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;
  sourceVideo: BuildRecreationPlanArgs["sourceVideo"];
  appName: string;
  appContext: string;
}): Promise<VideoContentClassification> {
  const { model, sourceVideo, appName, appContext } = args;

  const prompt = `You are a strict content classifier for short-form video rewriting.

Classify the source video into exactly ONE category:
- islamic_only
- islamic_period_pregnancy
- period_pregnancy_only

APP CONTEXT:
- App Name: ${appName}
- App Context: ${appContext || "N/A"}

SOURCE VIDEO:
- Title: ${sourceVideo.title || "N/A"}
- Description: ${sourceVideo.description || "N/A"}
- User Notes: ${sourceVideo.userNotes || "N/A"}
- Transcript Summary: ${sourceVideo.transcriptSummary || "N/A"}
- Transcript Text: ${(sourceVideo.transcriptText || "N/A").slice(0, 8000)}

Classification guide:
- islamic_only: Islamic/spiritual framing is central, but period/pregnancy topic is absent.
- islamic_period_pregnancy: Islamic/spiritual framing and period/pregnancy are both clearly present.
- period_pregnancy_only: Period/pregnancy is central and Islamic framing is absent or minor.

Return strict JSON only:
{
  "category": "islamic_only|islamic_period_pregnancy|period_pregnancy_only",
  "confidence": 0.0,
  "reason": "short reason"
}`;

  try {
    const result = await model.generateContent(prompt);
    const parsed = parseJsonFromModel(result.response.text());
    const row = isRecord(parsed) ? parsed : {};

    const categoryRaw = sanitizeString(row.category, "").toLowerCase();
    const category: VideoContentCategory =
      categoryRaw === "islamic_only" ||
      categoryRaw === "islamic_period_pregnancy" ||
      categoryRaw === "period_pregnancy_only"
        ? categoryRaw
        : inferVideoContentCategoryFallback(sourceVideo);

    return {
      category,
      confidence: clamp(sanitizeNumber(row.confidence, 0.6), 0, 1),
      reason: sanitizeString(row.reason, "Category inferred from source transcript and metadata."),
    };
  } catch {
    const fallback = inferVideoContentCategoryFallback(sourceVideo);
    return {
      category: fallback,
      confidence: 0.55,
      reason: "Fallback classification from source metadata and transcript keywords.",
    };
  }
}

export async function fetchVideoSourceMetadata(url: string): Promise<VideoSourceMetadata> {
  const platform = extractPlatform(url);
  let title: string | null = null;
  let description: string | null = null;
  let thumbnailUrl: string | null = null;

  try {
    const response = await fetchWithProxy(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      redirect: "follow",
    });

    if (response.ok) {
      const html = await response.text();

      title =
        extractMetaContent(html, "og:title") ||
        extractMetaContent(html, "twitter:title") ||
        (() => {
          const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
          return titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : null;
        })();

      description =
        extractMetaContent(html, "og:description") ||
        extractMetaContent(html, "twitter:description") ||
        extractMetaContent(html, "description");

      thumbnailUrl =
        extractMetaContent(html, "og:image") ||
        extractMetaContent(html, "twitter:image") ||
        null;
    }
  } catch {
    // Metadata fallback is acceptable. We'll continue with URL + platform only.
  }

  return {
    url,
    platform,
    title,
    description,
    thumbnailUrl,
  };
}

export async function analyzeVideoFormatFromSource(
  source: VideoSourceMetadata,
  reasoningModel: ReasoningModel = DEFAULT_REASONING_MODEL,
  collectionId?: string
): Promise<VideoFormatAnalysis> {
  requireGeminiKey();
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const visualEvidence = await buildVisualEvidence(source, collectionId);

  const prompt = `You are a short-form video format analyst.

Task:
Classify this source video into a reusable format template that can be reused for future videos.

SOURCE VIDEO:
- URL: ${source.url}
- Platform: ${source.platform}
- Title: ${source.title || "N/A"}
- Description: ${source.description || "N/A"}
- User Notes: ${source.userNotes || "N/A"}

VISUAL EVIDENCE:
- analysisMethod: ${visualEvidence.method}
- sampledFramesAttached: ${visualEvidence.parts.length}
- sampledFrameSources: ${visualEvidence.sampledFrameSources.join(", ") || "none"}
- directMediaUrl: ${visualEvidence.directMediaUrl || "N/A"}

TRANSCRIPT EVIDENCE:
- transcriptAvailable: ${visualEvidence.transcript.available ? "yes" : "no"}
- transcriptSummary: ${visualEvidence.transcript.summary || "N/A"}
- transcriptHighlights: ${visualEvidence.transcript.highlights.join(" | ") || "N/A"}
- transcriptFullText: ${visualEvidence.transcript.fullText || "N/A"}

OUTPUT RULES:
- Return strict JSON only.
- formatType must be one of: ugc, ai_video, hybrid, editorial.
- formatSignature must be stable across similar videos, lowercase snake_case, 3-6 words.
- Focus on structure and repeatable production system (hook type, shot style, edit rhythm), not topic specifics.
- Extract visible text overlays from attached frames when possible.
- If transcript is available, use it heavily for hook language patterns and messaging structure.

JSON SHAPE:
{
  "formatName": "string",
  "formatType": "ugc|ai_video|hybrid|editorial",
  "formatSignature": "string",
  "transcriptHighlights": ["string"],
  "visualSignals": ["string"],
  "onScreenTextPatterns": ["string"],
  "summary": "string",
  "whyItWorks": ["string"],
  "hookPatterns": ["string"],
  "shotPattern": ["string"],
  "editingStyle": ["string"],
  "scriptScaffold": "string",
  "higgsfieldPromptTemplate": "string",
  "recreationChecklist": ["string"],
  "durationGuidance": "string",
  "confidence": 0.0
}`;

  const payload = [{ text: prompt }, ...visualEvidence.parts] as Array<
    { text: string } | InlineImagePart
  >;

  const result = await model.generateContent(payload);
  const parsed = parseJsonFromModel(result.response.text());
  const row = isRecord(parsed) ? parsed : {};

  const formatName = sanitizeString(row.formatName, "Short-form social format");
  const formatType = normalizeFormatType(row.formatType);
  const rawSignature = sanitizeString(row.formatSignature, "");
  const formatSignature = toFormatSignature(rawSignature || `${formatType}_${formatName}`);

  return {
    formatName,
    formatType,
    formatSignature,
    analysisMethod: visualEvidence.method,
    sourceDurationSeconds: visualEvidence.sourceDurationSeconds,
    sampledFrameCount: visualEvidence.parts.length,
    sampledFrameSources: visualEvidence.sampledFrameSources,
    directMediaUrl: visualEvidence.directMediaUrl,
    r2VideoUrl: visualEvidence.r2VideoUrl,
    transcriptAvailable: visualEvidence.transcript.available,
    transcriptSummary: sanitizeString(
      visualEvidence.transcript.summary,
      visualEvidence.transcript.available ? "Transcript extracted from source video." : ""
    ),
    transcriptText: sanitizeString(visualEvidence.transcript.fullText, ""),
    transcriptHighlights: sanitizeStringArray(
      row.transcriptHighlights,
      10
    ).length
      ? sanitizeStringArray(row.transcriptHighlights, 10)
      : visualEvidence.transcript.highlights,
    visualSignals: sanitizeStringArray(row.visualSignals, 8),
    onScreenTextPatterns: sanitizeStringArray(row.onScreenTextPatterns, 10),
    summary: sanitizeString(row.summary, "Reusable short-form structure with a strong hook and clear CTA."),
    whyItWorks: sanitizeStringArray(row.whyItWorks, 6),
    hookPatterns: sanitizeStringArray(row.hookPatterns, 6),
    shotPattern: sanitizeStringArray(row.shotPattern, 10),
    editingStyle: sanitizeStringArray(row.editingStyle, 8),
    scriptScaffold: sanitizeString(
      row.scriptScaffold,
      "Hook (0-3s) -> Value beats (3-18s) -> CTA (18-25s). Keep narration direct and emotionally grounded."
    ),
    higgsfieldPromptTemplate: sanitizeString(
      row.higgsfieldPromptTemplate,
      "Create a cinematic 9:16 vertical short with soft natural lighting, clean composition, and realistic movement."
    ),
    recreationChecklist: sanitizeStringArray(row.recreationChecklist, 10),
    durationGuidance: sanitizeString(row.durationGuidance, "15-30 seconds, vertical 9:16"),
    confidence: clamp(sanitizeNumber(row.confidence, 0.64), 0, 1),
  };
}

export async function matchCandidateToExistingFormat(
  candidate: VideoFormatAnalysis,
  existingFormats: ExistingFormatCandidate[],
  reasoningModel: ReasoningModel = DEFAULT_REASONING_MODEL
): Promise<FormatMatchDecision> {
  if (existingFormats.length === 0) {
    return {
      matchedFormatId: null,
      confidence: 1,
      reason: "No existing formats yet.",
    };
  }

  requireGeminiKey();
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const existingSerialized = existingFormats
    .slice(0, 40)
    .map((format) => ({
      id: format.id,
      formatName: format.formatName,
      formatType: format.formatType,
      formatSignature: format.formatSignature,
      summary: format.summary,
      hookPatterns: format.hookPatterns,
      editingStyle: format.editingStyle,
    }));

  const prompt = `You are matching a new video format candidate against an existing format library.

CANDIDATE:
${JSON.stringify(candidate, null, 2)}

EXISTING FORMATS:
${JSON.stringify(existingSerialized, null, 2)}

TASK:
- If candidate is the same reusable format system as one existing format, return that format id.
- If not similar enough, return null.
- Prioritize structure and production system, not topic.

Output strict JSON only:
{
  "matchedFormatId": "existing-id-or-null",
  "confidence": 0.0,
  "reason": "short reason"
}`;

  const result = await model.generateContent(prompt);
  const parsed = parseJsonFromModel(result.response.text());
  const row = isRecord(parsed) ? parsed : {};
  const idSet = new Set(existingFormats.map((format) => format.id));

  const matchedFormatIdRaw = row.matchedFormatId;
  const matchedFormatId =
    typeof matchedFormatIdRaw === "string" && idSet.has(matchedFormatIdRaw)
      ? matchedFormatIdRaw
      : null;

  return {
    matchedFormatId,
    confidence: clamp(sanitizeNumber(row.confidence, matchedFormatId ? 0.68 : 0.42), 0, 1),
    reason: sanitizeString(row.reason, matchedFormatId ? "Matched to an existing format." : "No strong format match."),
  };
}

interface BuildRecreationPlanArgs {
  appName: string;
  appContext: string;
  sourceVideo: {
    sourceUrl: string;
    title: string | null;
    description: string | null;
    platform: string;
    userNotes: string | null;
    transcriptSummary?: string | null;
    transcriptText?: string | null;
    sourceDurationSeconds?: number | null;
  };
  format: VideoFormatAnalysis;
  ugcCharacter?: UGCCharacterProfile | null;
  reasoningModel?: ReasoningModel;
  useMotionControl?: boolean;
  useKlingMotionControl?: boolean;
}

export async function buildVideoRecreationPlan({
  appName,
  appContext,
  sourceVideo,
  format,
  ugcCharacter,
  reasoningModel = DEFAULT_REASONING_MODEL,
  useMotionControl = false,
  useKlingMotionControl = false,
}: BuildRecreationPlanArgs): Promise<VideoRecreationPlan> {
  const sourceDurationSeconds =
    typeof sourceVideo.sourceDurationSeconds === "number" && Number.isFinite(sourceVideo.sourceDurationSeconds)
      ? sourceVideo.sourceDurationSeconds
      : typeof format.sourceDurationSeconds === "number" && Number.isFinite(format.sourceDurationSeconds)
        ? format.sourceDurationSeconds
        : null;

  if (useKlingMotionControl) {
    return {
      title: sanitizeString(sourceVideo.title, `${appName} Kling motion control start-frame plan`),
      strategy:
        "Kling motion control variant: generate one high-fidelity start frame that matches the source frame-zero composition and selected character lock.",
      objective:
        "Provide a single continuity-safe start frame optimized for motion control workflows, without full script generation.",
      klingMotionControlOnly: true,
      maxSingleClipDurationSeconds: MAX_SINGLE_VIDEO_CLIP_SECONDS,
      useMotionControl: false,
      integrationMode: "standard_adaptation",
      publicFigureNotes: "No rewrite plan generated. Start-frame-only motion control mode.",
      overlayOpportunities: [],
      deliverableSpec: {
        duration: "start-frame-only",
        aspectRatio: "9:16",
        platforms: ["tiktok", "instagram_reels", "youtube_shorts"],
        voiceStyle: "N/A",
      },
      script: {
        hook: "",
        beats: [],
        cta: "",
      },
      socialCaption: {
        caption: "",
        hashtags: [],
      },
      higgsfieldPrompts: [],
      finalCutProSteps: [
        "Generate shared start frame in motion control mode.",
        "Use this frame as frame-zero input for Kling motion control generation.",
      ],
      productionSteps: [
        "Match source opening frame composition and character lock.",
        "Generate motion directly from shared start frame in Kling.",
      ],
      editingTimeline: [],
      assetsChecklist: ["Shared start frame", "Character reference image (optional)"],
      qaChecklist: [
        "Character identity matches selected profile.",
        "Environment matches source opening frame.",
      ],
    };
  }

  requireGeminiKey();
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const targetDurationSeconds =
    typeof sourceDurationSeconds === "number" && Number.isFinite(sourceDurationSeconds)
      ? Math.max(MAX_SINGLE_VIDEO_CLIP_SECONDS, Math.round(sourceDurationSeconds))
      : 60;
  const shouldGenerateShotGroups =
    useMotionControl || targetDurationSeconds > MAX_SINGLE_VIDEO_CLIP_SECONDS;
  const minBeatCount = Math.max(8, Math.ceil(targetDurationSeconds / 4));

  const contentClassification = await classifyVideoContentCategory({
    model,
    sourceVideo,
    appName,
    appContext,
  });

  const categoryStrategyBlock =
    contentClassification.category === "islamic_only"
      ? `
CATEGORY SCRIPT STRATEGY (islamic_only):
- Keep the source's Islamic tone and structure faithful.
- Add one natural bridge beat that introduces a relevant period/pregnancy challenge to make app context genuinely useful.
- Then connect that bridge to an app-supported action without hard selling.
`
      : contentClassification.category === "islamic_period_pregnancy"
        ? `
CATEGORY SCRIPT STRATEGY (islamic_period_pregnancy):
- Preserve both Islamic framing and period/pregnancy topic throughout the script.
- Integrate app context as a practical support mechanism within the main flow.
- Use app mention as proof/help moment, not ad language.
`
        : `
CATEGORY SCRIPT STRATEGY (period_pregnancy_only):
- Preserve the period/pregnancy core topic and original structure.
- Add light faith-aware framing where natural and respectful (not preachy).
- Integrate app context as a practical daily-use support in a native way.
`;

  const prompt = `You are a senior short-form video strategist.

Goal:
Create a full recreation plan for the app below using this selected source format.

APP:
- Name: ${appName}
- Context: ${appContext || "N/A"}

TOOLS AVAILABLE:
- AI multi-shot video generation tools (shot-based workflow)
- Professional video editing tools

CREATOR CONSTRAINT:
- Assume there are no real human creators available for collaboration.
- If this format requires on-camera human presence (UGC, testimonial, talking-head, lifestyle human actions), use AI-generated creator shots.
- Keep one consistent influencer persona across scenes (face, age range, modest styling, tone, lighting continuity).
- Do not mention "AI" or "generated" inside the public-facing script unless explicitly needed.
- If formatType is ugc, ALWAYS use the provided UGC character profile consistently across all scenes.

SELECTED FORMAT:
${JSON.stringify(format, null, 2)}

UGC CHARACTER PROFILE:
${ugcCharacter ? JSON.stringify(ugcCharacter, null, 2) : "N/A"}

REFERENCE VIDEO:
- URL: ${sourceVideo.sourceUrl}
- Platform: ${sourceVideo.platform}
- Title: ${sourceVideo.title || "N/A"}
- Description: ${sourceVideo.description || "N/A"}
- Notes: ${sourceVideo.userNotes || "N/A"}
- Transcript Summary: ${sourceVideo.transcriptSummary || "N/A"}
- Transcript Text: ${sourceVideo.transcriptText || "N/A"}
- Source Duration: ${sourceDurationHint(sourceDurationSeconds)}

FIXED CONTENT CLASSIFICATION (already decided):
- category: ${contentClassification.category}
- confidence: ${contentClassification.confidence}
- reason: ${contentClassification.reason}

${categoryStrategyBlock}

RESPONSE RULES:
- Build for Muslim women audience and keep tone faith-aware, practical, and respectful.
- Keep output execution-ready, not high-level fluff.
- Match the source video length by default (target within +/-10% of source duration when source duration is available).
- Use enough timing beats to cover the full source-matched duration.
- Target duration: ${targetDurationSeconds}s.
- Minimum beat count: ${minBeatCount}.
- Beat timecodes should span nearly the full target duration.
- Keep this value-first, not ad-first. The video should feel like native educational/lifestyle content.
- Include app context in at least one natural beat, without turning the script into an ad.
- Prefer subtle app integration (screen recording/screenshot overlay, UI callout, or quick proof moment) instead of hard-selling narration.
- Keep explicit app name mentions to a maximum of 1 in the entire script (hook + beats + CTA).
- CTA must be soft and non-salesy (example style: save/share/follow/use this method), with optional subtle app reference only if it fits context.
- For any app overlay moment, specify placement and intent in editNote (for example: "top-right mini overlay of cycle day screen for 2s").
- Reuse the source transcript style (cadence, phrasing, emotional tone) when drafting narration so output feels native to the original format.
- Preserve the source opening mechanic in the first 1-2 beats (for example reaction face + hook text + reveal order) instead of converting to generic ad structure.
- If source has little/no spoken audio, keep the adaptation text-led and visual-led: prioritize hook text + reactions + app screen flow, avoid forcing voiceover-heavy scripting.
- When transcript is sparse, rely heavily on hookPatterns, shotPattern, onScreenTextPatterns, visualSignals, and user notes from SELECTED FORMAT.
- Include a socialCaption block with a platform-ready post caption and 3-8 relevant hashtags.
- If human presence is needed, include execution-ready multi-shot prompts with persona continuity instructions.
- Production steps must explicitly describe how to generate and stitch shot groups with app overlays.
- Add a dedicated finalCutProSteps list with explicit, ordered Final Cut Pro execution steps from project setup to export.
- Every multi-shot prompt must include performance instruction:
  - If character speaks on camera, include the exact spoken line in quotes and prefix with "Dialogue:".
  - If character does not speak, explicitly write "No dialogue" and describe facial/body expression intent.
- For every multi-shot prompt, include individual shotDuration (for example: "3.5s" or "0:08").
- For every multi-shot prompt, include generationType from: base_ai_video | ugc_video | ai_broll | product_ui_overlay | transition_fx.
- For every multi-shot prompt, include shotId in strict sequence format: shot1, shot2, shot3, ...
- Each prompt field must be 77 words maximum (hard limit).
- Prompts are for video generation, not still photos. Do not use wording like "photo", "portrait photo", "still image", or "snapshot".
- For any app showcase / phone UI shot, force a keyable phone screen: pure chroma green (#00FF00), no UI/text baked in, minimal glare/reflections.
- For any app showcase / phone UI shot, enforce static camera only: locked-off/tripod framing, no pan/tilt/zoom/dolly/handheld movement.
- Ensure prompts are ready for shot-based generation and continuity across groups.
- Ensure prompts cover required generation types for this concept (at minimum base_ai_video + ai_broll, and ugc_video whenever human talking-head presence is required).
- Keep the prompt field clean scene direction only. Do NOT include model, reason, or duration text inside prompt; use the dedicated fields.
- For ugc format, include a Character Lock continuity directive in each scene using the provided UGC character profile.
- If source content appears to include a famous public figure, public speech, or recognisable creator persona that should not be rewritten:
  - Set integrationMode to "public_figure_overlay_only".
  - Do NOT rewrite their core spoken lines or impersonate them.
  - Keep original speech/audio moments and only integrate app via subtle overlays/screenshots/screen recordings.
  - Avoid making it look like endorsement by that public figure.
${shouldGenerateShotGroups ? `
SHOT GROUP CONSTRAINTS:
- You must generate motionControlSegments (shot groups) because generation clips have a strict ${MAX_SINGLE_VIDEO_CLIP_SECONDS}-second limit.
- Split the full script into sequential logical groups with each group <= ${MAX_SINGLE_VIDEO_CLIP_SECONDS} seconds.
- For each segment, provide a startFramePrompt describing the exact visual of the very first frame (character identity, clothing, setting, framing).
- For each segment, provide segment-level script (hook/shots/cta) that covers only that segment's time window.
- Segment script shots must be continuous and self-contained.
- Do NOT end a segment with unfinished dialogue that requires continuation in next segment.
- End every segment's spoken lines as complete thoughts with full stop punctuation.
- In each segment script, shots are ordered by shotId only (shot1, shot2, ...). Do NOT use per-shot timing.
- Keep each segment focused on its own content window; do not add explicit handoff/transition instructions to the end of the segment.
- For each segment, provide one complete detailed veoPrompt optimized for Veo 3.1. It must be copy-paste ready, include shot-wise structure (Shot 1: ... Shot 2: ...), and push photorealistic UGC realism.
- Veo prompt realism directives: natural skin texture and pores, realistic eye blinks/micro-expressions, physically plausible lighting, authentic handheld phone motion, no uncanny facial artifacts, no waxy/plastic skin look.
- For each segment, provide multiShotPrompts tailored to that segment only.
` : ""}
- Return strict JSON only.

JSON SHAPE:
{
  "title": "string",
  "strategy": "string",
  "objective": "string",
  "integrationMode": "standard_adaptation|public_figure_overlay_only",
  "publicFigureNotes": "string",
  "overlayOpportunities": ["string"],
  "deliverableSpec": {
    "duration": "string",
    "aspectRatio": "9:16",
    "platforms": ["string"],
    "voiceStyle": "string"
  },
  "script": {
    "hook": "string",
    "beats": [
      {
        "timecode": "0:00-0:03",
        "visual": "string",
        "narration": "string",
        "onScreenText": "string",
        "editNote": "string"
      }
    ],
    "cta": "string"
  },
  "socialCaption": {
    "caption": "string",
    "hashtags": ["string"]
  },
${shouldGenerateShotGroups ? `  "motionControlSegments": [
    {
      "segmentId": 1,
      "timecode": "0:00-0:08",
      "durationSeconds": 8,
      "startFramePrompt": "string",
      "script": {
        "hook": "string",
        "shots": [
          {
            "shotId": "shot1",
            "visual": "string",
            "narration": "string",
            "onScreenText": "string",
            "editNote": "string"
          }
        ],
        "cta": "string"
      },
      "veoPrompt": "single detailed Veo 3.1 prompt with Shot 1 / Shot 2 / ...",
      "multiShotPrompts": [
        {
          "shotId": "shot1",
          "generationType": "base_ai_video|ugc_video|ai_broll|product_ui_overlay|transition_fx",
          "scene": "string",
          "prompt": "string with Dialogue: \"...\" OR No dialogue: ...",
          "shotDuration": "string"
        }
      ]
    }
  ],` : `  "higgsfieldPrompts": [
    {
      "shotId": "shot1",
      "generationType": "base_ai_video|ugc_video|ai_broll|product_ui_overlay|transition_fx",
      "scene": "string",
      "prompt": "string with Dialogue: \"...\" OR No dialogue: ...",
      "shotDuration": "string"
    }
  ],`}
  "finalCutProSteps": ["string"],
  "productionSteps": ["string"],
  "editingTimeline": ["string"],
  "assetsChecklist": ["string"],
  "qaChecklist": ["string"]
}`;

  const result = await model.generateContent(prompt);
  const parsed = parseJsonFromModel(result.response.text());
  const row = isRecord(parsed) ? parsed : {};
  const deliverableSpecRow = isRecord(row.deliverableSpec) ? row.deliverableSpec : {};
  const scriptRow = isRecord(row.script) ? row.script : {};
  const socialCaptionRow = isRecord(row.socialCaption) ? row.socialCaption : {};
  const maxBeats =
    typeof sourceDurationSeconds === "number" && Number.isFinite(sourceDurationSeconds)
      ? clamp(Math.round(sourceDurationSeconds / 3), minBeatCount, 64)
      : Math.max(minBeatCount, 20);

  const beatsRaw: PlanBeat[] = sanitizePlanBeats(scriptRow.beats, maxBeats);

  const promptsRaw = Array.isArray(row.higgsfieldPrompts) ? row.higgsfieldPrompts : [];
  const parsedGlobalPrompts = sanitizeMultiShotPrompts(promptsRaw, 24);

  const ugcLockedPrompts =
    format.formatType === "ugc" && ugcCharacter
      ? parsedGlobalPrompts.map((item) => ({
        ...item,
        prompt: promptNeedsCharacterLock(item.prompt, item.generationType)
          ? enforceKlingPromptWordLimit(
            ensureHiggsfieldPromptHasPerformanceInstruction(
              applyUgcCharacterLock(item.prompt, ugcCharacter)
            ),
            77
          )
          : item.prompt,
      }))
      : parsedGlobalPrompts;

  const finalCutProSteps = sanitizeStringArray(row.finalCutProSteps, 20);

  const mentionState = { count: 0 };
  const integrationModeRaw = sanitizeString(row.integrationMode, "standard_adaptation");
  const integrationMode: "standard_adaptation" | "public_figure_overlay_only" =
    integrationModeRaw === "public_figure_overlay_only"
      ? "public_figure_overlay_only"
      : "standard_adaptation";
  const adjustedHook = limitAppNameMentions(
    sanitizeString(scriptRow.hook, "Start with a direct pain-point hook in first 2 seconds."),
    appName,
    mentionState
  );

  const beats = normalizeBeatsToTargetDuration({
    beats: beatsRaw,
    targetDurationSeconds,
    minBeatCount,
    hook: adjustedHook,
  });

  const adjustedBeats = beats.map((beat): PlanBeat => ({
    ...beat,
    narration: limitAppNameMentions(beat.narration, appName, mentionState),
    onScreenText: limitAppNameMentions(beat.onScreenText, appName, mentionState),
    editNote: beat.editNote,
  }));
  const adjustedCta = limitAppNameMentions(
    sanitizeString(scriptRow.cta, "Save this and try the routine today; use your tracker to stay consistent."),
    appName,
    mentionState
  );

  const adjustedBeatsForMode =
    integrationMode === "public_figure_overlay_only"
      ? adjustedBeats.map((beat) => ({
        ...beat,
        narration:
          sanitizeString(beat.narration, "").length > 0 && /original|keep|source audio|use source/i.test(beat.narration)
            ? beat.narration
            : "Keep original source speech/audio for this beat; no rewritten voice line.",
      }))
      : adjustedBeats;

  const sourceHasSparseAudio =
    cleanText(sourceVideo.transcriptText).length === 0 &&
    cleanText(sourceVideo.transcriptSummary).length === 0 &&
    !format.transcriptAvailable;

  const openingMechanicHint = [
    format.hookPatterns[0] || "",
    format.onScreenTextPatterns[0] || "",
    format.shotPattern[0] || "",
  ]
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, 3)
    .join(" | ");

  const sourceAlignedBeats = adjustedBeatsForMode.map((beat, index) => {
    if (!sourceHasSparseAudio) return beat;

    const beatNarration = cleanText(beat.narration);
    const beatOnScreenText = cleanText(beat.onScreenText);
    const fallbackText = index === 0 ? cleanText(adjustedHook) : beatNarration;

    return {
      ...beat,
      narration: "",
      onScreenText: beatOnScreenText || fallbackText,
    };
  });

  const sourceAlignedBeatsWithOpeningHint =
    openingMechanicHint && sourceAlignedBeats.length > 0
      ? sourceAlignedBeats.map((beat, index) => {
        if (index !== 0) return beat;
        const existingNote = cleanText(beat.editNote);
        if (/preserve source opening mechanic/i.test(existingNote)) return beat;
        return {
          ...beat,
          editNote: cleanText(
            `${existingNote}${existingNote ? " " : ""}Preserve source opening mechanic: ${openingMechanicHint}.`
          ),
        };
      })
      : sourceAlignedBeats;

  const fallbackCaption = [
    adjustedHook,
    sourceAlignedBeatsWithOpeningHint[0]?.onScreenText || sourceAlignedBeatsWithOpeningHint[0]?.narration || "",
    adjustedCta,
  ]
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join(" ");
  const socialCaption = sanitizeString(
    socialCaptionRow.caption,
    fallbackCaption || "Save this flow and try it today for a calmer, more consistent routine."
  );
  const socialHashtags = sanitizeHashtagArray(socialCaptionRow.hashtags, 8);

  const motionControlSegmentsRaw = Array.isArray(row.motionControlSegments) ? row.motionControlSegments : [];
  const modelShotGroups: MotionControlSegment[] = motionControlSegmentsRaw
    .map((seg, index): MotionControlSegment | null => {
      if (!isRecord(seg)) return null;

      const segmentScriptRow = isRecord(seg.script) ? seg.script : {};
      const segmentShots = sanitizeSegmentScriptShots(
        isRecord(segmentScriptRow) && Array.isArray(segmentScriptRow.shots)
          ? segmentScriptRow.shots
          : segmentScriptRow.beats,
        Math.max(1, Math.ceil(maxBeats / 2))
      );
      const segmentScript =
        cleanText(sanitizeString(segmentScriptRow.hook, "")).length > 0 ||
          segmentShots.length > 0 ||
          cleanText(sanitizeString(segmentScriptRow.cta, "")).length > 0
          ? {
            hook: sanitizeString(segmentScriptRow.hook, ""),
            shots: segmentShots,
            cta: closeOpenEndedLine(sanitizeString(segmentScriptRow.cta, "")),
          }
          : undefined;
      const segmentPrompts = sanitizeMultiShotPrompts(seg.multiShotPrompts, 8);
      const segmentVeoPrompt = sanitizeString(seg.veoPrompt, "");

      return {
        segmentId: typeof seg.segmentId === "number" ? seg.segmentId : index + 1,
        timecode: sanitizeString(
          seg.timecode,
          `${formatClock(index * MAX_SINGLE_VIDEO_CLIP_SECONDS)}-${formatClock((index + 1) * MAX_SINGLE_VIDEO_CLIP_SECONDS)}`
        ),
        durationSeconds: clamp(
          Math.round(sanitizeNumber(seg.durationSeconds, MAX_SINGLE_VIDEO_CLIP_SECONDS)),
          1,
          MAX_SINGLE_VIDEO_CLIP_SECONDS
        ),
        startFramePrompt: sanitizeString(seg.startFramePrompt, ""),
        ...(segmentScript ? { script: segmentScript } : {}),
        ...(segmentVeoPrompt ? { veoPrompt: segmentVeoPrompt } : {}),
        ...(segmentPrompts.length > 0 ? { multiShotPrompts: segmentPrompts } : {}),
      };
    })
    .filter((seg): seg is MotionControlSegment => seg !== null);

  const fallbackShotGroups = shouldGenerateShotGroups
    ? splitBeatsIntoShotGroups({
      beats: sourceAlignedBeatsWithOpeningHint,
      totalDurationSeconds: targetDurationSeconds,
      maxSegmentSeconds: MAX_SINGLE_VIDEO_CLIP_SECONDS,
      hook: adjustedHook,
      cta: adjustedCta,
    })
    : [];

  const resolvedBaseGroups = modelShotGroups.length > 0 ? modelShotGroups : fallbackShotGroups;
  const globalPromptChunkSize = Math.max(1, Math.ceil(ugcLockedPrompts.length / Math.max(1, resolvedBaseGroups.length)));

  const shotGroups = resolvedBaseGroups.map((segment, index) => {
    const fallbackSegment = fallbackShotGroups[index];
    const fallbackScript = fallbackSegment?.script;
    const nextScript = segment.script || fallbackScript;
    const inheritedGlobalPrompts = ugcLockedPrompts.slice(
      index * globalPromptChunkSize,
      (index + 1) * globalPromptChunkSize
    );
    const basePrompts = segment.multiShotPrompts && segment.multiShotPrompts.length > 0
      ? segment.multiShotPrompts
      : inheritedGlobalPrompts;
    const fallbackSegmentPrompts = buildFallbackMultiShotPrompts(
      {
        ...segment,
        script: nextScript,
      },
      index
    );
    const mergedPrompts = (basePrompts.length > 0 ? basePrompts : fallbackSegmentPrompts).map((prompt, promptIndex) => ({
      ...prompt,
      shotId: `group${segment.segmentId}_shot${promptIndex + 1}`,
      prompt: promptNeedsCharacterLock(prompt.prompt, prompt.generationType) && format.formatType === "ugc" && ugcCharacter
        ? enforceKlingPromptWordLimit(
          ensureHiggsfieldPromptHasPerformanceInstruction(
            applyUgcCharacterLock(prompt.prompt, ugcCharacter)
          ),
          77
        )
        : prompt.prompt,
    }));

    return {
      ...segment,
      startFramePrompt:
        cleanText(segment.startFramePrompt).length > 0
          ? segment.startFramePrompt
          : cleanText(fallbackSegment?.startFramePrompt) || `Opening frame for segment ${segment.segmentId}.`,
      durationSeconds: clamp(segment.durationSeconds, 1, MAX_SINGLE_VIDEO_CLIP_SECONDS),
      script: nextScript
        ? {
          hook: closeOpenEndedLine(sanitizeString(nextScript.hook, "")),
          shots: sanitizeSegmentScriptShots(nextScript.shots, Math.max(1, Math.ceil(maxBeats / 2))),
          cta: closeOpenEndedLine(sanitizeString(nextScript.cta, "")),
        }
        : undefined,
      multiShotPrompts: mergedPrompts,
    };
  });
  const transitionReadyShotGroups = enforceSegmentBoundaryTransitions(shotGroups);
  const styleHint =
    format.formatType === "ugc"
      ? "ugc creator-style live-action"
      : format.formatType === "ai_video"
        ? "live-action style ai video"
        : "social-first live-action style";
  const veoReadyShotGroups = transitionReadyShotGroups.map((segment, index, all) => ({
    ...segment,
    veoPrompt: ensureVeoPromptQuality(
      segment.veoPrompt || "",
      buildVeo31SegmentPrompt({
        segment,
        nextSegment: all[index + 1],
        styleHint,
        appName,
        ugcCharacter,
      }),
      styleHint
    ),
  }));

  return {
    title: sanitizeString(row.title, `${appName} format recreation plan`),
    contentClassification,
    maxSingleClipDurationSeconds: MAX_SINGLE_VIDEO_CLIP_SECONDS,
    useMotionControl: shouldGenerateShotGroups,
    motionControlSegments:
      shouldGenerateShotGroups && veoReadyShotGroups.length > 0
        ? veoReadyShotGroups
        : undefined,
    strategy: (() => {
      const normalized = sanitizeString(row.strategy, "");
      return normalized || "Reuse the selected format skeleton as value-first content, maintain native source pacing, and add subtle app integration where naturally relevant.";
    })(),
    objective: (() => {
      const normalized = sanitizeString(row.objective, "");
      return normalized || "Deliver practical guidance with authentic retention flow and optional low-friction app visibility.";
    })(),
    integrationMode,
    publicFigureNotes: sanitizeString(
      row.publicFigureNotes,
      integrationMode === "public_figure_overlay_only"
        ? "Detected public-figure style source. Preserve original speech and use overlay-only app integration."
        : "No strict public-figure preservation constraints detected."
    ),
    overlayOpportunities: sanitizeStringArray(row.overlayOpportunities, 8),
    deliverableSpec: {
      duration: sanitizeString(
        deliverableSpecRow.duration,
        sourceMatchedDurationFallback(sourceDurationSeconds)
      ),
      aspectRatio: sanitizeString(deliverableSpecRow.aspectRatio, "9:16"),
      platforms: sanitizeStringArray(deliverableSpecRow.platforms, 4),
      voiceStyle: sanitizeString(deliverableSpecRow.voiceStyle, "Warm, direct, practical"),
    },
    script: {
      hook: adjustedHook,
      beats: sourceAlignedBeatsWithOpeningHint,
      cta: adjustedCta,
    },
    socialCaption: {
      caption: socialCaption,
      hashtags:
        socialHashtags.length > 0
          ? socialHashtags
          : ["#MuslimahLifestyle", "#FaithBasedHabits", "#ProductiveRoutine"],
    },
    higgsfieldPrompts: veoReadyShotGroups.flatMap((segment) => segment.multiShotPrompts || []).slice(0, 24),
    finalCutProSteps:
      finalCutProSteps.length > 0
        ? finalCutProSteps
        : buildFinalCutProFallbackSteps(sourceDurationSeconds),
    productionSteps: sanitizeStringArray(row.productionSteps, 12),
    editingTimeline: sanitizeStringArray(row.editingTimeline, 12),
    assetsChecklist: sanitizeStringArray(row.assetsChecklist, 12),
    qaChecklist: sanitizeStringArray(row.qaChecklist, 12),
  };
}

interface BuildVideoScriptIdeationArgs {
  appName: string;
  appContext: string;
  topicBrief?: string;
  targetDurationSeconds?: number;
  preferredVideoType?: ScriptAgentVideoType | "auto";
  campaignMode?: ScriptAgentCampaignMode;
  ugcCharacter?: UGCCharacterProfile | null;
  reasoningModel?: ReasoningModel;
}

export async function buildVideoScriptIdeationPlan({
  appName,
  appContext,
  topicBrief = "",
  targetDurationSeconds = 75,
  preferredVideoType = "auto",
  campaignMode = "standard",
  ugcCharacter,
  reasoningModel = DEFAULT_REASONING_MODEL,
}: BuildVideoScriptIdeationArgs): Promise<VideoScriptIdeationPlan> {
  requireGeminiKey();
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const resolvedCampaignMode = sanitizeScriptAgentCampaignMode(campaignMode);
  const safeDurationSeconds =
    resolvedCampaignMode === "daily_ugc_quran_journey"
      ? Math.max(30, Math.round(targetDurationSeconds))
      : resolvedCampaignMode === "widget_late_period_reaction_hook_ugc"
        ? 8
      : resolvedCampaignMode === "mixed_media_relatable_pov"
        ? clamp(Math.round(targetDurationSeconds), 18, 45)
      : resolvedCampaignMode === "static_photoreal_avatar_meme"
        ? clamp(Math.round(targetDurationSeconds), 12, 35)
      : resolvedCampaignMode === "ai_objects_educational_explainer"
        ? clamp(Math.round(targetDurationSeconds), 75, 110)
      : resolvedCampaignMode === "widget_shock_hook_ugc"
        ? clamp(Math.round(targetDurationSeconds), 30, 90)
      : clamp(Math.round(targetDurationSeconds), 30, 180);
  const minBeatCount =
    resolvedCampaignMode === "widget_late_period_reaction_hook_ugc"
      ? 2
      : resolvedCampaignMode === "mixed_media_relatable_pov"
        ? Math.min(20, Math.max(6, Math.ceil(safeDurationSeconds / 5)))
      : resolvedCampaignMode === "static_photoreal_avatar_meme"
        ? Math.min(20, Math.max(4, Math.ceil(safeDurationSeconds / 4)))
      : resolvedCampaignMode === "ai_objects_educational_explainer"
        ? Math.min(64, Math.max(12, Math.ceil(safeDurationSeconds / 6)))
      : Math.min(64, Math.max(8, Math.ceil(safeDurationSeconds / 4)));
  const normalizedTopicBrief = cleanText(topicBrief);
  const hasTopicBrief = normalizedTopicBrief.length > 0;
  const forcedVideoType: ScriptAgentVideoType | null =
    resolvedCampaignMode === "widget_reaction_ugc" ||
    resolvedCampaignMode === "widget_shock_hook_ugc" ||
    resolvedCampaignMode === "widget_late_period_reaction_hook_ugc"
      ? "ugc"
      : resolvedCampaignMode === "ai_objects_educational_explainer"
        ? "ai_animation"
      : resolvedCampaignMode === "mixed_media_relatable_pov"
        ? "ai_animation"
      : resolvedCampaignMode === "static_photoreal_avatar_meme"
        ? "ai_animation"
      : resolvedCampaignMode === "daily_ugc_quran_journey"
        ? "ai_animation"
        : null;
  const preferredVideoTypeForPrompt = forcedVideoType || preferredVideoType;

  const campaignRulesBlock = resolvedCampaignMode === "widget_reaction_ugc"
    ? `
CAMPAIGN MODE: widget_reaction_ugc
- Build reaction-driven UGC videos for Muslim women app widgets.
- Character should show genuine surprise-to-happy reaction.
- Focus on text overlays about app features, lock-screen widgets, and home-screen widgets.
- Include overlay themes like:
  * "I did not know an app like this existed."
  * "I just found the perfect widget for tracking cycles."
  * "Always confused about whether prayer is permissible in each phase?"
- Ensure script clearly communicates: widget shows current cycle phase plus worship status (prayer, fasting, Quran: permissible or paused).
- Reserve final handoff for external full-screen app screen recording after generated segment (recording added in edit).
- Keep this mode strictly UGC (not animation).
`
    : resolvedCampaignMode === "widget_shock_hook_ugc"
      ? `
CAMPAIGN MODE: widget_shock_hook_ugc
- Build short, shock-hook, reaction-driven UGC videos for Muslim women app widgets.
- Keep pacing tight and punchy (quick hook, quick app showcase, quick close).
- Main hook energy: visibly shocked reaction in first second, then relieved excitement.
- The first 8 seconds must be ONLY shocked reaction hook (no dialogue), split into two 4-second title moments.
- Title moment 1 (0-4s): AI-generated hook title.
- Title moment 2 (4-8s): second AI-generated hook title.
- Character should start talking about the app only after the first 8 seconds.
- The hook must be AI-generated (no fixed template reuse) and should position the app as a halal alternative to Flo for Muslim women.
- Hook angle should communicate: period + pregnancy tracking for Muslim women without haram content.
- Preferred hook flavor examples (as style direction only, not exact copy):
  * "Flo for Muslim women"
  * "No more period tracking app with haram contents"
  * "I just found..."
- After hook, include a brief app quick showcase (widget + one app glance), then close.
- Ensure message highlights cycle phase + worship status clarity.
- Keep this mode strictly UGC (not animation).
`
      : resolvedCampaignMode === "widget_late_period_reaction_hook_ugc"
        ? `
CAMPAIGN MODE: widget_late_period_reaction_hook_ugc
- Build one hook-only UGC reaction clip for late-period social conversation prompts.
- Duration is fixed at exactly 8 seconds.
- Entire clip is reaction-only (no app explanation, no CTA dialogue, no educational body beats).
- Tone must feel fun and relatable (not heavy or serious).
- Performance direction is mandatory:
  * Medium close-up of a young woman indoors.
  * Thinking pose first, then a gentle head shake with slight disappointment.
- Keep spoken dialogue empty; this is text-overlay-driven.
- Provide two short hook-style on-screen text lines (style examples):
  * "is everyone's period late in x month"
  * "raise your hand if it's x month and your period still hasn't shown up"
- Keep this mode strictly UGC (not animation).
`
      : resolvedCampaignMode === "ai_objects_educational_explainer"
        ? `
CAMPAIGN MODE: ai_objects_educational_explainer
- Build a high-quality AI animation educational explainer around 90 seconds.
- Visual language: cute anthropomorphic everyday objects (living objects) that explain concepts clearly.
- Keep look premium and cinematic: polished stylized 3D CGI, expressive faces, smooth motion, clean lighting.
- Object casting direction: keep characters feminine-coded and women-audience friendly (soft shapes, warm expressions, graceful motion, tasteful feminine styling).
- Narrative style: object characters teach one practical period/pregnancy or worship-support concept in simple, memorable metaphors.
- Keep education first: clear facts, practical steps, warm and friendly tone.
- Include one natural app hook moment (subtle, useful, non-ad) where the explainer references checking app status for practical decision support.
- Do not make hard sell claims; app mention should feel like a helpful tool inside the explanation.
- Keep this mode strictly ai_animation.
`
    : resolvedCampaignMode === "mixed_media_relatable_pov"
      ? `
CAMPAIGN MODE: mixed_media_relatable_pov
- Build a high-retention short-form mixed-media video for TikTok/Reels/Shorts.
- Visual core: one stylized 3D chibi-like female avatar seamlessly composited into photoreal real-world backgrounds.
- Avatar scale must stay normal world size (not miniature/toy-sized). Use wider framing so avatar feels less dominant in frame.
- Match avatar lighting to each environment (color temperature, shadow direction, intensity, contact shadows).
- Keep strict 9:16 vertical framing and mobile-first composition.
- Narrative structure: POV + episodic vignettes across temporal phases (for example: week before, week of, week after).
- Mood style: relatable and slightly exaggerated everyday moments for comedic/emotional resonance.
- Text style: minimal lowercase white labels with subtle shadow/rounded backing (text added in post, not rendered in generation).
- Every shot must have an explicit physical action beat; no talking-mouth performance.
- Include one hero app beat where avatar checks phone and the app UI appears as a practical utility moment.
- Keep app mention natural, useful, and brief. Avoid sales-heavy language.
- Keep this mode strictly ai_animation with recurring character continuity.
`
      : resolvedCampaignMode === "static_photoreal_avatar_meme"
        ? `
CAMPAIGN MODE: static_photoreal_avatar_meme
- Build funny, engaging meme-style short videos for Reels/TikTok/Shorts.
- Visual core: one stylized 3D cartoon-like female avatar composited into ultra-photoreal real-world environments.
- Avatar scale must stay normal world size (not miniature/toy-sized). Use wider framing so avatar feels less dominant in frame.
- Keep backgrounds mostly static (locked or near-locked camera), while avatar performance carries the humor.
- Match avatar grounding cues perfectly: perspective, contact shadows, light direction, color temperature, and lens feel.
- Keep strict 9:16 vertical framing.
- No spoken dialogue or voiceover. Storytelling is performance + text overlays added in edit.
- Every shot must have a clear physical action beat (walk/turn/sit/phone-check/gesture/reaction) with mouth in non-speaking state.
- If user provides topic/context, align all beats to that exact context.
- If no topic/context is provided, choose a relatable app-topic scenario yourself (period, pregnancy, muslim period, or muslim pregnancy).
- Include one practical utility beat where avatar checks the app on phone, but keep app mention brief and non-salesy.
- Keep recurring character identity consistent across all segments.
- Keep this mode strictly ai_animation.
`
    : resolvedCampaignMode === "daily_ugc_quran_journey"
      ? `
CAMPAIGN MODE: daily_ugc_quran_journey
- Build a daily diary episodic format using stylized 3D animation with one recurring animated Muslimah character.
- Keep this mode as ai_animation video type and maintain strict character continuity across all segments.
- Opening hook should feel like a real daily check-in and include date + cycle day + worship status from app.
- Include practical daily-life beats: salah routine, Quran reading progress, chores/work/study, and one meal moment.
- Integrate app naturally when she checks worship status before prayer and Quran moments (show app UI overlay cues).
- End with a Quran verse deep-dive section that clearly covers:
  * when the verses were revealed (Meccan/Medinan context if relevant),
  * at least one related hadith,
  * one trusted scholarly interpretation,
  * concise takeaways for daily practice.
- Quran reflection segments must show the animated character looking into camera and explaining like a warm teacher/mentor.
- Keep Quran prop closed in frame if visible (closed mushaf cover only, no open pages in frame generation prompts).
- Keep delivery educational, compassionate, and non-preachy.
`
    : "";

  const autoTopicBlock = hasTopicBrief
    ? ""
    : `
TOPIC SELECTION MODE:
- No topic brief is provided.
- You MUST choose one concrete high-potential informational topic yourself.
- Topic should be relevant for Muslim women and centered on period/pregnancy or islamic period/pregnancy.
- Keep the selected topic explicit in title, hook, and objective.
`;
  const noDialogueOnlyMode =
    resolvedCampaignMode === "widget_late_period_reaction_hook_ugc" ||
    resolvedCampaignMode === "mixed_media_relatable_pov" ||
    resolvedCampaignMode === "static_photoreal_avatar_meme";
  const dialogueRulesBlock = noDialogueOnlyMode
    ? `
- No spoken dialogue or voiceover in any segment.
- Keep all shot narration fields as empty strings.
- Tell the story using visual acting and short on-screen text cues only (text will be added in edit).
- Every shot must specify a clear physical action so generation favors body performance over lip-sync.
- Keep mouth relaxed/closed and avoid speech-like mouth articulation in all shots.
`
    : `
- Dialogue pacing: for segments around 8 seconds (roughly 7-9s), include one complete spoken line that is typically 10-16 words (max 16) when narration is present.
- Avoid under-filled ultra-short spoken lines (2-5 words) unless the campaign explicitly requires reaction-only silent shots.
- Keep generated narration wording intact; do not truncate or compress lines solely to reduce word count.
`;

  const prompt = `You are a senior short-form video script strategist.

TASK:
Generate an original informational video script plan WITHOUT using any source video.

APP CONTEXT:
- App Name: ${appName}
- App Context: ${appContext || "Period/pregnancy tracking app for Muslim women with worship support."}

USER INPUT:
- Topic brief: ${hasTopicBrief ? normalizedTopicBrief : "(not provided - choose topic automatically)"}
- Preferred video type: ${preferredVideoTypeForPrompt}
- Target duration seconds: ${safeDurationSeconds}
${campaignRulesBlock}
${autoTopicBlock}

AVAILABLE VIDEO TYPES:
- ugc (creator/talking-head style)
- ai_animation (animated explainers)
- faceless_broll (voiceover + visual metaphors)
- hybrid (mix of talking-head and motion graphics)

TOPIC CATEGORY OPTIONS:
- period_pregnancy
- islamic_period_pregnancy

RULES:
- Choose exactly one topic category and one video type.
- Keep tone educational, compassionate, practical, and non-judgmental.
- App hook must be natural and useful (not ad-like), ideally as one practical proof/help beat.
- Mention app name at most once in full script.
- Duration must closely match target.
- Use enough beats to fill full duration (minimum ${minBeatCount} beats).
- Beat timecodes should span almost full duration.
${dialogueRulesBlock}
- Split into shot groups of max ${MAX_SINGLE_VIDEO_CLIP_SECONDS}s each.
- Each shot group must include startFramePrompt, segment script (hook/shots/cta), and multiShotPrompts.
- Each shot group must include startFramePrompt, segment script (hook/shots/cta), and one copy-paste-ready veoPrompt for Veo 3.1.
- Segment scripts must be self-contained per group with no unfinished sentence that continues into the next segment.
- Use shotId ordering inside each segment (shot1, shot2, ...), no per-shot timing.
- Keep each segment focused on its own content; do not spend duration on explicit handoff-to-next-segment actions.
- Veo prompt must be a single detailed prompt with explicit shot-wise structure (Shot 1: ..., Shot 2: ...).
- Veo prompt style directives by video type:
  - ugc/hybrid/faceless_broll: photoreal live-action realism (natural skin detail, plausible lighting, no uncanny artifacts).
  - ai_animation: stylized CGI animation look (clean shading, stable topology/deformation, smooth motion), explicitly not photoreal live-action skin realism.

MULTI-SHOT PROMPT RULES:
- Each prompt must be <= 77 words.
- Each prompt must contain either:
  - Dialogue: "..." (if spoken), OR
  - No dialogue: ... (if non-speaking).
- Use generationType from: base_ai_video | ugc_video | ai_broll | product_ui_overlay | transition_fx.
- If phone/app UI is shown, require pure chroma green phone screen (#00FF00), no baked UI.

${ugcCharacter ? `UGC CHARACTER LOCK:
- characterName: ${ugcCharacter.characterName}
- personaSummary: ${ugcCharacter.personaSummary}
- visualStyle: ${ugcCharacter.visualStyle}
- wardrobeNotes: ${ugcCharacter.wardrobeNotes}
- voiceTone: ${ugcCharacter.voiceTone}
- promptTemplate: ${ugcCharacter.promptTemplate}
- If selectedVideoType is ugc or hybrid, maintain this identity across all segments.
` : ""}

Return strict JSON only:
{
  "title": "string",
  "objective": "string",
  "topicCategory": "period_pregnancy|islamic_period_pregnancy",
  "selectedVideoType": "ugc|ai_animation|faceless_broll|hybrid",
  "videoTypeReason": "string",
  "appHookStrategy": "string",
  "targetDurationSeconds": ${safeDurationSeconds},
  "script": {
    "hook": "string",
    "beats": [
      {
        "timecode": "0:00-0:04",
        "visual": "string",
        "narration": "string",
        "onScreenText": "string",
        "editNote": "string"
      }
    ],
    "cta": "string"
  },
  "motionControlSegments": [
    {
      "segmentId": 1,
      "timecode": "0:00-0:08",
      "durationSeconds": 8,
      "startFramePrompt": "string",
      "script": {
        "hook": "string",
        "shots": [
          {
            "shotId": "shot1",
            "visual": "string",
            "narration": "string",
            "onScreenText": "string",
            "editNote": "string"
          }
        ],
        "cta": "string"
      },
      "veoPrompt": "single detailed Veo 3.1 prompt with Shot 1 / Shot 2 / ...",
      "multiShotPrompts": [
        {
          "shotId": "shot1",
          "generationType": "base_ai_video|ugc_video|ai_broll|product_ui_overlay|transition_fx",
          "scene": "string",
          "prompt": "string with Dialogue: \"...\" OR No dialogue: ...",
          "shotDuration": "string"
        }
      ]
    }
  ],
  "socialCaption": {
    "caption": "string",
    "hashtags": ["string"]
  },
  "productionSteps": ["string"],
  "qaChecklist": ["string"]
}`;

  const result = await model.generateContent(prompt);
  const parsed = parseJsonFromModel(result.response.text());
  const row = isRecord(parsed) ? parsed : {};
  const scriptRow = isRecord(row.script) ? row.script : {};

  const mentionState = { count: 0 };
  const hook = limitAppNameMentions(
    sanitizeString(
      scriptRow.hook,
      hasTopicBrief
        ? `A practical myth-busting hook about ${normalizedTopicBrief}.`
        : "A practical high-retention hook about a key cycle or pregnancy challenge Muslim women face."
    ),
    appName,
    mentionState
  );
  const rawBeats = sanitizePlanBeats(scriptRow.beats, 64);
  const normalizedBeats = normalizeBeatsToTargetDuration({
    beats: rawBeats,
    targetDurationSeconds: safeDurationSeconds,
    minBeatCount,
    hook,
  });
  const beats = normalizedBeats.map((beat) => ({
    ...beat,
    narration: limitAppNameMentions(beat.narration, appName, mentionState),
    onScreenText: limitAppNameMentions(beat.onScreenText, appName, mentionState),
  }));
  const cta = limitAppNameMentions(
    sanitizeString(scriptRow.cta, "Save this for later and share with someone who needs it."),
    appName,
    mentionState
  );

  const isLatePeriodReactionHookMode = resolvedCampaignMode === "widget_late_period_reaction_hook_ugc";
  const isAiObjectsEducationalMode = resolvedCampaignMode === "ai_objects_educational_explainer";
  const isMixedMediaRelatablePovMode = resolvedCampaignMode === "mixed_media_relatable_pov";
  const isStaticPhotorealAvatarMemeMode = resolvedCampaignMode === "static_photoreal_avatar_meme";
  const forcedLatePeriodHookOne = "is everyone's period late in march?";
  const forcedLatePeriodHookTwo = "raise your hand if it's march and your period still hasn't shown up";
  const forcedLatePeriodVisual =
    "Medium close-up of a young woman indoors, thinking pose, then gentle head shake with slight disappointment.";

  const baseHookForPlan = isLatePeriodReactionHookMode ? forcedLatePeriodHookOne : hook;
  const baseBeatsForPlan = isLatePeriodReactionHookMode
    ? [
      {
        timecode: "0:00-0:04",
        visual: forcedLatePeriodVisual,
        narration: "",
        onScreenText: forcedLatePeriodHookOne,
        editNote: "Reaction-only hook. No dialogue. Overlay text added in post.",
      },
      {
        timecode: "0:04-0:08",
        visual: "Same framing and lighting, continued thinking pose with gentle head shake and slight disappointment.",
        narration: "",
        onScreenText: forcedLatePeriodHookTwo,
        editNote: "Reaction-only continuation. No dialogue. Overlay text added in post.",
      },
    ]
    : beats;
  const baseCtaForPlan = isLatePeriodReactionHookMode ? "" : cta;

  const hookForPlan = baseHookForPlan;
  let beatsForPlan = baseBeatsForPlan;
  const ctaForPlan = baseCtaForPlan;

  if (isAiObjectsEducationalMode) {
    const normalizedAppName = cleanText(appName);
    const appPattern = normalizedAppName ? new RegExp(escapeRegExp(normalizedAppName), "i") : null;
    const scriptCombinedText = [
      hookForPlan,
      ctaForPlan,
      ...beatsForPlan.map((beat) => `${beat.narration || ""} ${beat.onScreenText || ""}`),
    ].join(" ");
    const hasAppMention = appPattern ? appPattern.test(scriptCombinedText) : false;

    if (!hasAppMention && normalizedAppName && beatsForPlan.length > 0) {
      const hookBeatIndex = Math.min(beatsForPlan.length - 1, Math.floor(beatsForPlan.length * 0.6));
      beatsForPlan = beatsForPlan.map((beat, index) => {
        if (index !== hookBeatIndex) return beat;
        return {
          ...beat,
          narration: closeOpenEndedLine(
            cleanText(beat.narration) ||
              `Quick practical check: I open ${normalizedAppName} to confirm cycle and worship status before deciding the next step.`
          ),
          onScreenText:
            cleanText(beat.onScreenText) ||
            "Quick app status check",
          editNote: cleanText(
            `${beat.editNote || ""} Keep app hook useful and subtle, never ad-like.`
          ),
        };
      });
    }
  }

  if (isMixedMediaRelatablePovMode || isStaticPhotorealAvatarMemeMode) {
    beatsForPlan = beatsForPlan.map((beat) => ({
      ...beat,
      narration: "",
      onScreenText:
        cleanText(beat.onScreenText) ||
        cleanText(beat.narration) ||
        cleanText(beat.visual) ||
        "relatable chaos",
      editNote: cleanText(
        `${beat.editNote || ""} Silent meme-style beat. Add a clear physical action cue (walk/turn/sit/gesture/phone-check/reaction). Overlay text is added in edit. Keep mouth in non-speaking state.`
      ),
    }));
  }

  const modelSegmentsRaw = Array.isArray(row.motionControlSegments) ? row.motionControlSegments : [];
  const modelSegments: MotionControlSegment[] = modelSegmentsRaw
    .map((seg, index): MotionControlSegment | null => {
      if (!isRecord(seg)) return null;
      const segmentScriptRow = isRecord(seg.script) ? seg.script : {};

      return {
        segmentId: typeof seg.segmentId === "number" ? seg.segmentId : index + 1,
        timecode: sanitizeString(
          seg.timecode,
          `${formatClock(index * MAX_SINGLE_VIDEO_CLIP_SECONDS)}-${formatClock((index + 1) * MAX_SINGLE_VIDEO_CLIP_SECONDS)}`
        ),
        durationSeconds: clamp(
          Math.round(sanitizeNumber(seg.durationSeconds, MAX_SINGLE_VIDEO_CLIP_SECONDS)),
          1,
          MAX_SINGLE_VIDEO_CLIP_SECONDS
        ),
        startFramePrompt: sanitizeString(seg.startFramePrompt, ""),
        script: {
          hook: closeOpenEndedLine(sanitizeString(segmentScriptRow.hook, "")),
          shots: sanitizeSegmentScriptShots(
            Array.isArray(segmentScriptRow.shots) ? segmentScriptRow.shots : segmentScriptRow.beats,
            Math.max(1, Math.ceil(minBeatCount / 2))
          ),
          cta: closeOpenEndedLine(sanitizeString(segmentScriptRow.cta, "")),
        },
        veoPrompt: sanitizeString(seg.veoPrompt, ""),
        multiShotPrompts: sanitizeMultiShotPrompts(seg.multiShotPrompts, 8),
      };
    })
    .filter((seg): seg is MotionControlSegment => seg !== null);

  const fallbackSegments = splitBeatsIntoShotGroups({
    beats: beatsForPlan,
    totalDurationSeconds: safeDurationSeconds,
    maxSegmentSeconds: MAX_SINGLE_VIDEO_CLIP_SECONDS,
    hook: hookForPlan,
    cta: ctaForPlan,
  });

  const selectedVideoType = sanitizeScriptAgentVideoType(row.selectedVideoType);
  const segmentSource = modelSegments.length > 0 ? modelSegments : fallbackSegments;
  const resolvedVideoType =
    forcedVideoType ||
    (preferredVideoType && preferredVideoType !== "auto"
      ? preferredVideoType
      : selectedVideoType);

  const resolvedSegments = segmentSource.map((segment, index) => {
    const fallbackSegment = fallbackSegments[index];
    const nextScript = segment.script || fallbackSegment?.script;
    const basePrompts = segment.multiShotPrompts && segment.multiShotPrompts.length > 0
      ? segment.multiShotPrompts
      : [];
    const fallbackPrompts = buildFallbackMultiShotPrompts(
      {
        ...segment,
        script: nextScript,
      },
      index
    );
    const prompts = (basePrompts.length > 0 ? basePrompts : fallbackPrompts)
      .slice(0, 8)
      .map((promptItem, promptIndex) => {
        const normalizedType =
          resolvedVideoType === "ugc"
            ? promptItem.generationType === "ugc_video" ? promptItem.generationType : "ugc_video"
            : resolvedVideoType === "ai_animation"
              ? promptItem.generationType === "transition_fx" ? "transition_fx" : "base_ai_video"
              : resolvedVideoType === "faceless_broll"
                ? promptItem.generationType === "product_ui_overlay" ? "product_ui_overlay" : "ai_broll"
                : promptItem.generationType;

        const promptWithLock =
          ugcCharacter && (resolvedVideoType === "ugc" || resolvedVideoType === "hybrid")
            ? applyUgcCharacterLock(promptItem.prompt, ugcCharacter)
            : promptItem.prompt;

        return {
          ...promptItem,
          shotId: `group${segment.segmentId}_shot${promptIndex + 1}`,
          generationType: normalizedType,
          prompt: enforceKlingPromptWordLimit(
            ensureHiggsfieldPromptHasPerformanceInstruction(promptWithLock),
            77
          ),
        };
      });

    return {
      ...segment,
      timecode: sanitizeString(
        segment.timecode,
        `${formatClock(index * MAX_SINGLE_VIDEO_CLIP_SECONDS)}-${formatClock((index + 1) * MAX_SINGLE_VIDEO_CLIP_SECONDS)}`
      ),
      durationSeconds: clamp(segment.durationSeconds, 1, MAX_SINGLE_VIDEO_CLIP_SECONDS),
      startFramePrompt:
        cleanText(segment.startFramePrompt) ||
        cleanText(fallbackSegment?.startFramePrompt) ||
        `Opening frame for segment ${segment.segmentId}.`,
      script: {
        hook: closeOpenEndedLine(sanitizeString(nextScript?.hook, index === 0 ? hookForPlan : "")),
        shots: sanitizeSegmentScriptShots(nextScript?.shots, Math.max(1, Math.ceil(minBeatCount / 2))),
        cta: closeOpenEndedLine(sanitizeString(nextScript?.cta, index === segmentSource.length - 1 ? ctaForPlan : "")),
      },
      multiShotPrompts: prompts,
    };
  });
  const transitionReadySegments = enforceSegmentBoundaryTransitions(resolvedSegments);
  const campaignAdjustedSegments =
    resolvedCampaignMode === "widget_reaction_ugc"
      ? enforceWidgetReactionSeriesPattern(transitionReadySegments, appName)
      : resolvedCampaignMode === "widget_shock_hook_ugc"
        ? enforceWidgetShockHookSeriesPattern(transitionReadySegments, appName)
      : resolvedCampaignMode === "widget_late_period_reaction_hook_ugc"
        ? enforceWidgetLatePeriodReactionHookPattern(transitionReadySegments)
      : resolvedCampaignMode === "ai_objects_educational_explainer"
        ? enforceAiObjectsEducationalExplainerPattern(transitionReadySegments, appName)
    : resolvedCampaignMode === "mixed_media_relatable_pov"
      ? enforceMixedMediaRelatablePovPattern(transitionReadySegments, appName)
      : resolvedCampaignMode === "static_photoreal_avatar_meme"
        ? enforceStaticPhotorealAvatarMemePattern(transitionReadySegments, appName)
      : resolvedCampaignMode === "daily_ugc_quran_journey"
        ? enforceDailyUgcQuranJourneyPattern(transitionReadySegments, appName)
      : transitionReadySegments;
  const scriptAgentStyleHint =
    resolvedCampaignMode === "ai_objects_educational_explainer"
      ? "premium stylized 3D educational explainer with cute feminine-styled anthropomorphic everyday objects"
      : resolvedCampaignMode === "mixed_media_relatable_pov"
        ? "mixed-media stylized 3D chibi avatar composited into photoreal real-world scenes, relatable comedic POV pacing"
      : resolvedCampaignMode === "static_photoreal_avatar_meme"
        ? "animated stylized 3D cartoon avatar in mostly static ultra-photoreal backgrounds, meme-style silent storytelling"
      : resolvedVideoType === "ugc"
        ? "ugc creator-style live-action"
        : resolvedVideoType === "ai_animation"
        ? "animated explainer with realistic motion and texture"
        : resolvedVideoType === "faceless_broll"
          ? "faceless b-roll educational live-action"
          : "hybrid social explainer";
  const veoReadySegments = campaignAdjustedSegments.map((segment, index, all) => ({
    ...segment,
    veoPrompt:
      resolvedCampaignMode === "widget_shock_hook_ugc"
        ? buildWidgetShockHookCompactVeoPrompt({
          segment,
          segmentIndex: index,
          appName,
        })
        : resolvedCampaignMode === "widget_late_period_reaction_hook_ugc"
          ? buildWidgetLatePeriodReactionHookVeoPrompt({
            segment,
          })
        : resolvedCampaignMode === "mixed_media_relatable_pov"
          ? buildMixedMediaRelatablePovVeoPrompt({
            segment,
            nextSegment: all[index + 1],
            appName,
            ugcCharacter,
          })
          : resolvedCampaignMode === "static_photoreal_avatar_meme"
            ? buildStaticPhotorealAvatarMemeVeoPrompt({
              segment,
              nextSegment: all[index + 1],
              appName,
              ugcCharacter,
            })
        : buildVeo31SegmentPrompt({
          segment,
          nextSegment: all[index + 1],
          styleHint: scriptAgentStyleHint,
          appName,
          ugcCharacter,
        }),
  }));

  const resolvedTopicCategory =
    resolvedCampaignMode === "daily_ugc_quran_journey"
      ? "islamic_period_pregnancy"
      : sanitizeScriptAgentTopicCategory(row.topicCategory);

  return {
    title: sanitizeString(row.title, `${appName} informational video plan`),
    objective: sanitizeString(
      row.objective,
      "Deliver practical, trustworthy education with a native app-support hook."
    ),
    campaignMode: resolvedCampaignMode,
    topicCategory: resolvedTopicCategory,
    selectedVideoType: resolvedVideoType,
    videoTypeReason: sanitizeString(
      row.videoTypeReason,
      "Selected to maximize clarity, retention, and execution speed for this topic."
    ),
    appHookStrategy: sanitizeString(
      row.appHookStrategy,
      "Introduce app support in one practical moment tied to the audience pain point."
    ),
    targetDurationSeconds: safeDurationSeconds,
    maxSingleClipDurationSeconds: MAX_SINGLE_VIDEO_CLIP_SECONDS,
    script: {
      hook: hookForPlan,
      beats: beatsForPlan,
      cta: ctaForPlan,
    },
    motionControlSegments: veoReadySegments,
    socialCaption: {
      caption: sanitizeString(
        isRecord(row.socialCaption) ? row.socialCaption.caption : "",
        "Save this guide and share it with someone who needs gentle, practical support."
      ),
      hashtags: sanitizeHashtagArray(
        isRecord(row.socialCaption) ? row.socialCaption.hashtags : [],
        8
      ).length
        ? sanitizeHashtagArray(isRecord(row.socialCaption) ? row.socialCaption.hashtags : [], 8)
        : ["#PeriodHealth", "#PregnancyCare", "#MuslimahWellness", "#WorshipSupport"],
    },
    productionSteps: sanitizeStringArray(row.productionSteps, 12),
    qaChecklist: sanitizeStringArray(row.qaChecklist, 12),
  };
}

type CycleDayQuranDetails = {
  surahName: string;
  verseStart: number;
  verseEnd: number;
  reference: string;
  verseMeaningSummary: string;
  revelationContext: string;
  relatedHadith: string;
  scholarlyInterpretation: string;
  keyTakeaway: string;
};

type CycleDayDailyStory = {
  morning: string;
  quranJourney: string;
  chores: string;
  lunch: string;
  salah: string;
  evening: string;
};

export interface CycleDayCalendarDay {
  dayNumber: number;
  calendarDate: string;
  cycleDay: number;
  isPeriodDay: boolean;
  isPurityAchieved: boolean;
  isIstihada: boolean;
  worshipStatus: string;
  quran: CycleDayQuranDetails;
  dailyStory: CycleDayDailyStory;
  plannedActions: string[];
  appHooks: string[];
}

export interface CycleDayCalendarPlan {
  title: string;
  overview: string;
  planNumber: number;
  cycleStartDate: string;
  cycleLengthDays: number;
  openingTemplate: string;
  quranOutroTemplate: string;
  days: CycleDayCalendarDay[];
}

interface BuildCycleDayCalendarPlanArgs {
  appName: string;
  appContext: string;
  planNumber: number;
  cycleStartDate?: string;
  cycleLengthDays?: number;
  reasoningModel?: ReasoningModel;
}

interface BuildCycleDayVideoScriptPlanArgs {
  appName: string;
  appContext: string;
  cyclePlanNumber: number;
  cycleDayData: CycleDayCalendarDay;
  targetDurationSeconds?: number | null;
  ugcCharacter?: UGCCharacterProfile | null;
  reasoningModel?: ReasoningModel;
}

function sanitizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const cleaned = value.trim().toLowerCase();
    if (["true", "yes", "1", "y"].includes(cleaned)) return true;
    if (["false", "no", "0", "n"].includes(cleaned)) return false;
  }
  return fallback;
}

function sanitizeInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return fallback;
}

function toIsoDate(value: unknown, fallbackDate: Date = new Date()): string {
  if (typeof value === "string") {
    const cleaned = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      const parsed = new Date(`${cleaned}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) return cleaned;
    }
    const parsed = new Date(cleaned);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getUTCFullYear();
      const month = `${parsed.getUTCMonth() + 1}`.padStart(2, "0");
      const day = `${parsed.getUTCDate()}`.padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }

  const year = fallbackDate.getUTCFullYear();
  const month = `${fallbackDate.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${fallbackDate.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToIsoDate(baseIsoDate: string, offsetDays: number): string {
  const base = new Date(`${baseIsoDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    return baseIsoDate;
  }
  const shifted = new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = `${shifted.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${shifted.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatIsoDateReadable(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function defaultQuranDetailsForDay(dayNumber: number): CycleDayQuranDetails {
  const surahs = [
    "Al-Fatihah",
    "Al-Baqarah",
    "Ali 'Imran",
    "An-Nisa",
    "Al-Ma'idah",
    "Al-An'am",
    "Al-A'raf",
    "Al-Anfal",
    "At-Tawbah",
    "Yunus",
    "Hud",
    "Yusuf",
    "Ar-Ra'd",
    "Ibrahim",
    "Al-Hijr",
    "An-Nahl",
    "Al-Isra",
    "Al-Kahf",
    "Maryam",
    "Ta-Ha",
    "Al-Anbiya",
    "Al-Hajj",
    "Al-Mu'minun",
    "An-Nur",
    "Al-Furqan",
    "Ash-Shu'ara",
    "An-Naml",
    "Al-Qasas",
    "Al-'Ankabut",
    "Ar-Rum",
  ];
  const surahName = surahs[(dayNumber - 1) % surahs.length];
  const verseStart = ((dayNumber - 1) % 20) * 5 + 1;
  const verseEnd = verseStart + 4;
  const reference = `Surah ${surahName} ${verseStart}-${verseEnd}`;

  return {
    surahName,
    verseStart,
    verseEnd,
    reference,
    verseMeaningSummary: "Include a quick 1-2 sentence plain-language summary of the meaning of these verses.",
    revelationContext: "Include whether these verses are generally classified as Meccan or Medinan and why that context matters.",
    relatedHadith: "Include one related hadith only if it is explicitly sahih (e.g., Sahih al-Bukhari, Sahih Muslim, or clearly graded sahih). If none is confidently sahih, return an empty string.",
    scholarlyInterpretation: "Include one concise interpretation from a trusted tafsir source such as Ibn Kathir, Al-Tabari, or Al-Qurtubi.",
    keyTakeaway: "Daily practice takeaway: one action point and one reflection question.",
  };
}

function coerceCycleDayQuranDetails(value: unknown, dayNumber: number): CycleDayQuranDetails {
  const row = isRecord(value) ? value : {};
  const defaults = defaultQuranDetailsForDay(dayNumber);
  const surahName = sanitizeString(row.surahName, defaults.surahName);
  const verseStart = Math.max(1, sanitizeInteger(row.verseStart, defaults.verseStart));
  const verseEnd = Math.max(verseStart, sanitizeInteger(row.verseEnd, defaults.verseEnd));
  const reference = sanitizeString(row.reference, `Surah ${surahName} ${verseStart}-${verseEnd}`);

  return {
    surahName,
    verseStart,
    verseEnd,
    reference,
    verseMeaningSummary: sanitizeString(row.verseMeaningSummary, defaults.verseMeaningSummary),
    revelationContext: sanitizeString(row.revelationContext, defaults.revelationContext),
    relatedHadith: sanitizeString(row.relatedHadith, defaults.relatedHadith),
    scholarlyInterpretation: sanitizeString(row.scholarlyInterpretation, defaults.scholarlyInterpretation),
    keyTakeaway: sanitizeString(row.keyTakeaway, defaults.keyTakeaway),
  };
}

function coerceCycleDayDailyStory(value: unknown, dayNumber: number): CycleDayDailyStory {
  const row = isRecord(value) ? value : {};

  return {
    morning: sanitizeString(row.morning, `Morning: review app status, begin with mindful dua, and set worship intention for cycle day ${dayNumber}.`),
    quranJourney: sanitizeString(row.quranJourney, "Quran journey: read assigned verses with brief reflection notes and one personal takeaway."),
    chores: sanitizeString(row.chores, "Daily responsibilities: household/work/study tasks with realistic time blocks and calm pacing."),
    lunch: sanitizeString(row.lunch, "Lunch: simple nourishing meal and hydration check, with gratitude reflection."),
    salah: sanitizeString(row.salah, "Salah check-ins: show prayer status from app before each relevant prayer moment."),
    evening: sanitizeString(row.evening, "Evening wrap: short recap, what went well, and preparation for tomorrow."),
  };
}

function defaultWorshipStatus(args: { isPeriodDay: boolean; isIstihada: boolean }): string {
  if (args.isPeriodDay) {
    return "Prayer paused, fasting paused; continue dhikr, dua, and Quran reflection mode in app.";
  }
  if (args.isIstihada) {
    return "Istihada support mode: prayer and fasting continue with hygiene guidance tracked in app.";
  }
  return "Prayer active, fasting active, and Quran reading active.";
}

function coerceCycleDayCalendarDay(value: unknown, dayNumber: number, fallbackDate: string): CycleDayCalendarDay {
  const row = isRecord(value) ? value : {};
  const resolvedDayNumber = Math.max(1, sanitizeInteger(row.dayNumber, dayNumber));
  const resolvedCycleDay = Math.max(1, sanitizeInteger(row.cycleDay, resolvedDayNumber));
  const isPeriodDay = sanitizeBoolean(row.isPeriodDay, resolvedDayNumber <= 6);
  const isPurityAchieved = isPeriodDay ? false : sanitizeBoolean(row.isPurityAchieved, resolvedDayNumber >= 7);
  const isIstihada = !isPeriodDay && sanitizeBoolean(row.isIstihada, false);
  const quran = coerceCycleDayQuranDetails(row.quran, resolvedDayNumber);
  const dailyStory = coerceCycleDayDailyStory(row.dailyStory, resolvedDayNumber);
  const plannedActions = sanitizeStringArray(row.plannedActions, 8);
  const appHooks = sanitizeStringArray(row.appHooks, 6);

  return {
    dayNumber: resolvedDayNumber,
    calendarDate: toIsoDate(row.calendarDate, new Date(`${fallbackDate}T00:00:00Z`)),
    cycleDay: resolvedCycleDay,
    isPeriodDay,
    isPurityAchieved,
    isIstihada,
    worshipStatus: sanitizeString(row.worshipStatus, defaultWorshipStatus({ isPeriodDay, isIstihada })),
    quran,
    dailyStory,
    plannedActions: plannedActions.length > 0
      ? plannedActions
      : [
        dailyStory.morning,
        dailyStory.quranJourney,
        dailyStory.chores,
        dailyStory.lunch,
        dailyStory.salah,
        dailyStory.evening,
      ].filter(Boolean),
    appHooks: appHooks.length > 0
      ? appHooks
      : [
        "Open app at start of day to confirm cycle day and worship status.",
        "Before prayer timing decisions, show app worship status card on-screen.",
        "Before Quran reading, show verse tracker and reading progress in app.",
      ],
  };
}

function ensureIstihadaCoverage(days: CycleDayCalendarDay[], planNumber: number): CycleDayCalendarDay[] {
  const cloned = days.map((day) => ({
    ...day,
    appHooks: [...day.appHooks],
    plannedActions: [...day.plannedActions],
  }));

  const baseTargetCount = cloned.length >= 30 ? 2 : 1;
  const existingIstihadaCount = cloned.filter((day) => day.isIstihada).length;

  if (existingIstihadaCount >= baseTargetCount) {
    return cloned.map((day) => ({
      ...day,
      isIstihada: day.isPeriodDay ? false : day.isIstihada,
    }));
  }

  const candidates = cloned.filter((day) => !day.isPeriodDay && day.dayNumber >= 9);
  const sortedCandidates = [...candidates].sort((left, right) => {
    const leftSeed = hashSeed(`${planNumber}:${left.dayNumber}`);
    const rightSeed = hashSeed(`${planNumber}:${right.dayNumber}`);
    return leftSeed - rightSeed;
  });

  const needed = Math.max(0, baseTargetCount - existingIstihadaCount);
  const selected = sortedCandidates.slice(0, needed).map((day) => day.dayNumber);

  return cloned.map((day) => {
    const shouldMarkIstihada = !day.isPeriodDay && (day.isIstihada || selected.includes(day.dayNumber));
    if (!shouldMarkIstihada) return day;

    const nextHooks = day.appHooks.some((item) => /istihada/i.test(item))
      ? day.appHooks
      : [...day.appHooks, "Highlight app istihada helper card and practical hygiene checklist."];

    return {
      ...day,
      isIstihada: true,
      worshipStatus: defaultWorshipStatus({ isPeriodDay: false, isIstihada: true }),
      appHooks: nextHooks,
    };
  });
}

export async function buildCycleDayCalendarPlan({
  appName,
  appContext,
  planNumber,
  cycleStartDate,
  cycleLengthDays = 30,
  reasoningModel = DEFAULT_REASONING_MODEL,
}: BuildCycleDayCalendarPlanArgs): Promise<CycleDayCalendarPlan> {
  requireGeminiKey();
  const model = genAI.getGenerativeModel({ model: reasoningModel });

  const resolvedPlanNumber = Math.max(1, Math.round(planNumber));
  const resolvedCycleLengthDays = clamp(Math.round(cycleLengthDays), 24, 40);
  const resolvedStartDate = toIsoDate(cycleStartDate);

  const prompt = `You are a senior Muslimah wellness content strategist.

TASK:
Create a full cycle-day content plan for a 3D animated daily video campaign with one recurring character.

APP CONTEXT:
- App name: ${appName}
- App context: ${appContext || "Cycle and worship support app for Muslim women."}

REQUIREMENTS:
- Plan number: ${resolvedPlanNumber}
- Cycle length days: ${resolvedCycleLengthDays}
- Cycle start date (ISO): ${resolvedStartDate}
- Build exactly ${resolvedCycleLengthDays} days, with sequential calendar dates.
- Include realistic period window and purity transition.
- Include 1-2 istihada days outside period days (distributed naturally).
- Every day must include: cycle day metadata, worship status, practical daily routine beats, and Quran verse assignment.
- Quran section per day must include:
  * verse reference,
  * quick plain-language meaning summary of the verses,
  * revelation context (Meccan/Medinan where relevant),
  * one related hadith only if it is sahih and verifiable,
  * one trusted scholarly interpretation,
  * one practical takeaway.
- Keep language clear, practical, and educational.

Return strict JSON only:
{
  "title": "string",
  "overview": "string",
  "days": [
    {
      "dayNumber": 1,
      "calendarDate": "${resolvedStartDate}",
      "cycleDay": 1,
      "isPeriodDay": true,
      "isPurityAchieved": false,
      "isIstihada": false,
      "worshipStatus": "string",
      "quran": {
        "surahName": "string",
        "verseStart": 1,
        "verseEnd": 5,
        "reference": "string",
        "verseMeaningSummary": "string",
        "revelationContext": "string",
        "relatedHadith": "string",
        "scholarlyInterpretation": "string",
        "keyTakeaway": "string"
      },
      "dailyStory": {
        "morning": "string",
        "quranJourney": "string",
        "chores": "string",
        "lunch": "string",
        "salah": "string",
        "evening": "string"
      },
      "plannedActions": ["string"],
      "appHooks": ["string"]
    }
  ]
}`;

  const result = await model.generateContent(prompt);
  const parsed = parseJsonFromModel(result.response.text());
  const row = isRecord(parsed) ? parsed : {};
  const daysRaw = Array.isArray(row.days) ? row.days : [];

  const byDayNumber = new Map<number, Record<string, unknown>>();
  for (const item of daysRaw) {
    if (!isRecord(item)) continue;
    const dayNumber = Math.max(1, sanitizeInteger(item.dayNumber, byDayNumber.size + 1));
    if (!byDayNumber.has(dayNumber)) {
      byDayNumber.set(dayNumber, item);
    }
  }

  const normalizedDays = Array.from({ length: resolvedCycleLengthDays }, (_, index) => {
    const dayNumber = index + 1;
    const fallbackDate = addDaysToIsoDate(resolvedStartDate, index);
    const source = byDayNumber.get(dayNumber) || daysRaw[index] || null;
    return coerceCycleDayCalendarDay(source, dayNumber, fallbackDate);
  });

  const daysWithIstihada = ensureIstihadaCoverage(normalizedDays, resolvedPlanNumber);

  return {
    title: sanitizeString(row.title, `Cycle Plan ${resolvedPlanNumber} - Daily UGC + Quran Journey`),
    overview: sanitizeString(
      row.overview,
      "Calendar-based daily storytelling plan that blends cycle-aware worship updates, practical routine beats, and end-of-day Quran deep dives."
    ),
    planNumber: resolvedPlanNumber,
    cycleStartDate: resolvedStartDate,
    cycleLengthDays: resolvedCycleLengthDays,
    openingTemplate: "Today is [calendar date], it's my cycle day [X], my worship status is [status].",
    quranOutroTemplate: "Before we end, here is today's verse context: when it was revealed, a related hadith, and one trusted scholar interpretation.",
    days: daysWithIstihada,
  };
}

type CycleDayDiaryPhase = "hook" | "morning" | "routine" | "meal" | "prayer" | "quran" | "outro";

type CycleDayDiaryBeatTemplate = {
  phase: CycleDayDiaryPhase;
  visual: string;
  narration: string;
  onScreenText: string;
  editNote: string;
};

function buildCycleAwareMealPlan(day: CycleDayCalendarDay): { breakfast: string; lunch: string } {
  if (day.isPeriodDay) {
    return {
      breakfast: "Warm iron-rich breakfast: dates, eggs, oats, and water for gentle period-day energy.",
      lunch: "Comforting lunch with lentils, greens, and protein to support recovery and reduce fatigue.",
    };
  }

  if (day.isIstihada) {
    return {
      breakfast: "Balanced breakfast with protein, fruit, and hydration to stay steady during istihada support days.",
      lunch: "Simple high-protein lunch with vegetables and water to keep energy stable through prayer windows.",
    };
  }

  return {
    breakfast: "Balanced cycle-day breakfast: protein, healthy fats, and fruit for stable energy.",
    lunch: "Nourishing lunch with whole foods and hydration to stay focused through the afternoon.",
  };
}

function buildQuranTeacherLines(day: CycleDayCalendarDay): {
  reflectionIntro: string;
  revelationExplanation: string;
  hadithScholarTakeaway: string;
} {
  const reference = cleanText(day.quran.reference) || `Surah ${day.quran.surahName} ${day.quran.verseStart}-${day.quran.verseEnd}`;
  const rawMeaningSummary = cleanText(day.quran.verseMeaningSummary);
  const rawContext = cleanText(day.quran.revelationContext);
  const rawHadith = cleanText(day.quran.relatedHadith);
  const rawScholar = cleanText(day.quran.scholarlyInterpretation);
  const rawTakeaway = cleanText(day.quran.keyTakeaway);

  const normalizedHadith = rawHadith.toLowerCase();
  const isSahihHadith =
    Boolean(rawHadith) &&
    !/^include\b/i.test(rawHadith) &&
    (/\bsahih\b/i.test(normalizedHadith) ||
      /\bbukhari\b/i.test(normalizedHadith) ||
      /\bmuslim\b/i.test(normalizedHadith) ||
      /\bmuttafaq\b/i.test(normalizedHadith));

  const meaningSummaryLine = !rawMeaningSummary || /^include\b/i.test(rawMeaningSummary)
    ? "In simple words, these verses remind us that Allah does not leave us in hardship and always opens a path of relief and hope."
    : closeOpenEndedLine(`In simple words, these verses mean: ${rawMeaningSummary}`);

  const revelationExplanation = (() => {
    if (!rawContext || /^include\b/i.test(rawContext)) {
      return "These verses were revealed in a context that calls the believer back to patience, trust, and steadiness in worship.";
    }
    if (/^meccan\.?$/i.test(rawContext)) {
      return "These verses were revealed in the Meccan period, when believers were being taught patience, hope, and complete trust in Allah during hardship.";
    }
    if (/^medinan\.?$/i.test(rawContext)) {
      return "These verses were revealed in the Medinan period, when the Muslim community was receiving practical guidance for worship and daily life.";
    }
    if (/\b(meccan|medinan)\b/i.test(rawContext)) {
      return closeOpenEndedLine(`These verses were revealed ${rawContext}`);
    }
    return closeOpenEndedLine(`These verses were revealed in this context: ${rawContext}`);
  })();

  const hadithLine = isSahihHadith
    ? closeOpenEndedLine(`A related sahih hadith says: ${rawHadith}`)
    : "";

  const scholarLine = !rawScholar || /^include\b/i.test(rawScholar)
    ? "Trusted scholars explain that these verses train the heart to remain hopeful and disciplined even in physically difficult days."
    : closeOpenEndedLine(`A trusted scholar explains: ${rawScholar}`);

  const takeawayLine = !rawTakeaway || /^daily practice takeaway|^include\b/i.test(rawTakeaway)
    ? "Today's takeaway: stay consistent with what is available to you today, and trust that Allah records sincere effort."
    : closeOpenEndedLine(`Today's practical takeaway: ${rawTakeaway}`);

  return {
    reflectionIntro: closeOpenEndedLine(`Before we close, the verses we are reflecting on today are ${reference}`),
    revelationExplanation: closeOpenEndedLine(`${meaningSummaryLine} ${revelationExplanation}`),
    hadithScholarTakeaway: closeOpenEndedLine(
      `${hadithLine || "No specific sahih hadith link is confirmed for today's verses, so we focus on the Quran meaning and trusted tafsir."} ${scholarLine} ${takeawayLine}`
    ),
  };
}

function buildCycleDayDiaryBeatTemplates(args: {
  appName: string;
  readableDate: string;
  day: CycleDayCalendarDay;
}): CycleDayDiaryBeatTemplate[] {
  const { appName, readableDate, day } = args;
  const meals = buildCycleAwareMealPlan(day);
  const quranTeacherLines = buildQuranTeacherLines(day);
  const isPrayerPausedDay = day.isPeriodDay;
  const isIstihadaDay = !day.isPeriodDay && day.isIstihada;
  const worshipShort =
    isPrayerPausedDay
      ? "my worship statuses are paused for today"
      : isIstihadaDay
        ? "my worship status is istihada support mode today"
        : "my worship statuses are active today";
  const appHookMorning = day.appHooks[0] || "Show app dashboard with cycle day and worship status.";
  const appHookPrayer = day.appHooks[1] || (isPrayerPausedDay
    ? "Before each prayer window, show app worship status as paused and continue with dhikr/dua routine."
    : "Before Dhuhr, check prayer status in app.");
  const appHookQuran = day.appHooks[2] || "Before Quran reflection, open verse tracker in app.";

  const fajrBeat = isPrayerPausedDay
    ? {
      visual: `3D animated dawn routine with ${appName} app open on worship-status card, tasbih and dua journal on desk, warm morning light.`,
      narration: "At Fajr time, I checked the app and my prayer status is paused today, so I did dhikr, dua, and morning adhkar.",
      onScreenText: "Fajr time check: prayer paused today",
      editNote: "No salah performance visuals on paused days; show practical worship-support alternatives with expressive animation.",
    }
    : isIstihadaDay
      ? {
        visual: `3D animated morning worship setup: ${appName} istihada guidance screen, wudu prep space, prayer mat ready, soft dawn light.`,
        narration: "I started at Fajr time by checking istihada guidance in the app, then I followed it and prayed with confidence.",
        onScreenText: "Fajr with istihada guidance",
        editNote: "Show app guidance first, then respectful prayer-ready continuity.",
      }
      : {
        visual: "3D animated morning prayer routine: wudu prep space, prayer mat setup, soft dawn light.",
        narration: "I started my day with Fajr salah, then made dua and set my intention for the day.",
        onScreenText: "Started with Fajr + dua",
        editNote: "Respectful modest framing and calm pace.",
      };

  const dhuhrBeat = isPrayerPausedDay
    ? {
      visual: `3D animated midday check-in with ${appName} showing paused worship status, character doing quiet dhikr reflection in a calm corner.`,
      narration: "Now it was Dhuhr time, so I checked the app again, saw prayer is paused today, and continued with dhikr and dua.",
      onScreenText: "Dhuhr check: paused status",
      editNote: appHookPrayer,
    }
    : isIstihadaDay
      ? {
        visual: `3D animated phone-in-hand shot checking ${appName} istihada support card before Dhuhr, then prayer-ready setup.`,
        narration: "By Dhuhr, I checked the app guidance again and followed it for my prayer routine.",
        onScreenText: "Dhuhr with istihada support",
        editNote: appHookPrayer,
      }
      : {
        visual: `3D animated phone-in-hand shot checking ${appName} before Dhuhr, then transitioning to prayer-ready setup.`,
        narration: "Now it was Dhuhr time, so I checked the app first and followed today's worship guidance.",
        onScreenText: "Dhuhr time check in app",
        editNote: appHookPrayer,
      };

  const eveningWorshipBeat = isPrayerPausedDay
    ? {
      visual: `3D animated late-afternoon to evening routine with ${appName} worship status card, journaling, and calm home atmosphere.`,
      narration: "In the evening, I checked the app once more and stayed consistent with dhikr, dua, and reflection.",
      onScreenText: "Evening worship-support routine",
      editNote: "Keep it practical and aligned with paused worship status.",
    }
    : isIstihadaDay
      ? {
        visual: "3D animated late-afternoon to evening transition with app check-ins and prayer-time preparation in a calm home setting.",
        narration: "I wrapped up my afternoon tasks, checked app guidance again, and moved through my evening worship routine.",
        onScreenText: "Evening routine + guided check",
        editNote: "Maintain continuity of istihada-support guidance before worship decisions.",
      }
      : {
        visual: "3D animated late-afternoon to evening transition with prayer-time reminders and calm home atmosphere.",
        narration: "I wrapped up my afternoon tasks, checked in again for prayer timing, and moved into my evening routine.",
        onScreenText: "Evening routine + prayer check",
        editNote: "Keep app hook subtle and useful before worship decisions.",
      };

  const quranIntroBeat = isPrayerPausedDay
    ? {
      visual: "3D animated teacher-to-camera Quran segment in her room at night: character facing camera with gentle hand gestures, closed Quran on desk, warm lamp glow, soft low-key soothing lighting.",
      narration: `${quranTeacherLines.reflectionIntro} I opened ${appName} in Quran reflection mode so we can go through them together.`,
      onScreenText: `${day.quran.reference} | Quran reflection mode`,
      editNote: `Transition into direct-to-camera teacher explanation mode. ${appHookQuran}`,
    }
    : {
      visual: "3D animated teacher-to-camera Quran segment in her room at night: character looking at camera like a teacher, closed Quran prop on desk, warm lamp-lit soothing scene.",
      narration: `${quranTeacherLines.reflectionIntro} I opened ${appName} so we can reflect on them step by step.`,
      onScreenText: `${day.quran.reference} | Quran reflection`,
      editNote: `Transition into direct-to-camera teacher explanation mode. ${appHookQuran}`,
    };

  return [
    {
      phase: "hook",
      visual: "Fast-paced cinematic 3D animated opening: character tying hijab, grabbing phone, and stepping into morning light.",
      narration: "Day in my life starts now.",
      onScreenText: "Day in my life",
      editNote: "Open with a strong visual hook and quick cut rhythm.",
    },
    {
      phase: "morning",
      visual: `3D animated close-up showing ${appName} daily dashboard with date and cycle status while character addresses camera.`,
      narration: `So today is ${readableDate}, it's my cycle day ${day.cycleDay}, and ${worshipShort}.`,
      onScreenText: `${readableDate} | Cycle day ${day.cycleDay} | ${day.worshipStatus}`,
      editNote: `Keep this as fixed intro line and show app UI clearly. ${appHookMorning}`,
    },
    {
      phase: "prayer",
      visual: fajrBeat.visual,
      narration: fajrBeat.narration,
      onScreenText: fajrBeat.onScreenText,
      editNote: fajrBeat.editNote,
    },
    {
      phase: "routine",
      visual: "3D animated home routine montage: making bed, tidy kitchen, preparing workspace, light household chores.",
      narration: closeOpenEndedLine(day.dailyStory.chores || "Then I moved into my morning chores and routine tasks."),
      onScreenText: "Morning chores and routine",
      editNote: "Keep this practical and relatable, not polished or ad-like.",
    },
    {
      phase: "meal",
      visual: "3D animated breakfast prep and table shot with warm kitchen ambiance.",
      narration: `For breakfast, I had ${meals.breakfast}`,
      onScreenText: "Cycle-day breakfast",
      editNote: "Show food clearly and keep portions realistic for daily life.",
    },
    {
      phase: "routine",
      visual: "3D animated midday productivity sequence: errands, study/work block, and quick home reset.",
      narration: "After breakfast, I handled more chores and focused on my main tasks for the day.",
      onScreenText: "More chores + focused work",
      editNote: "Maintain diary continuity and natural time progression.",
    },
    {
      phase: "prayer",
      visual: dhuhrBeat.visual,
      narration: dhuhrBeat.narration,
      onScreenText: dhuhrBeat.onScreenText,
      editNote: dhuhrBeat.editNote,
    },
    {
      phase: "meal",
      visual: "3D animated lunch scene: plated meal, water refill, quick gratitude pause before eating.",
      narration: `For lunch, I had ${meals.lunch}`,
      onScreenText: "Cycle-day lunch",
      editNote: "Keep this warm, grounded, and home-realistic.",
    },
    {
      phase: "routine",
      visual: "3D animated afternoon reset: curtains dimmed, short rest setup, then returning with refreshed energy.",
      narration: "Then I took a little afternoon nap, which is sunnah, and got back to my day feeling refreshed.",
      onScreenText: "Afternoon nap (sunnah)",
      editNote: "Gentle transition pacing and soft ambient sound bed.",
    },
    {
      phase: "prayer",
      visual: eveningWorshipBeat.visual,
      narration: eveningWorshipBeat.narration,
      onScreenText: eveningWorshipBeat.onScreenText,
      editNote: eveningWorshipBeat.editNote,
    },
    {
      phase: "quran",
      visual: quranIntroBeat.visual,
      narration: quranIntroBeat.narration,
      onScreenText: quranIntroBeat.onScreenText,
      editNote: quranIntroBeat.editNote,
    },
    {
      phase: "quran",
      visual: "3D animated character in her room at night looking at camera like a teacher, explaining verse context with clear hand gestures, closed Quran prop on desk, warm low-key soothing lighting.",
      narration: quranTeacherLines.revelationExplanation,
      onScreenText: "When these verses were revealed",
      editNote: "Teacher-to-camera delivery, clear pacing, and educational warmth.",
    },
    {
      phase: "quran",
      visual: "3D animated character still facing camera like a mentor in a calm night room setup, summarizing hadith connection and scholar interpretation with warm focused lighting.",
      narration: quranTeacherLines.hadithScholarTakeaway,
      onScreenText: "Hadith link + scholar tafsir + takeaway",
      editNote: "Keep direct-to-camera teacher style and practical tone.",
    },
    {
      phase: "outro",
      visual: "3D animated night close shot: character closing journal, soft smile to camera, lights dimming.",
      narration: "That was my cycle day diary today. See you tomorrow, inshaAllah.",
      onScreenText: "See you tomorrow, inshaAllah",
      editNote: "Close with warmth and continuity for next-day series retention.",
    },
  ];
}

function applyCycleDayNarrativeTemplate(args: {
  plan: VideoScriptIdeationPlan;
  appName: string;
  cyclePlanNumber: number;
  day: CycleDayCalendarDay;
}): VideoScriptIdeationPlan {
  const { plan, appName, cyclePlanNumber, day } = args;
  const readableDate = formatIsoDateReadable(day.calendarDate);
  const beatTemplates = buildCycleDayDiaryBeatTemplates({ appName, readableDate, day });
  const baseBeats: PlanBeat[] = beatTemplates.map((template) => ({
    timecode: "0:00-0:04",
    visual: closeOpenEndedLine(template.visual),
    narration: closeOpenEndedLine(template.narration),
    onScreenText: closeOpenEndedLine(template.onScreenText),
    editNote: closeOpenEndedLine(template.editNote),
  }));

  const normalizedBeats = normalizeBeatsToTargetDuration({
    beats: baseBeats,
    targetDurationSeconds: Math.max(45, Math.round(plan.targetDurationSeconds || 120)),
    minBeatCount: baseBeats.length,
    hook: baseBeats[0]?.narration || "Day in my life.",
  });

  const segmentSource = plan.motionControlSegments.length > 0
    ? plan.motionControlSegments
    : splitBeatsIntoShotGroups({
      beats: normalizedBeats,
      totalDurationSeconds: Math.max(45, Math.round(plan.targetDurationSeconds || 120)),
      maxSegmentSeconds: MAX_SINGLE_VIDEO_CLIP_SECONDS,
      hook: normalizedBeats[0]?.narration || "",
      cta: "See you tomorrow, inshaAllah.",
    });

  const mappedSegments = segmentSource.map((segment, index, all) => {
    const beatIndex = all.length <= 1
      ? 0
      : Math.round((index / (all.length - 1)) * (normalizedBeats.length - 1));
    const beat = normalizedBeats[Math.max(0, Math.min(normalizedBeats.length - 1, beatIndex))] || normalizedBeats[0];
    const template = beatTemplates[Math.max(0, Math.min(beatTemplates.length - 1, beatIndex))] || beatTemplates[0];
    const isQuranPhase = template.phase === "quran";
    const generationType: MultiShotPrompt["generationType"] = "base_ai_video";
    const promptText = cleanText([
      beat.visual,
      `Narration intent: ${beat.narration}`,
      `On-screen text direction: ${beat.onScreenText}`,
      isQuranPhase
        ? "3D animated teacher-to-camera explanation, warm mentor energy, clear hand gestures, and direct eye contact to camera."
        : "3D animated day-in-the-life storytelling, expressive but grounded performance, cinematic pacing.",
      "Vertical 9:16, stylized 3D animation quality, coherent continuity, no visual artifacts.",
    ].join(" "));

    return {
      ...segment,
      startFramePrompt: beat.visual,
      script: {
        hook: index === 0 ? beat.narration : "",
        shots: [
          {
            shotId: "shot1",
            visual: beat.visual,
            narration: beat.narration,
            onScreenText: beat.onScreenText,
            editNote: beat.editNote,
          },
        ],
        cta: index === all.length - 1 ? "See you tomorrow, inshaAllah." : "",
      },
      multiShotPrompts: [
        {
          shotId: `group${segment.segmentId}_shot1`,
          generationType,
          scene: beat.visual,
          prompt: enforceKlingPromptWordLimit(
            ensureHiggsfieldPromptHasPerformanceInstruction(promptText),
            77
          ),
          shotDuration: `${Math.max(2, Math.round(segment.durationSeconds || MAX_SINGLE_VIDEO_CLIP_SECONDS))}s`,
        },
      ],
    };
  });

  const transitionReadySegments = enforceSegmentBoundaryTransitions(mappedSegments);
  const campaignAdjustedSegments = enforceDailyUgcQuranJourneyPattern(transitionReadySegments, appName);
  const styleHint = "stylized 3D animated social explainer";
  const veoReadySegments = campaignAdjustedSegments.map((segment, index, all) => ({
    ...segment,
    veoPrompt: buildVeo31SegmentPrompt({
      segment,
      nextSegment: all[index + 1],
      styleHint,
      appName,
    }),
  }));

  const openingLine = closeOpenEndedLine(
    `So today is ${readableDate}, it's my cycle day ${day.cycleDay}, and ${day.isPeriodDay ? "my worship statuses are paused for today" : day.isIstihada ? "my worship status is istihada support mode today" : "my worship statuses are active today"}`
  );

  return {
    ...plan,
    title: `Cycle Plan ${cyclePlanNumber} - Day ${day.cycleDay} 3D Day-in-the-Life + Quran Reflection`,
    objective: cleanText(
      `Coherent 3D animated day-in-the-life episode for cycle day ${day.cycleDay}: hook, worship-aware routine, meal moments, app check-ins, teacher-style Quran reflection, then tomorrow hook.`
    ),
    appHookStrategy: "Show app at morning status check, prayer-status decision moments, and Quran reflection start while keeping story fun and coherent.",
    script: {
      hook: openingLine,
      beats: normalizedBeats,
      cta: "See you tomorrow, inshaAllah.",
    },
    motionControlSegments: veoReadySegments,
    socialCaption: {
      caption: closeOpenEndedLine(
        `Cycle day ${day.cycleDay} 3D day-in-the-life: worship check-ins, daily routine, and teacher-style ${day.quran.reference} reflection. See you tomorrow, inshaAllah.`
      ),
      hashtags: [
        "#3DAnimation",
        "#DayInTheLife",
        "#CycleDayDiary",
        "#MuslimahRoutine",
        "#QuranReflection",
        "#WorshipSupport",
      ],
    },
  };
}

export async function buildCycleDayVideoScriptPlan({
  appName,
  appContext,
  cyclePlanNumber,
  cycleDayData,
  targetDurationSeconds,
  ugcCharacter,
  reasoningModel = DEFAULT_REASONING_MODEL,
}: BuildCycleDayVideoScriptPlanArgs): Promise<VideoScriptIdeationPlan> {
  const day = coerceCycleDayCalendarDay(
    cycleDayData,
    Math.max(1, cycleDayData.dayNumber || 1),
    toIsoDate(cycleDayData.calendarDate)
  );

  const suggestedDuration = targetDurationSeconds && Number.isFinite(targetDurationSeconds)
    ? Math.max(45, Math.round(targetDurationSeconds))
    : day.isIstihada
      ? 150
      : day.isPeriodDay
        ? 130
        : 140;

  const topicBrief = cleanText([
    `Cycle plan number: ${cyclePlanNumber}.`,
    `Cycle day: ${day.cycleDay}.`,
    `Calendar date: ${day.calendarDate}.`,
    `Fixed day-in-the-life intro should include: cycle day ${day.cycleDay} and worship status for today.`,
    `Worship status for this day: ${day.worshipStatus}.`,
    `Period day: ${day.isPeriodDay ? "yes" : "no"}.`,
    `Purity achieved: ${day.isPurityAchieved ? "yes" : "no"}.`,
    `Istihada: ${day.isIstihada ? "yes" : "no"}.`,
    `Daily actions: ${day.plannedActions.join(" ")}.`,
    `App hook moments: ${day.appHooks.join(" ")}.`,
    `Quran assignment: ${day.quran.reference}.`,
    `Quick verse meaning summary: ${day.quran.verseMeaningSummary}.`,
    `Revelation context: ${day.quran.revelationContext}.`,
    `Related hadith: ${day.quran.relatedHadith}.`,
    "Hadith rule: mention a hadith only if it is sahih and clearly verifiable; otherwise skip hadith claim and focus on verse meaning + tafsir.",
    `Scholar interpretation: ${day.quran.scholarlyInterpretation}.`,
    `Key takeaway: ${day.quran.keyTakeaway}.`,
    "Narrative sequence must be coherent and chronological like a real day-in-the-life vlog.",
    day.isPeriodDay
      ? "Sequence: cool visual hook -> cycle day + worship status intro -> fajr-time paused-status check with dhikr/dua -> chores -> breakfast -> chores/work -> dhuhr-time paused-status check -> lunch -> afternoon nap (sunnah) -> evening worship-support routine -> Quran reflection segments -> see you tomorrow close."
      : day.isIstihada
        ? "Sequence: cool visual hook -> cycle day + worship status intro -> fajr with istihada app guidance -> chores -> breakfast -> chores/work -> dhuhr app-guided check -> lunch -> afternoon nap (sunnah) -> evening worship routine with guidance -> Quran reflection segments -> see you tomorrow close."
        : "Sequence: cool visual hook -> cycle day + worship status intro -> fajr salah -> chores -> breakfast -> chores/work -> dhuhr check -> lunch -> afternoon nap (sunnah) -> evening routine -> Quran reflection segments -> see you tomorrow close.",
    day.isPeriodDay
      ? "Use app hooks naturally at worship-status checks and Quran-start moment; do not include salah performance visuals on paused days."
      : "Use app hooks naturally at worship status check, prayer-time decisions, and Quran-start moment.",
    "Video structure must be 3D animated from start to end with one recurring animated character.",
    "Quran reflection segments must be teacher-style: character looking into camera and explaining clearly.",
    "If Quran prop appears in frame, keep it closed (cover visible), not open.",
    "Ending should include a detailed verse recap with revelation timing, hadith link, scholar insight, and see-you-tomorrow outro.",
  ].join(" "));

  const basePlan = await buildVideoScriptIdeationPlan({
    appName,
    appContext,
    topicBrief,
    targetDurationSeconds: suggestedDuration,
    preferredVideoType: "ai_animation",
    campaignMode: "daily_ugc_quran_journey",
    ugcCharacter,
    reasoningModel,
  });

  return applyCycleDayNarrativeTemplate({
    plan: basePlan,
    appName,
    cyclePlanNumber,
    day,
  });
}
