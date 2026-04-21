"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  Clapperboard,
  Copy,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
  VideoIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  PanOnScrollMode,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/modal";
import {
  DEFAULT_REASONING_MODEL,
  REASONING_MODELS,
  isReasoningModel,
  type ReasoningModel,
} from "@/lib/reasoning-model";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  IMAGE_GENERATION_MODELS,
  isImageGenerationModel,
  type ImageGenerationModel,
} from "@/lib/image-generation-model";

type LibraryVideo = {
  id: string;
  format_id: string;
  source_url: string;
  platform: string;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  user_notes: string | null;
  analysis_confidence: number | null;
  analysis_payload?: Record<string, unknown> | null;
  created_at: string;
};

type LibraryFormat = {
  id: string;
  format_name: string;
  format_type: string;
  format_signature: string;
  summary: string;
  hook_patterns: string[];
  shot_pattern: string[];
  editing_style: string[];
  source_count: number;
  videos: LibraryVideo[];
};

type FormatsResponse = {
  formats?: LibraryFormat[];
  error?: string;
};

type PlanBeat = {
  timecode: string;
  visual: string;
  narration: string;
  onScreenText: string;
  editNote: string;
};

type SegmentScriptShot = {
  shotId?: string;
  visual: string;
  narration: string;
  onScreenText: string;
  editNote: string;
};

type HiggsfieldPrompt = {
  shotId?: string;
  generationType?: string;
  scene: string;
  prompt: string;
  shotDuration?: string;
};

type VideoStartFrame = {
  imageUrl?: string;
  prompt?: string;
  generatedAt?: string;
  characterId?: string | null;
  imageModel?: string;
};

type PlanScriptCharacter = {
  id: string;
  key?: string;
  name: string;
  role?: string;
  visualIdentityPrompt?: string;
  styleNotes?: string;
  imageUrl: string;
  segmentIds?: number[];
};

type PlanScriptCharacters = {
  generatedAt?: string;
  imageModel?: string;
  characters?: PlanScriptCharacter[];
  segmentCharacterMap?: Array<{
    segmentId: number;
    characterIds: string[];
  }>;
};

type VideoPlan = {
  title: string;
  strategy: string;
  objective: string;
  klingMotionControlOnly?: boolean;
  contentClassification?: {
    category?: string;
    confidence?: number;
    reason?: string;
  };
  maxSingleClipDurationSeconds?: number;
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
  socialCaption?: {
    caption?: string;
    hashtags?: string[];
  };
  seedanceSinglePrompt?: {
    model?: string;
    prompt?: string;
    targetDuration?: string;
  };
  startFrame?: VideoStartFrame;
  scriptCharacters?: PlanScriptCharacters;
  motionControlSegments?: {
    segmentId: number;
    timecode: string;
    durationSeconds: number;
    startFramePrompt: string;
    characterReferenceIds?: string[];
    script?: {
      hook?: string;
      shots?: SegmentScriptShot[];
      cta?: string;
    };
    veoPrompt?: string;
    multiShotPrompts?: HiggsfieldPrompt[];
    startFrame?: VideoStartFrame;
  }[];
  higgsfieldPrompts?: HiggsfieldPrompt[];
  finalCutProSteps?: string[];
  productionSteps: string[];
  editingTimeline: string[];
  assetsChecklist: string[];
  qaChecklist: string[];
};

type RecreateResponse = {
  plan?: VideoPlan;
  error?: string;
};

type StartFrameResponse = {
  startFrame?: VideoStartFrame;
  plan?: VideoPlan;
  error?: string;
};

type ScriptCharactersResponse = {
  plan?: VideoPlan;
  scriptCharacters?: PlanScriptCharacters;
  generatedCount?: number;
  warnings?: string[];
  error?: string;
};

type ScriptAgentVideoType = "auto" | "ugc" | "ai_animation" | "faceless_broll" | "hybrid";
type ScriptAgentCampaignMode =
  | "standard"
  | "widget_reaction_ugc"
  | "widget_shock_hook_ugc"
  | "ugc_shocking_fact_reaction"
  | "widget_late_period_reaction_hook_ugc"
  | "ai_objects_educational_explainer"
  | "mixed_media_relatable_pov"
  | "daily_ugc_quran_journey";
type ScriptAgentSelectableCampaignMode =
  | "standard"
  | "widget_reaction_ugc"
  | "widget_shock_hook_ugc"
  | "ugc_shocking_fact_reaction"
  | "widget_late_period_reaction_hook_ugc"
  | "ai_objects_educational_explainer"
  | "mixed_media_relatable_pov";

type ScriptAgentPlan = {
  title: string;
  objective: string;
  campaignMode?: ScriptAgentCampaignMode;
  topicCategory: "period_pregnancy" | "islamic_period_pregnancy";
  selectedVideoType: "ugc" | "ai_animation" | "faceless_broll" | "hybrid";
  videoTypeReason: string;
  appHookStrategy: string;
  targetDurationSeconds: number;
  maxSingleClipDurationSeconds: number;
  script: {
    hook: string;
    beats: PlanBeat[];
    cta: string;
  };
  motionControlSegments: {
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
    multiShotPrompts?: HiggsfieldPrompt[];
  }[];
  socialCaption: {
    caption: string;
    hashtags: string[];
  };
  productionSteps: string[];
  qaChecklist: string[];
};

type ScriptAgentResponse = {
  plan?: ScriptAgentPlan;
  saved?: {
    formatId?: string;
    sourceVideoId?: string;
    planId?: string;
  };
  error?: string;
};

type CycleDayPlanSummary = {
  id: string;
  planNumber: number;
  appName: string;
  cycleStartDate: string;
  cycleLengthDays: number;
  title: string;
  overview: string;
  openingTemplate: string;
  quranOutroTemplate: string;
  days: {
    dayNumber: number;
    calendarDate: string;
    cycleDay: number;
    isPeriodDay: boolean;
    isPurityAchieved: boolean;
    isIstihada: boolean;
    worshipStatus: string;
    quranReference: string;
  }[];
  createdAt: string;
  updatedAt: string;
};

type CycleDayPlansResponse = {
  plans?: CycleDayPlanSummary[];
  warning?: string;
  error?: string;
};

type CycleDayPlanCreateResponse = {
  plan?: {
    planNumber: number;
    cycleStartDate: string;
    cycleLengthDays: number;
  };
  saved?: {
    id?: string;
    createdAt?: string;
  };
  error?: string;
};

type CycleDayAgentResponse = {
  plan?: ScriptAgentPlan;
  cycleContext?: {
    cyclePlanId?: string;
    cyclePlanNumber?: number;
    cycleDayNumber?: number;
  };
  saved?: {
    formatId?: string;
    sourceVideoId?: string;
    planId?: string;
  };
  error?: string;
};

type IslamicSeriesTopic = {
  id: string;
  title: string;
  phase: "foundations" | "practical" | "madhab" | "advanced";
  learningGoal: string;
  keyPoints: string[];
  certaintyTags: Array<"ijma" | "majority" | "disputed">;
  sourceNotes: string[];
};

type IslamicSeriesKnowledge = {
  seriesId: string;
  title: string;
  targetDurationSeconds: number;
  style: string;
  sequencingRule: string;
  methodology: string[];
  sourceFiles: string[];
  quranReferences: string[];
  hadithReferences: string[];
  madhabReferenceSummary: string[];
  scriptGuardrails: string[];
  topics: IslamicSeriesTopic[];
};

type IslamicSeriesSavedPlanSummary = {
  id: string;
  planNumber: number;
  episodeId: string;
  episodeTitle: string;
  phase: string;
  targetDurationSeconds: number;
  reasoningModel?: string;
  customFocus?: string;
  formatId?: string;
  sourceVideoId?: string;
  recreationPlanId?: string;
  createdAt: string;
  updatedAt: string;
};

type IslamicSeriesMetaResponse = {
  series?: IslamicSeriesKnowledge;
  documentationPath?: string;
  savedPlans?: IslamicSeriesSavedPlanSummary[];
  warning?: string;
  error?: string;
};

type IslamicSeriesAgentResponse = {
  episode?: IslamicSeriesTopic;
  plan?: ScriptAgentPlan;
  saved?: {
    seriesPlanId?: string;
    planNumber?: number;
    formatId?: string;
    sourceVideoId?: string;
    planId?: string;
    createdAt?: string;
  };
  error?: string;
};

type SavedPlan = {
  id: string;
  source_video_id: string;
  format_id: string;
  reasoningModel?: string;
  generatedAt?: string;
  created_at: string;
  plan: VideoPlan;
};

type PlansResponse = {
  plans?: SavedPlan[];
  error?: string;
};

type UgcCharacter = {
  id: string;
  characterName: string;
  personaSummary: string;
  imageModel: string | null;
  characterType?: "ugc" | "animated";
  isDefault?: boolean;
};

type CharacterResponse = {
  characters?: UgcCharacter[];
  character?: UgcCharacter | null;
  error?: string;
};

type FormatNodeData = {
  format: LibraryFormat;
  selectedFormatId: string | null;
  onSelect: (formatId: string) => void;
};

type VideoNodeData = {
  formatId: string;
  formatName: string;
  formatType: string;
  video: LibraryVideo;
  ratio: number;
  selectedVideoId: string | null;
  playingVideoId: string | null;
  directMediaUrl: string | null;
  reasoningModel: ReasoningModel;
  onReasoningModelChange: (value: string) => void;
  useMotionControl: boolean;
  onUseMotionControlChange: (value: boolean) => void;
  useKlingMotionControl: boolean;
  onUseKlingMotionControlChange: (value: boolean) => void;
  startFrameImageModel: ImageGenerationModel;
  onStartFrameImageModelChange: (value: string) => void;
  isLoadingCharacters: boolean;
  ugcCharacters: UgcCharacter[];
  selectedUgcCharacterId: string | null;
  onCharacterChange: (characterId: string | null) => void;
  onOpenCharacterStudio: () => void;
  onGeneratePlan: (formatId: string, videoId: string) => void;
  onDeleteVideo: (formatId: string, videoId: string) => void;
  isGeneratingPlan: boolean;
  isDeletingVideo: boolean;
  onGenerateStartFrame: (formatId: string, videoId: string, segmentIndex?: number) => void;
  onGenerateAllSegmentStartFrames: (formatId: string, videoId: string) => void;
  onGenerateScriptCharacters: (formatId: string, videoId: string) => void;
  isGeneratingStartFrame: boolean;
  isGeneratingScriptCharacters: boolean;
  generatingSegmentIndex?: number;
  onUploadPreviousSegmentVideo: (
    formatId: string,
    videoId: string,
    segmentIndex: number,
    file: File
  ) => void;
  isUploadingPreviousSegmentVideo: boolean;
  uploadingPreviousSegmentIndex?: number;
  plan: VideoPlan | null;
  hasR2Url: boolean;
  isRefreshingR2: boolean;
  onRefreshR2: (videoId: string) => void;
  error: string;
  success: string;
  onSelect: (formatId: string, videoId: string) => void;
  onPlay: (formatId: string, videoId: string) => void;
  onOpen: (url: string) => void;
  onDownload: (url: string, title: string | null) => void;
  onAspect: (videoId: string, ratio: number) => void;
};

type FormatTypeNodeData = {
  formatType: string;
  formatCount: number;
  expandedType: string | null;
  selectedType: string | null;
  onToggleType: (type: string) => void;
};

function formatTypeVariant(type: string): "default" | "video" | "success" {
  if (type === "ugc") return "video";
  if (type === "ai_video") return "success";
  return "default";
}

function clampAspectRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 9 / 16;
  return Math.max(0.45, Math.min(2.2, value));
}

function getVideoFormatAnalysis(video: LibraryVideo): Record<string, unknown> | null {
  const payload = video.analysis_payload;
  if (!payload || typeof payload !== "object") return null;
  const formatAnalysis = (payload as Record<string, unknown>).formatAnalysis;
  if (!formatAnalysis || typeof formatAnalysis !== "object") return null;
  return formatAnalysis as Record<string, unknown>;
}

function getVideoR2Url(video: LibraryVideo): string | null {
  const analysis = getVideoFormatAnalysis(video);
  const r2Url = analysis?.r2VideoUrl;
  return typeof r2Url === "string" && r2Url.trim().length > 0 ? r2Url : null;
}

function getVideoDirectMediaUrl(video: LibraryVideo): string | null {
  // Prefer permanent R2 URL over ephemeral CDN URL
  const r2Url = getVideoR2Url(video);
  if (r2Url) return r2Url;

  const analysis = getVideoFormatAnalysis(video);
  const url = analysis?.directMediaUrl;
  return typeof url === "string" && url.trim().length > 0 ? url : null;
}

function getVideoSourceDurationSeconds(video: LibraryVideo): number | null {
  const payload = video.analysis_payload;
  if (!payload || typeof payload !== "object") return null;

  const root = payload as Record<string, unknown>;
  const sourceMetadata =
    root.sourceMetadata && typeof root.sourceMetadata === "object"
      ? (root.sourceMetadata as Record<string, unknown>)
      : null;
  const formatAnalysis =
    root.formatAnalysis && typeof root.formatAnalysis === "object"
      ? (root.formatAnalysis as Record<string, unknown>)
      : null;

  const sourceDuration = sourceMetadata?.sourceDurationSeconds;
  if (typeof sourceDuration === "number" && Number.isFinite(sourceDuration) && sourceDuration > 0) {
    return sourceDuration;
  }

  const formatDuration = formatAnalysis?.sourceDurationSeconds;
  if (typeof formatDuration === "number" && Number.isFinite(formatDuration) && formatDuration > 0) {
    return formatDuration;
  }

  return null;
}

function formatDurationLabel(seconds: number | null): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "unknown";
  }

  const rounded = Math.round(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

async function extractLastFrameDataUrlFromVideo(file: File): Promise<{
  dataUrl: string;
  durationSeconds: number;
  seekTimeSeconds: number;
}> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");

  try {
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Failed to read uploaded video metadata."));
    });

    const durationSeconds = Number.isFinite(video.duration) ? video.duration : 0;
    if (durationSeconds <= 0) {
      throw new Error("Uploaded video has invalid duration.");
    }

    const seekTimeSeconds = Math.max(0, durationSeconds - 0.08);

    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("Failed to seek uploaded video to final frame."));
      video.currentTime = seekTimeSeconds;
    });

    const sourceWidth = video.videoWidth || 1080;
    const sourceHeight = video.videoHeight || 1920;
    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const targetWidth = Math.max(2, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(2, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to initialize canvas context for frame extraction.");
    }

    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    if (!dataUrl || !dataUrl.startsWith("data:image/")) {
      throw new Error("Failed to extract final frame from uploaded video.");
    }

    return {
      dataUrl,
      durationSeconds,
      seekTimeSeconds,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function inferVideoExtension(url: string): string {
  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split("/").pop() || "";
    const ext = filename.includes(".") ? filename.split(".").pop() || "" : "";
    const normalized = ext.toLowerCase();
    if (["mp4", "mov", "webm", "m4v"].includes(normalized)) return normalized;
  } catch {
    // ignore
  }
  return "mp4";
}

function toSafeVideoFilename(title: string | null, ext: string): string {
  const base = (title || "video")
    .trim()
    .replace(/[^a-zA-Z0-9-_\s]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
  return `${base || "video"}.${ext}`;
}

function FormatCanvasNode({ data }: NodeProps<Node<FormatNodeData>>) {
  const isSelected = data.selectedFormatId === data.format.id;

  return (
    <div className={`min-w-[250px] rounded-2xl border bg-white px-3 py-2 shadow-sm ${isSelected ? "border-rose-300" : "border-slate-200"}`}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-violet-300" />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-violet-300" />

      <button type="button" onClick={() => data.onSelect(data.format.id)} className="nodrag flex w-full items-center justify-between gap-2 text-left">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{data.format.format_name}</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={formatTypeVariant(data.format.format_type)}>{data.format.format_type}</Badge>
            <Badge variant="default">{data.format.videos.length} videos</Badge>
          </div>
        </div>
      </button>
    </div>
  );
}

function VideoCanvasNode({ data }: NodeProps<Node<VideoNodeData>>) {
  const isSelected = data.selectedVideoId === data.video.id;
  const isPlaying = data.directMediaUrl && data.playingVideoId === data.video.id;
  const plan = data.plan;
  const r2PreviewUrl = getVideoR2Url(data.video);
  const sourceDurationSeconds = getVideoSourceDurationSeconds(data.video);
  const sourceDurationLabel = formatDurationLabel(sourceDurationSeconds);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [previewFrameFailed, setPreviewFrameFailed] = useState(false);
  const [copiedVeoSegmentId, setCopiedVeoSegmentId] = useState<number | null>(null);

  const handleCopyVeoPrompt = useCallback(async (segmentId: number, prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedVeoSegmentId(segmentId);
      window.setTimeout(() => {
        setCopiedVeoSegmentId((current) => (current === segmentId ? null : current));
      }, 1800);
    } catch {
      setCopiedVeoSegmentId(null);
    }
  }, []);

  return (
    <div className={`w-[260px] rounded-2xl border bg-white p-2.5 shadow-sm ${isSelected ? "border-rose-300 ring-2 ring-rose-100" : "border-slate-200"}`}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-violet-300" />

      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          data.onSelect(data.formatId, data.video.id);
          if (data.directMediaUrl) data.onPlay(data.formatId, data.video.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            data.onSelect(data.formatId, data.video.id);
            if (data.directMediaUrl) data.onPlay(data.formatId, data.video.id);
          }
        }}
        className="nodrag cursor-pointer"
      >
        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100" style={{ aspectRatio: data.ratio }}>
          {isPlaying && data.directMediaUrl ? (
            <video
              key={`${data.video.id}-node`}
              src={data.directMediaUrl}
              controls
              autoPlay
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
              onLoadedMetadata={(event) => {
                const target = event.currentTarget;
                if (target.videoWidth > 0 && target.videoHeight > 0) {
                  data.onAspect(data.video.id, target.videoWidth / target.videoHeight);
                }
              }}
            />
          ) : r2PreviewUrl && !previewFrameFailed ? (
            <video
              key={`${data.video.id}-preview`}
              src={r2PreviewUrl}
              muted
              playsInline
              preload="auto"
              className="h-full w-full object-cover"
              onLoadedMetadata={(event) => {
                const target = event.currentTarget;
                if (target.videoWidth > 0 && target.videoHeight > 0) {
                  data.onAspect(data.video.id, target.videoWidth / target.videoHeight);
                }
              }}
              onLoadedData={(event) => {
                const target = event.currentTarget;
                try {
                  target.currentTime = 0.01;
                  target.pause();
                } catch {
                  // no-op
                }
              }}
              onError={() => setPreviewFrameFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500">
              <Clapperboard className="h-6 w-6" />
              <span className="px-2 text-center text-[10px] font-medium text-slate-500">
                {getVideoR2Url(data.video)
                  ? "R2 first-frame preview unavailable"
                  : "R2 video not ready yet"}
              </span>
            </div>
          )}

          {data.directMediaUrl && !isPlaying ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
              <div className="rounded-full bg-black/55 p-2 text-white">
                <Play className="h-4 w-4" />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <p className="mt-1.5 truncate text-xs font-semibold text-slate-800">{data.video.title || "Untitled source"}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="truncate text-[11px] text-slate-500">{data.video.platform}</p>
        <div className="flex items-center gap-1">
          <Badge variant="default">{`Source ${sourceDurationLabel}`}</Badge>
          {plan ? <Badge variant="success">Plan Ready</Badge> : null}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        {data.directMediaUrl ? (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                data.onSelect(data.formatId, data.video.id);
                data.onPlay(data.formatId, data.video.id);
              }}
              className="nodrag"
            >
              <Play className="mr-1 h-3.5 w-3.5" />
              Play
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => data.onDownload(data.directMediaUrl || "", data.video.title)}
              className="nodrag"
              title="Download video"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : <span />}

        <div className="flex items-center gap-0.5">
          {!data.hasR2Url ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => data.onRefreshR2(data.video.id)}
              isLoading={data.isRefreshingR2}
              className="nodrag"
              title="Download video to R2 for permanent playback"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${data.isRefreshingR2 ? "animate-spin" : ""}`} />
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => data.onOpen(data.video.source_url)} className="nodrag">
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Open
          </Button>
        </div>
      </div>

      {/* Expanded controls section */}
      <div
        className={`nodrag overflow-hidden transition-all duration-300 ease-out ${isSelected ? "mt-2 max-h-[800px] opacity-100" : "max-h-0 opacity-0"
          }`}
      >
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <select
            value={data.reasoningModel}
            onChange={(event) => data.onReasoningModelChange(event.target.value)}
            className="nodrag w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
          >
            {REASONING_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>

          <select
            value={data.startFrameImageModel}
            onChange={(event) => data.onStartFrameImageModelChange(event.target.value)}
            className="nodrag w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
          >
            {IMAGE_GENERATION_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {`Start Frame: ${model.label}`}
              </option>
            ))}
          </select>

          {data.formatType === "ugc" ? (
            <>
              {(() => {
                const ugcOnlyCharacters = data.ugcCharacters.filter(
                  (character) => (character.characterType || "ugc") === "ugc"
                );
                return (
              <select
                value={data.selectedUgcCharacterId || ""}
                onChange={(event) => data.onCharacterChange(event.target.value || null)}
                disabled={data.isLoadingCharacters}
                className="nodrag w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
              >
                <option value="">{data.isLoadingCharacters ? "Loading characters..." : "Select UGC character"}</option>
                {ugcOnlyCharacters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.characterName}
                    {character.isDefault ? " (Default)" : ""}
                  </option>
                ))}
              </select>
                );
              })()}

              <Button variant="outline" size="sm" onClick={data.onOpenCharacterStudio} className="nodrag w-full">
                <Users className="mr-1 h-3.5 w-3.5" />
                Character Studio
              </Button>
            </>
          ) : null}

          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id={`motion-control-${data.video.id}`}
              checked={data.useMotionControl}
              disabled={data.useKlingMotionControl}
              onChange={(e) => data.onUseMotionControlChange(e.target.checked)}
              className="nodrag h-3.5 w-3.5 rounded border-slate-300 text-rose-500 focus:ring-rose-400"
            />
            <label
              htmlFor={`motion-control-${data.video.id}`}
              className="text-xs font-medium text-slate-700"
            >
              Enable shot grouping (8s max)
            </label>
          </div>

          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id={`kling-motion-control-${data.video.id}`}
              checked={data.useKlingMotionControl}
              onChange={(e) => data.onUseKlingMotionControlChange(e.target.checked)}
              className="nodrag h-3.5 w-3.5 rounded border-slate-300 text-rose-500 focus:ring-rose-400"
            />
            <label
              htmlFor={`kling-motion-control-${data.video.id}`}
              className="text-xs font-medium text-slate-700"
            >
              Kling motion control (start-frame only)
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              size="sm"
              className="nodrag w-full"
              onClick={() => data.onGeneratePlan(data.formatId, data.video.id)}
              isLoading={data.isGeneratingPlan}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {data.isGeneratingPlan ? "Generating..." : plan ? "Regenerate Plan" : "Generate Plan"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="nodrag w-full"
              onClick={() => data.onDeleteVideo(data.formatId, data.video.id)}
              isLoading={data.isDeletingVideo}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
          </div>

          {plan ? (
            <Button
              variant="outline"
              size="sm"
              className="nodrag w-full"
              onClick={() => {
                if (plan.motionControlSegments?.length) {
                  data.onGenerateAllSegmentStartFrames(data.formatId, data.video.id);
                  return;
                }
                data.onGenerateStartFrame(data.formatId, data.video.id);
              }}
              isLoading={data.isGeneratingStartFrame}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {data.isGeneratingStartFrame
                ? plan.motionControlSegments?.length
                  ? data.generatingSegmentIndex === -1
                    ? "Generating segment frames..."
                    : "Generating segment frame..."
                  : "Generating start frame..."
                : plan.motionControlSegments?.length
                  ? "Generate Segment Start Frames"
                  : "Generate Start Frame"}
            </Button>
          ) : null}

          {plan?.motionControlSegments?.length ? (
            <Button
              variant="outline"
              size="sm"
              className="nodrag w-full"
              onClick={() => data.onGenerateScriptCharacters(data.formatId, data.video.id)}
              isLoading={data.isGeneratingScriptCharacters}
            >
              <Users className="mr-1.5 h-3.5 w-3.5" />
              {data.isGeneratingScriptCharacters
                ? "Generating Script Characters..."
                : plan.scriptCharacters?.characters?.length
                  ? "Regenerate Script Characters"
                  : "Generate Script Characters"}
            </Button>
          ) : null}

          {data.error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">{data.error}</div>
          ) : null}
          {data.success ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700">{data.success}</div>
          ) : null}
        </div>

        {/* Recreation plan entry */}
        {plan ? (
          <>
            <button
              type="button"
              onClick={() => setIsPlanModalOpen(true)}
              className="nodrag mt-2 w-full rounded-lg border border-violet-200 bg-violet-50/60 p-2 text-left transition hover:bg-violet-100/70"
            >
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-violet-600" />
                <span className="text-xs font-semibold text-violet-800">Recreation Plan</span>
              </div>
              <p className="mt-1 truncate text-[11px] font-medium text-slate-700">{plan.title}</p>
              <p className="mt-0.5 text-[10px] text-violet-700">Click to view full plan</p>
            </button>

            <Dialog open={isPlanModalOpen} onOpenChange={setIsPlanModalOpen}>
              <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden p-0">
                <DialogHeader className="border-b border-slate-200">
                  <DialogTitle className="text-base">Recreation Plan</DialogTitle>
                  <DialogDescription className="line-clamp-2 text-xs text-slate-600">
                    {plan.title}
                  </DialogDescription>
                </DialogHeader>

                <div className="max-h-[74vh] space-y-3 overflow-y-auto px-6 pb-6 pt-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Strategy</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-700">{plan.strategy}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Objective</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-700">{plan.objective}</p>
                    {plan.klingMotionControlOnly ? (
                      <div className="mt-1">
                        <Badge variant="default">Kling motion control start-frame plan</Badge>
                      </div>
                    ) : null}
                  </div>

                  {plan.contentClassification?.category ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Content Category</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="default">{plan.contentClassification.category.replace(/_/g, " ")}</Badge>
                        {typeof plan.maxSingleClipDurationSeconds === "number" ? (
                          <Badge variant="default">{`Max clip ${plan.maxSingleClipDurationSeconds}s`}</Badge>
                        ) : null}
                      </div>
                      {plan.contentClassification.reason ? (
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">{plan.contentClassification.reason}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {plan.deliverableSpec ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Deliverable</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {plan.deliverableSpec.duration ? <Badge variant="default">{plan.deliverableSpec.duration}</Badge> : null}
                        {plan.deliverableSpec.aspectRatio ? <Badge variant="default">{plan.deliverableSpec.aspectRatio}</Badge> : null}
                        {plan.deliverableSpec.voiceStyle ? <Badge variant="default">{plan.deliverableSpec.voiceStyle}</Badge> : null}
                        {plan.deliverableSpec.platforms?.map((platform) => (
                          <Badge key={platform} variant="default">{platform}</Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {!plan.motionControlSegments?.length ? (
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Video Start Frame</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="nodrag"
                        onClick={() => data.onGenerateStartFrame(data.formatId, data.video.id)}
                        isLoading={data.isGeneratingStartFrame}
                      >
                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                        {plan.startFrame?.imageUrl ? "Regenerate" : "Generate"}
                      </Button>
                    </div>
                    {plan.startFrame?.imageUrl ? (
                      <div className="mt-1.5 rounded border border-slate-200 bg-white p-2">
                        <img
                          src={plan.startFrame.imageUrl}
                          alt="Video start frame"
                          className="w-full rounded border border-slate-200 object-cover"
                          style={{ aspectRatio: "9 / 16" }}
                        />
                        <div className="mt-1.5 flex items-center justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="nodrag"
                            onClick={() => data.onOpen(plan.startFrame?.imageUrl || "")}
                          >
                            <ExternalLink className="mr-1 h-3.5 w-3.5" />
                            Open image
                          </Button>
                        </div>
                        {plan.startFrame.imageModel ? (
                          <p className="mt-1 text-[11px] text-slate-500">Model: {plan.startFrame.imageModel}</p>
                        ) : null}
                        {plan.startFrame.prompt ? (
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{plan.startFrame.prompt}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">
                        Generate one opening frame based on this plan and selected character.
                      </p>
                    )}
                  </div>
                  ) : null}

                  {plan.motionControlSegments?.length ? (
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Shot Groups (8s max each)</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="nodrag h-7"
                          onClick={() => data.onGenerateAllSegmentStartFrames(data.formatId, data.video.id)}
                          isLoading={data.isGeneratingStartFrame && data.generatingSegmentIndex === -1}
                          disabled={data.isGeneratingStartFrame && data.generatingSegmentIndex !== -1}
                        >
                          <Sparkles className="mr-1 h-3.5 w-3.5" />
                          Generate All Segment Frames
                        </Button>
                      </div>
                      <div className="mt-1.5 space-y-3">
                        {plan.scriptCharacters?.characters?.length ? (
                          <div className="rounded border border-fuchsia-200 bg-fuchsia-50/60 px-2 py-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-fuchsia-700">
                              Script Character References ({plan.scriptCharacters.characters.length})
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-600">
                              {plan.scriptCharacters.characters.map((item) => item.name).join(", ")}
                            </p>
                          </div>
                        ) : null}
                        {plan.motionControlSegments.map((segment, idx) => (
                          <div key={`mc-seg-${idx}`} className="rounded border border-indigo-200 bg-indigo-50/50 p-2.5">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <Badge variant="default" className="mr-1.5 bg-indigo-100 text-indigo-700 border-indigo-200 hover:bg-indigo-100">
                                  Segment {segment.segmentId}
                                </Badge>
                                <span className="text-[10px] font-mono font-medium text-slate-500">
                                  {segment.timecode} ({segment.durationSeconds}s)
                                </span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="nodrag h-7"
                                onClick={() => data.onGenerateStartFrame(data.formatId, data.video.id, idx)}
                                isLoading={data.isGeneratingStartFrame && data.generatingSegmentIndex === idx}
                                disabled={data.isGeneratingStartFrame && data.generatingSegmentIndex !== idx}
                              >
                                <Sparkles className="mr-1 h-3.5 w-3.5" />
                                {segment.startFrame?.imageUrl ? "Regenerate Frame" : "Generate Frame"}
                              </Button>
                            </div>

                            {segment.startFrame?.imageUrl ? (
                              <div className="mb-2 rounded border border-slate-200 bg-white p-2">
                                <img
                                  src={segment.startFrame.imageUrl}
                                  alt={`Segment ${segment.segmentId} start frame`}
                                  className="w-full rounded border border-slate-200 object-cover"
                                  style={{ aspectRatio: "9 / 16" }}
                                />
                                <div className="mt-1.5 flex items-center justify-end">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="nodrag"
                                    onClick={() => data.onOpen(segment.startFrame?.imageUrl || "")}
                                  >
                                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                                    Open image
                                  </Button>
                                </div>
                              </div>
                            ) : null}

                            <p className="text-[11px] leading-relaxed text-slate-600">
                              <span className="font-semibold text-slate-500">Visual Intent:</span> {segment.startFramePrompt}
                            </p>
                            {segment.characterReferenceIds?.length ? (
                              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                                <span className="font-semibold text-slate-500">Character Refs:</span>{" "}
                                {segment.characterReferenceIds
                                  .map((id) => plan.scriptCharacters?.characters?.find((item) => item.id === id)?.name || id)
                                  .join(", ")}
                              </p>
                            ) : null}

                            {segment.script?.hook || segment.script?.shots?.length || segment.script?.cta ? (
                              <div className="mt-2 rounded border border-indigo-200 bg-white/80 px-2 py-1.5">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">Segment Script</p>
                                {segment.script?.hook ? (
                                  <p className="mt-1 text-[11px] text-slate-600">
                                    <span className="font-semibold text-slate-500">Hook:</span> {segment.script.hook}
                                  </p>
                                ) : null}
                                {segment.script?.shots?.length ? (
                                  <div className="mt-1 space-y-1">
                                    {segment.script.shots.map((shot, shotIndex) => (
                                      <div key={`segment-shot-${segment.segmentId}-${shotIndex}`} className="rounded border border-slate-200 bg-white px-2 py-1">
                                        <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500">
                                          <span>{shot.shotId || `shot${shotIndex + 1}`}</span>
                                        </div>
                                        {shot.narration ? <p className="text-[11px] text-slate-600"><span className="font-semibold text-slate-500">VO:</span> {shot.narration}</p> : null}
                                        {shot.onScreenText ? <p className="text-[11px] text-slate-600"><span className="font-semibold text-slate-500">Text:</span> {shot.onScreenText}</p> : null}
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                {segment.script?.cta ? (
                                  <p className="mt-1 text-[11px] text-slate-600">
                                    <span className="font-semibold text-slate-500">CTA:</span> {segment.script.cta}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}

                            {!segment.veoPrompt && segment.multiShotPrompts?.length ? (
                              <div className="mt-2 rounded border border-blue-200 bg-blue-50/70 px-2 py-1.5">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Segment Multi-Shot Prompts</p>
                                <div className="mt-1 space-y-1">
                                  {segment.multiShotPrompts.map((prompt, promptIndex) => (
                                    <div key={`seg-prompt-${segment.segmentId}-${promptIndex}`} className="rounded border border-blue-200 bg-white px-2 py-1.5">
                                      <div className="mb-0.5 flex flex-wrap items-center gap-1">
                                        <Badge variant="default">{prompt.shotId || `shot${promptIndex + 1}`}</Badge>
                                        {prompt.generationType ? <Badge variant="default">{prompt.generationType.replace(/_/g, " ")}</Badge> : null}
                                        {prompt.shotDuration ? <Badge variant="default">{prompt.shotDuration}</Badge> : null}
                                      </div>
                                      {prompt.scene ? <p className="text-[11px] font-semibold text-blue-700">{prompt.scene}</p> : null}
                                      <p className="text-[11px] leading-relaxed text-slate-700">{prompt.prompt}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {segment.veoPrompt ? (
                              <div className="mt-2 rounded border border-emerald-200 bg-emerald-50/70 px-2 py-1.5">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Veo 3.1 Prompt</p>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="nodrag h-7"
                                    onClick={() => void handleCopyVeoPrompt(segment.segmentId, segment.veoPrompt || "")}
                                  >
                                    <Copy className="mr-1 h-3.5 w-3.5" />
                                    {copiedVeoSegmentId === segment.segmentId ? "Copied" : "Copy"}
                                  </Button>
                                </div>
                                <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-700">{segment.veoPrompt}</p>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {!plan.klingMotionControlOnly && plan.script ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Script</p>
                      {plan.script.hook ? (
                        <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-2.5 py-2">
                          <p className="text-[10px] font-semibold text-amber-700">Hook</p>
                          <p className="text-xs leading-relaxed text-slate-700">{plan.script.hook}</p>
                        </div>
                      ) : null}

                      {plan.script.beats?.length > 0 ? (
                        <div className="mt-2 space-y-1.5">
                          {plan.script.beats.map((beat, i) => (
                            <div key={`beat-${beat.timecode}-${i}`} className="rounded border border-slate-200 bg-white px-2.5 py-2">
                              <div className="flex items-center gap-1.5">
                                <Clock className="h-3 w-3 text-slate-400" />
                                <span className="text-[10px] font-mono font-medium text-slate-500">{beat.timecode}</span>
                              </div>
                              {beat.visual ? <p className="mt-0.5 text-xs text-slate-600"><span className="font-semibold text-slate-500">Visual:</span> {beat.visual}</p> : null}
                              {beat.narration ? <p className="text-xs text-slate-600"><span className="font-semibold text-slate-500">VO:</span> {beat.narration}</p> : null}
                              {beat.onScreenText ? <p className="text-xs text-slate-600"><span className="font-semibold text-slate-500">Text:</span> {beat.onScreenText}</p> : null}
                              {beat.editNote ? <p className="text-xs italic text-slate-400">{beat.editNote}</p> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {plan.script.cta ? (
                        <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-2">
                          <p className="text-[10px] font-semibold text-emerald-700">CTA</p>
                          <p className="text-xs leading-relaxed text-slate-700">{plan.script.cta}</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {plan.socialCaption?.caption ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Post Caption</p>
                      <div className="mt-1.5 rounded border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-2">
                        <p className="text-xs leading-relaxed text-slate-700">{plan.socialCaption.caption}</p>
                        {plan.socialCaption.hashtags?.length ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {plan.socialCaption.hashtags.map((tag, i) => (
                              <Badge key={`caption-tag-${i}`} variant="default">{tag}</Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {plan.finalCutProSteps?.length ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Final Cut Pro Steps</p>
                      <ol className="mt-1 list-inside list-decimal space-y-0.5">
                        {plan.finalCutProSteps.map((step, i) => (
                          <li key={`fcp-${i}`} className="text-xs leading-relaxed text-slate-600">{step}</li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  {plan.productionSteps?.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Production Steps</p>
                      <ol className="mt-1 list-inside list-decimal space-y-0.5">
                        {plan.productionSteps.map((step, i) => (
                          <li key={`ps-${i}`} className="text-xs leading-relaxed text-slate-600">{step}</li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  {plan.assetsChecklist?.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Assets Checklist</p>
                      <ul className="mt-1 space-y-0.5">
                        {plan.assetsChecklist.map((asset, i) => (
                          <li key={`ac-${i}`} className="flex items-start gap-1 text-xs text-slate-600">
                            <span className="mt-0.5 text-slate-400">-</span> {asset}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </div>
    </div>
  );
}

function FormatTypeCanvasNode({ data }: NodeProps<Node<FormatTypeNodeData>>) {
  const isExpanded = data.expandedType === data.formatType;
  const isSelected = data.selectedType === data.formatType;

  return (
    <div className={`min-w-[220px] rounded-2xl border bg-white px-3 py-2 shadow-sm ${isSelected ? "border-rose-300" : "border-slate-200"}`}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-violet-300" />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-violet-300" />
      <button
        type="button"
        onClick={() => data.onToggleType(data.formatType)}
        className="nodrag flex w-full items-center justify-between gap-2 text-left"
      >
        <div>
          <p className="text-sm font-semibold text-slate-800">{data.formatType.replace(/_/g, " ")}</p>
          <Badge variant="default" className="mt-1">{data.formatCount} formats</Badge>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </button>
    </div>
  );
}

const nodeTypes = {
  typeNode: FormatTypeCanvasNode,
  formatNode: FormatCanvasNode,
  videoNode: VideoCanvasNode,
};

export function VideoAgentView({ collectionId }: { collectionId: string }) {
  const router = useRouter();

  const [reasoningModel, setReasoningModel] = useState<ReasoningModel>(DEFAULT_REASONING_MODEL);
  const [startFrameImageModel, setStartFrameImageModel] =
    useState<ImageGenerationModel>(DEFAULT_IMAGE_GENERATION_MODEL);
  const [useMotionControl, setUseMotionControl] = useState<boolean>(false);
  const [useKlingMotionControl, setUseKlingMotionControl] = useState<boolean>(false);

  const [library, setLibrary] = useState<LibraryFormat[]>([]);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [videoAspectRatios, setVideoAspectRatios] = useState<Record<string, number>>({});

  const [ugcCharacters, setUgcCharacters] = useState<UgcCharacter[]>([]);
  const [selectedUgcCharacterId, setSelectedUgcCharacterId] = useState<string | null>(null);
  const [videoPlans, setVideoPlans] = useState<Record<string, VideoPlan>>({});

  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);
  const [generatingStartFrameVideoId, setGeneratingStartFrameVideoId] = useState<string | null>(null);
  const [generatingSegmentIndex, setGeneratingSegmentIndex] = useState<number | undefined>(undefined);
  const [generatingScriptCharactersVideoId, setGeneratingScriptCharactersVideoId] = useState<string | null>(null);
  const [uploadingPreviousSegmentVideoId, setUploadingPreviousSegmentVideoId] = useState<string | null>(null);
  const [uploadingPreviousSegmentIndex, setUploadingPreviousSegmentIndex] = useState<number | undefined>(undefined);
  const [refreshingR2VideoId, setRefreshingR2VideoId] = useState<string | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isScriptAgentModalOpen, setIsScriptAgentModalOpen] = useState(false);
  const [scriptAgentTopicBrief, setScriptAgentTopicBrief] = useState("");
  const [scriptAgentCampaignMode, setScriptAgentCampaignMode] = useState<ScriptAgentSelectableCampaignMode>("standard");
  const [scriptAgentVideoType, setScriptAgentVideoType] = useState<ScriptAgentVideoType>("auto");
  const [scriptAgentCharacterId, setScriptAgentCharacterId] = useState<string>("auto");
  const [scriptAgentDurationSeconds, setScriptAgentDurationSeconds] = useState<number>(75);
  const [isGeneratingScriptAgentPlan, setIsGeneratingScriptAgentPlan] = useState(false);
  const [scriptAgentPlan, setScriptAgentPlan] = useState<ScriptAgentPlan | null>(null);
  const [scriptAgentError, setScriptAgentError] = useState("");
  const [scriptAgentSuccess, setScriptAgentSuccess] = useState("");
  const [isCycleDayAgentModalOpen, setIsCycleDayAgentModalOpen] = useState(false);
  const [cycleDayPlans, setCycleDayPlans] = useState<CycleDayPlanSummary[]>([]);
  const [isLoadingCycleDayPlans, setIsLoadingCycleDayPlans] = useState(false);
  const [isGeneratingCycleDayPlan, setIsGeneratingCycleDayPlan] = useState(false);
  const [isGeneratingCycleDayScript, setIsGeneratingCycleDayScript] = useState(false);
  const [cycleDayPlanStartDate, setCycleDayPlanStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [cycleDayPlanLength, setCycleDayPlanLength] = useState<number>(30);
  const [selectedCycleDayPlanId, setSelectedCycleDayPlanId] = useState<string>("latest");
  const [selectedCycleDayNumber, setSelectedCycleDayNumber] = useState<number>(1);
  const [cycleDayCharacterId, setCycleDayCharacterId] = useState<string>("auto");
  const [cycleDayDurationSeconds, setCycleDayDurationSeconds] = useState<string>("");
  const [cycleDayAgentPlan, setCycleDayAgentPlan] = useState<ScriptAgentPlan | null>(null);
  const [cycleDayAgentError, setCycleDayAgentError] = useState("");
  const [cycleDayAgentSuccess, setCycleDayAgentSuccess] = useState("");
  const [isIslamicSeriesAgentModalOpen, setIsIslamicSeriesAgentModalOpen] = useState(false);
  const [isLoadingIslamicSeriesMeta, setIsLoadingIslamicSeriesMeta] = useState(false);
  const [isGeneratingIslamicSeriesEpisode, setIsGeneratingIslamicSeriesEpisode] = useState(false);
  const [islamicSeriesKnowledge, setIslamicSeriesKnowledge] = useState<IslamicSeriesKnowledge | null>(null);
  const [islamicSeriesDocumentationPath, setIslamicSeriesDocumentationPath] = useState("");
  const [islamicSeriesSavedPlans, setIslamicSeriesSavedPlans] = useState<IslamicSeriesSavedPlanSummary[]>([]);
  const [selectedIslamicSeriesEpisodeId, setSelectedIslamicSeriesEpisodeId] = useState("");
  const [islamicSeriesDurationSeconds, setIslamicSeriesDurationSeconds] = useState<number>(150);
  const [islamicSeriesCustomFocus, setIslamicSeriesCustomFocus] = useState("");
  const [islamicSeriesPlan, setIslamicSeriesPlan] = useState<ScriptAgentPlan | null>(null);
  const [islamicSeriesEpisode, setIslamicSeriesEpisode] = useState<IslamicSeriesTopic | null>(null);
  const [islamicSeriesError, setIslamicSeriesError] = useState("");
  const [islamicSeriesSuccess, setIslamicSeriesSuccess] = useState("");
  const [copiedScriptAgentSegmentId, setCopiedScriptAgentSegmentId] = useState<number | null>(null);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});

  const selectedFormat = useMemo(
    () => library.find((format) => format.id === selectedFormatId) || null,
    [library, selectedFormatId]
  );

  const formatsByType = useMemo(() => {
    const grouped = new Map<string, LibraryFormat[]>();
    for (const format of library) {
      const key = (format.format_type || "other").trim() || "other";
      const current = grouped.get(key) || [];
      current.push(format);
      grouped.set(key, current);
    }
    return grouped;
  }, [library]);

  const orderedTypes = useMemo(() => {
    return Array.from(formatsByType.keys()).sort((a, b) => a.localeCompare(b));
  }, [formatsByType]);

  const selectedVideo = useMemo(
    () => selectedFormat?.videos.find((video) => video.id === selectedVideoId) || null,
    [selectedFormat, selectedVideoId]
  );

  const selectedUgcCharacter = useMemo(
    () => ugcCharacters.find((character) => character.id === selectedUgcCharacterId) || null,
    [ugcCharacters, selectedUgcCharacterId]
  );

  const selectedCycleDayPlan = useMemo(() => {
    if (cycleDayPlans.length === 0) return null;
    if (selectedCycleDayPlanId === "latest") return cycleDayPlans[0] || null;
    return cycleDayPlans.find((plan) => plan.id === selectedCycleDayPlanId) || null;
  }, [cycleDayPlans, selectedCycleDayPlanId]);

  const selectedCycleDayOptions = useMemo(() => {
    const days = selectedCycleDayPlan?.days || [];
    return [...days].sort((a, b) => a.dayNumber - b.dayNumber);
  }, [selectedCycleDayPlan]);

  const selectedIslamicSeriesEpisode = useMemo(() => {
    const topics = islamicSeriesKnowledge?.topics || [];
    if (topics.length === 0) return null;
    if (!selectedIslamicSeriesEpisodeId) return topics[0] || null;
    return topics.find((topic) => topic.id === selectedIslamicSeriesEpisodeId) || topics[0] || null;
  }, [islamicSeriesKnowledge, selectedIslamicSeriesEpisodeId]);

  const handleSelectVideo = useCallback((formatId: string, videoId: string) => {
    setSelectedFormatId(formatId);
    setSelectedVideoId(videoId);
  }, []);

  const handleToggleType = useCallback(
    (type: string) => {
      const isCollapsing = expandedType === type;

      if (isCollapsing) {
        setExpandedType(null);
        setSelectedFormatId(null);
        setSelectedVideoId(null);
        setPlayingVideoId(null);
        return;
      }

      const formats = formatsByType.get(type) || [];
      const nextFormat =
        (selectedFormatId && formats.find((item) => item.id === selectedFormatId)) || null;

      setExpandedType(type);

      if (!nextFormat) {
        const fallbackFormat = formats[0] || null;
        setSelectedFormatId(fallbackFormat?.id || null);
        setSelectedVideoId(null);
        setPlayingVideoId(null);
        return;
      }

      setSelectedFormatId(nextFormat.id);
      setSelectedVideoId((current) => {
        if (current && nextFormat.videos.some((video) => video.id === current)) return current;
        return null;
      });
      setPlayingVideoId(null);
    },
    [expandedType, formatsByType, selectedFormatId]
  );

  const handlePlayVideo = useCallback((formatId: string, videoId: string) => {
    setSelectedFormatId(formatId);
    setSelectedVideoId(videoId);
    setPlayingVideoId(videoId);
  }, []);

  const handleOpenSource = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handleDownloadVideo = useCallback(async (url: string, title: string | null) => {
    if (!url) {
      setError("No downloadable video URL available.");
      return;
    }

    setError("");
    setSuccess("");

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download video (${response.status}).`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const extension = inferVideoExtension(url);
      const filename = toSafeVideoFilename(title, extension);

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
      setSuccess("Video download started.");
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
      setSuccess("Opened video URL. Save it manually from the browser if auto-download is blocked.");
    }
  }, []);

  const handleAspect = useCallback((videoId: string, ratio: number) => {
    const nextRatio = clampAspectRatio(ratio);
    setVideoAspectRatios((prev) => {
      if (Math.abs((prev[videoId] || 0) - nextRatio) < 0.01) return prev;
      return {
        ...prev,
        [videoId]: nextRatio,
      };
    });
  }, []);

  const loadLibrary = useCallback(
    async (preferred?: { formatId?: string | null; videoId?: string | null }) => {
      setIsLoadingLibrary(true);
      try {
        const response = await fetch(
          `/api/video-agent/formats?collectionId=${encodeURIComponent(collectionId)}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const data = (await response.json()) as FormatsResponse;
        if (!response.ok) {
          throw new Error(data.error || "Failed to load video format library.");
        }

        const formats = Array.isArray(data.formats) ? data.formats : [];
        setLibrary(formats);

        setSelectedFormatId((prevFormatId) => {
          const nextFormatId =
            (preferred?.formatId && formats.some((item) => item.id === preferred.formatId)
              ? preferred.formatId
              : null) ||
            (prevFormatId && formats.some((item) => item.id === prevFormatId)
              ? prevFormatId
              : null) ||
            formats[0]?.id ||
            null;
          return nextFormatId;
        });

        setSelectedVideoId((prevVideoId) => {
          const nextVideoId =
            (preferred?.videoId && formats.some((item) => item.videos.some((video) => video.id === preferred.videoId))
              ? preferred.videoId
              : null) ||
            (prevVideoId && formats.some((item) => item.videos.some((video) => video.id === prevVideoId))
              ? prevVideoId
              : null) ||
            null;
          return nextVideoId;
        });

        setExpandedType((prevType) => {
          if (preferred?.formatId) {
            const preferredFormat = formats.find((item) => item.id === preferred.formatId);
            if (preferredFormat) return preferredFormat.format_type;
          }
          if (prevType && formats.some((item) => item.format_type === prevType)) return prevType;
          return formats[0]?.format_type || null;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load video format library.");
      } finally {
        setIsLoadingLibrary(false);
      }
    },
    [collectionId]
  );

  const loadCharacters = useCallback(async () => {
    setIsLoadingCharacters(true);
    try {
      const response = await fetch(
        `/api/video-agent/characters?collectionId=${encodeURIComponent(collectionId)}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const data = (await response.json()) as CharacterResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to load UGC characters.");
      }

      const characters = Array.isArray(data.characters)
        ? data.characters
        : data.character
          ? [data.character]
          : [];

      setUgcCharacters(characters);
      setSelectedUgcCharacterId((current) => {
        if (current && characters.some((item) => item.id === current)) {
          return current;
        }
        const defaultCharacter = characters.find((item) => item.isDefault) || null;
        return defaultCharacter?.id || characters[0]?.id || null;
      });
      setScriptAgentCharacterId((current) => {
        if (current !== "auto" && characters.some((item) => item.id === current)) {
          return current;
        }
        const defaultCharacter = characters.find((item) => item.isDefault) || null;
        return defaultCharacter?.id || "auto";
      });
      setCycleDayCharacterId((current) => {
        if (current !== "auto" && characters.some((item) => item.id === current)) {
          return current;
        }
        const defaultAnimatedCharacter =
          characters.find((item) => (item.characterType || "ugc") === "animated" && item.isDefault) || null;
        if (defaultAnimatedCharacter?.id) return defaultAnimatedCharacter.id;
        const firstAnimatedCharacter =
          characters.find((item) => (item.characterType || "ugc") === "animated") || null;
        return firstAnimatedCharacter?.id || "auto";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load UGC characters.");
    } finally {
      setIsLoadingCharacters(false);
    }
  }, [collectionId]);

  const loadPlans = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/video-agent/plans?collectionId=${encodeURIComponent(collectionId)}&limit=50`,
        { method: "GET", cache: "no-store" }
      );
      const data = (await response.json()) as PlansResponse;
      if (!response.ok || !Array.isArray(data.plans)) return;

      const plansByVideo: Record<string, VideoPlan> = {};
      for (const saved of data.plans) {
        if (!saved.source_video_id || !saved.plan) continue;
        // plans are ordered newest-first, so first match wins (most recent)
        if (!plansByVideo[saved.source_video_id]) {
          plansByVideo[saved.source_video_id] = saved.plan;
        }
      }
      setVideoPlans(plansByVideo);
    } catch {
      // silent – plans are supplementary data
    }
  }, [collectionId]);

  const loadCycleDayPlans = useCallback(async () => {
    setIsLoadingCycleDayPlans(true);
    try {
      const response = await fetch(
        `/api/video-agent/cycle-day-plans?collectionId=${encodeURIComponent(collectionId)}&limit=30`,
        { method: "GET", cache: "no-store" }
      );
      const data = (await response.json()) as CycleDayPlansResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to load cycle-day plans.");
      }
      const plans = Array.isArray(data.plans) ? data.plans : [];
      setCycleDayPlans(plans);
      setSelectedCycleDayPlanId((current) => {
        if (current !== "latest" && plans.some((plan) => plan.id === current)) return current;
        return "latest";
      });
    } catch (err) {
      setCycleDayAgentError(err instanceof Error ? err.message : "Failed to load cycle-day plans.");
    } finally {
      setIsLoadingCycleDayPlans(false);
    }
  }, [collectionId]);

  const loadIslamicSeriesMeta = useCallback(async () => {
    setIsLoadingIslamicSeriesMeta(true);
    try {
      const response = await fetch(
        `/api/video-agent/islamic-menstruation-series-agent?collectionId=${encodeURIComponent(collectionId)}&limit=40`,
        { method: "GET", cache: "no-store" }
      );

      const data = (await response.json()) as IslamicSeriesMetaResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to load Islamic menstruation series metadata.");
      }

      const series = data.series || null;
      const savedPlans = Array.isArray(data.savedPlans) ? data.savedPlans : [];

      setIslamicSeriesKnowledge(series);
      setIslamicSeriesDocumentationPath(data.documentationPath || "");
      setIslamicSeriesSavedPlans(savedPlans);

      setSelectedIslamicSeriesEpisodeId((current) => {
        if (!series?.topics?.length) return "";
        if (current && series.topics.some((topic) => topic.id === current)) return current;
        return series.topics[0]?.id || "";
      });

      if (data.warning) {
        setIslamicSeriesError(data.warning);
      }
    } catch (err) {
      setIslamicSeriesError(err instanceof Error ? err.message : "Failed to load Islamic menstruation series metadata.");
    } finally {
      setIsLoadingIslamicSeriesMeta(false);
    }
  }, [collectionId]);

  useEffect(() => {
    void loadLibrary();
    void loadCharacters();
    void loadPlans();
    void loadCycleDayPlans();
    void loadIslamicSeriesMeta();
  }, [loadLibrary, loadCharacters, loadPlans, loadCycleDayPlans, loadIslamicSeriesMeta]);

  useEffect(() => {
    const forceUgc =
      scriptAgentCampaignMode === "widget_reaction_ugc" ||
      scriptAgentCampaignMode === "widget_shock_hook_ugc" ||
      scriptAgentCampaignMode === "ugc_shocking_fact_reaction" ||
      scriptAgentCampaignMode === "widget_late_period_reaction_hook_ugc";
    const forceAiAnimation =
      scriptAgentCampaignMode === "ai_objects_educational_explainer" ||
      scriptAgentCampaignMode === "mixed_media_relatable_pov";

    if (forceUgc && scriptAgentVideoType !== "ugc") {
      setScriptAgentVideoType("ugc");
      return;
    }

    if (forceAiAnimation && scriptAgentVideoType !== "ai_animation") {
      setScriptAgentVideoType("ai_animation");
    }
  }, [scriptAgentCampaignMode, scriptAgentVideoType]);

  useEffect(() => {
    if (scriptAgentCampaignMode === "widget_late_period_reaction_hook_ugc") {
      if (scriptAgentDurationSeconds !== 8) {
        setScriptAgentDurationSeconds(8);
      }
      return;
    }

    if (scriptAgentCampaignMode === "ugc_shocking_fact_reaction") {
      if (scriptAgentDurationSeconds < 24 || scriptAgentDurationSeconds > 90) {
        setScriptAgentDurationSeconds(45);
      }
      return;
    }

    if (scriptAgentCampaignMode === "mixed_media_relatable_pov") {
      if (scriptAgentDurationSeconds < 18 || scriptAgentDurationSeconds > 45) {
        setScriptAgentDurationSeconds(30);
      }
      return;
    }

    if (scriptAgentCampaignMode === "ai_objects_educational_explainer") {
      if (scriptAgentDurationSeconds < 40 || scriptAgentDurationSeconds > 110) {
        setScriptAgentDurationSeconds(90);
      }
      return;
    }

    if (scriptAgentDurationSeconds < 30) {
      setScriptAgentDurationSeconds(30);
    }
  }, [scriptAgentCampaignMode, scriptAgentDurationSeconds]);

  useEffect(() => {
    if (selectedCycleDayOptions.length === 0) {
      setSelectedCycleDayNumber(1);
      return;
    }

    if (!selectedCycleDayOptions.some((day) => day.dayNumber === selectedCycleDayNumber)) {
      setSelectedCycleDayNumber(selectedCycleDayOptions[0].dayNumber);
    }
  }, [selectedCycleDayOptions, selectedCycleDayNumber]);

  useEffect(() => {
    if (!selectedFormat) {
      setSelectedVideoId(null);
      return;
    }

    if (selectedVideoId && selectedFormat.videos.some((video) => video.id === selectedVideoId)) {
      return;
    }

    setSelectedVideoId(null);
  }, [selectedFormat, selectedVideoId]);

  useEffect(() => {
    const onSourceAdded = (event: Event) => {
      const detail = (event as CustomEvent<{ formatId?: string; videoId?: string }>).detail;

      setSuccess("Video added to library.");
      void loadLibrary({
        formatId: detail?.formatId || null,
        videoId: detail?.videoId || null,
      });
      void loadPlans();
    };

    window.addEventListener("video-agent:source-added", onSourceAdded as EventListener);
    return () => window.removeEventListener("video-agent:source-added", onSourceAdded as EventListener);
  }, [loadLibrary, loadPlans]);

  const handleGeneratePlan = useCallback(async (formatIdArg?: string, videoIdArg?: string) => {
    const targetFormat =
      (formatIdArg ? library.find((item) => item.id === formatIdArg) : null) || selectedFormat;
    const targetVideo =
      (targetFormat && videoIdArg ? targetFormat.videos.find((item) => item.id === videoIdArg) : null) || selectedVideo;

    if (!targetFormat || !targetVideo) {
      setError("Select a format and video first.");
      return;
    }

    if (targetFormat.format_type === "ugc" && !selectedUgcCharacter) {
      setError("This is a UGC format. Select a character from Character Studio first.");
      return;
    }

    setSelectedFormatId(targetFormat.id);
    setSelectedVideoId(targetVideo.id);
    setIsGeneratingPlan(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/video-agent/recreate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          formatId: targetFormat.id,
          videoId: targetVideo.id,
          characterId: targetFormat.format_type === "ugc" ? selectedUgcCharacter?.id : null,
          reasoningModel,
          useMotionControl,
          useKlingMotionControl,
        }),
      });

      const data = (await response.json()) as RecreateResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate recreation plan.");
      }

      if (!data.plan) {
        throw new Error("No plan returned.");
      }

      setVideoPlans((prev) => ({
        ...prev,
        [targetVideo.id]: data.plan as VideoPlan,
      }));
      setSuccess("Recreation plan generated.");
      void loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate recreation plan.");
    } finally {
      setIsGeneratingPlan(false);
    }
  }, [
    collectionId,
    library,
    selectedFormat,
    selectedVideo,
    selectedUgcCharacter,
    reasoningModel,
    useMotionControl,
    useKlingMotionControl,
    loadPlans,
  ]);

  const handleDeleteVideo = useCallback(async (formatIdArg?: string, videoIdArg?: string) => {
    const targetFormat =
      (formatIdArg ? library.find((item) => item.id === formatIdArg) : null) || selectedFormat;
    const targetVideo =
      (targetFormat && videoIdArg ? targetFormat.videos.find((item) => item.id === videoIdArg) : null) || selectedVideo;

    if (!targetFormat || !targetVideo) {
      setError("Select a format and video first.");
      return;
    }

    const confirmed = window.confirm(
      `Delete this video source?\n\n${targetVideo.title || targetVideo.source_url}\n\nThis removes saved plans for this source as well.`
    );
    if (!confirmed) return;

    setDeletingVideoId(targetVideo.id);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/video-agent/videos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          videoId: targetVideo.id,
        }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete video source.");
      }

      setVideoPlans((prev) => {
        const next = { ...prev };
        delete next[targetVideo.id];
        return next;
      });

      if (selectedVideoId === targetVideo.id) {
        setSelectedVideoId(null);
        setPlayingVideoId(null);
      }

      setSuccess("Video source deleted.");
      await loadLibrary();
      await loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete video source.");
    } finally {
      setDeletingVideoId(null);
    }
  }, [
    collectionId,
    library,
    selectedFormat,
    selectedVideo,
    selectedVideoId,
    loadLibrary,
    loadPlans,
  ]);

  const handleGenerateStartFrame = useCallback(async (formatIdArg?: string, videoIdArg?: string, segmentIndex?: number) => {
    const targetFormat =
      (formatIdArg ? library.find((item) => item.id === formatIdArg) : null) || selectedFormat;
    const targetVideo =
      (targetFormat && videoIdArg ? targetFormat.videos.find((item) => item.id === videoIdArg) : null) || selectedVideo;

    if (!targetFormat || !targetVideo) {
      setError("Select a format and video first.");
      return;
    }

    const existingPlan = videoPlans[targetVideo.id] || null;
    if (!existingPlan) {
      setError("Generate a recreation plan first, then create start frame.");
      return;
    }

    setGeneratingStartFrameVideoId(targetVideo.id);
    setGeneratingSegmentIndex(segmentIndex);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/video-agent/start-frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          formatId: targetFormat.id,
          videoId: targetVideo.id,
          characterId: targetFormat.format_type === "ugc" ? selectedUgcCharacter?.id : null,
          imageGenerationModel: startFrameImageModel,
          segmentIndex,
        }),
      });

      const data = (await response.json()) as StartFrameResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate start frame.");
      }

      if (!data.startFrame && !data.plan) {
        throw new Error("No start frame returned.");
      }

      setVideoPlans((prev) => ({
        ...prev,
        [targetVideo.id]: data.plan || {
          ...existingPlan,
          startFrame: data.startFrame,
        },
      }));

      const segmentSuffix = typeof segmentIndex === "number" ? ` for segment ${segmentIndex + 1}` : "";
      setSuccess(`Start frame generated${segmentSuffix}.`);
      void loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate start frame.");
    } finally {
      setGeneratingStartFrameVideoId(null);
      setGeneratingSegmentIndex(undefined);
    }
  }, [
    collectionId,
    library,
    selectedFormat,
    selectedVideo,
    selectedUgcCharacter,
    startFrameImageModel,
    videoPlans,
    loadPlans,
  ]);

  const handleGenerateAllSegmentStartFrames = useCallback(async (formatIdArg?: string, videoIdArg?: string) => {
    const targetFormat =
      (formatIdArg ? library.find((item) => item.id === formatIdArg) : null) || selectedFormat;
    const targetVideo =
      (targetFormat && videoIdArg ? targetFormat.videos.find((item) => item.id === videoIdArg) : null) || selectedVideo;

    if (!targetFormat || !targetVideo) {
      setError("Select a format and video first.");
      return;
    }

    const existingPlan = videoPlans[targetVideo.id] || null;
    if (!existingPlan) {
      setError("Generate a recreation plan first, then create segment start frames.");
      return;
    }

    const segments = Array.isArray(existingPlan.motionControlSegments) ? existingPlan.motionControlSegments : [];
    if (segments.length === 0) {
      await handleGenerateStartFrame(targetFormat.id, targetVideo.id);
      return;
    }

    setGeneratingStartFrameVideoId(targetVideo.id);
    setGeneratingSegmentIndex(-1);
    setError("");
    setSuccess("");

    try {
      let latestPlan = existingPlan;

      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const response = await fetch("/api/video-agent/start-frame", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            collectionId,
            formatId: targetFormat.id,
            videoId: targetVideo.id,
            characterId: targetFormat.format_type === "ugc" ? selectedUgcCharacter?.id : null,
            imageGenerationModel: startFrameImageModel,
            segmentIndex,
          }),
        });

        const data = (await response.json()) as StartFrameResponse;
        if (!response.ok) {
          throw new Error(data.error || `Failed to generate start frame for segment ${segmentIndex + 1}.`);
        }

        if (!data.startFrame && !data.plan) {
          throw new Error(`No start frame returned for segment ${segmentIndex + 1}.`);
        }

        latestPlan = data.plan || {
          ...latestPlan,
          startFrame: data.startFrame,
        };

        setVideoPlans((prev) => ({
          ...prev,
          [targetVideo.id]: latestPlan,
        }));
      }

      setSuccess(`Generated start frames for ${segments.length} segments.`);
      void loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate segment start frames.");
    } finally {
      setGeneratingStartFrameVideoId(null);
      setGeneratingSegmentIndex(undefined);
    }
  }, [
    collectionId,
    library,
    selectedFormat,
    selectedVideo,
    selectedUgcCharacter,
    startFrameImageModel,
    videoPlans,
    loadPlans,
    handleGenerateStartFrame,
  ]);

  const handleGenerateScriptCharacters = useCallback(async (formatIdArg?: string, videoIdArg?: string) => {
    const targetFormat =
      (formatIdArg ? library.find((item) => item.id === formatIdArg) : null) || selectedFormat;
    const targetVideo =
      (targetFormat && videoIdArg ? targetFormat.videos.find((item) => item.id === videoIdArg) : null) || selectedVideo;

    if (!targetFormat || !targetVideo) {
      setError("Select a format and video first.");
      return;
    }

    const existingPlan = videoPlans[targetVideo.id] || null;
    if (!existingPlan) {
      setError("Generate a script/recreation plan first, then create script characters.");
      return;
    }

    const segments = Array.isArray(existingPlan.motionControlSegments) ? existingPlan.motionControlSegments : [];
    if (segments.length === 0) {
      setError("This plan has no segment groups to assign script characters.");
      return;
    }

    setGeneratingScriptCharactersVideoId(targetVideo.id);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/video-agent/script-characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          videoId: targetVideo.id,
          imageGenerationModel: startFrameImageModel,
        }),
      });

      const data = (await response.json()) as ScriptCharactersResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate script characters.");
      }

      if (!data.plan) {
        throw new Error("No updated plan returned after script character generation.");
      }

      setVideoPlans((prev) => ({
        ...prev,
        [targetVideo.id]: data.plan as VideoPlan,
      }));

      const generatedCount =
        typeof data.generatedCount === "number"
          ? data.generatedCount
          : Array.isArray(data.scriptCharacters?.characters)
            ? data.scriptCharacters?.characters.length
            : Array.isArray(data.plan.scriptCharacters?.characters)
              ? data.plan.scriptCharacters.characters.length
              : 0;
      const warningSuffix = data.warnings?.length ? ` (${data.warnings.length} warning${data.warnings.length > 1 ? "s" : ""})` : "";
      setSuccess(`Generated ${generatedCount} script character reference${generatedCount === 1 ? "" : "s"}${warningSuffix}.`);
      void loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate script characters.");
    } finally {
      setGeneratingScriptCharactersVideoId(null);
    }
  }, [
    collectionId,
    library,
    selectedFormat,
    selectedVideo,
    startFrameImageModel,
    videoPlans,
    loadPlans,
  ]);

  const handleUploadPreviousSegmentVideo = useCallback(async (
    formatIdArg?: string,
    videoIdArg?: string,
    segmentIndex?: number,
    file?: File
  ) => {
    const targetFormat =
      (formatIdArg ? library.find((item) => item.id === formatIdArg) : null) || selectedFormat;
    const targetVideo =
      (targetFormat && videoIdArg ? targetFormat.videos.find((item) => item.id === videoIdArg) : null) || selectedVideo;

    if (!targetFormat || !targetVideo) {
      setError("Select a format and video first.");
      return;
    }

    if (typeof segmentIndex !== "number" || segmentIndex <= 0) {
      setError("Upload previous segment video is available from segment 2 onward.");
      return;
    }

    if (!file) {
      setError("Select a generated video file from the previous segment.");
      return;
    }

    const existingPlan = videoPlans[targetVideo.id] || null;
    if (!existingPlan) {
      setError("Generate a recreation plan first.");
      return;
    }

    setUploadingPreviousSegmentVideoId(targetVideo.id);
    setUploadingPreviousSegmentIndex(segmentIndex);
    setError("");
    setSuccess("");

    try {
      const extracted = await extractLastFrameDataUrlFromVideo(file);

      const response = await fetch("/api/video-agent/start-frame/from-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          videoId: targetVideo.id,
          segmentIndex,
          imageDataUrl: extracted.dataUrl,
          sourceVideoName: file.name,
          sourceDurationSeconds: extracted.durationSeconds,
          sourceSeekTimeSeconds: extracted.seekTimeSeconds,
        }),
      });

      const data = (await response.json()) as StartFrameResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to apply uploaded previous segment frame.");
      }

      if (!data.startFrame && !data.plan) {
        throw new Error("No start frame returned from uploaded segment processing.");
      }

      setVideoPlans((prev) => ({
        ...prev,
        [targetVideo.id]: data.plan || {
          ...existingPlan,
          startFrame: data.startFrame,
        },
      }));

      setSuccess(`Applied last frame from uploaded video at ${formatDurationLabel(extracted.seekTimeSeconds)}.`);
      void loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract last frame from uploaded video.");
    } finally {
      setUploadingPreviousSegmentVideoId(null);
      setUploadingPreviousSegmentIndex(undefined);
    }
  }, [
    collectionId,
    library,
    selectedFormat,
    selectedVideo,
    videoPlans,
    loadPlans,
  ]);

  const handleGenerateScriptAgentPlan = useCallback(async () => {
    const topicBrief = scriptAgentTopicBrief.trim();

    setIsGeneratingScriptAgentPlan(true);
    setScriptAgentError("");
    setScriptAgentSuccess("");

    try {
      const response = await fetch("/api/video-agent/script-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          topicBrief,
          campaignMode: scriptAgentCampaignMode,
          preferredVideoType: scriptAgentVideoType,
          targetDurationSeconds: scriptAgentDurationSeconds,
          reasoningModel,
          characterId: scriptAgentCharacterId === "auto" ? null : scriptAgentCharacterId,
        }),
      });

      const data = (await response.json()) as ScriptAgentResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate script-agent plan.");
      }

      if (!data.plan) {
        throw new Error("No script-agent plan returned.");
      }

      setScriptAgentPlan(data.plan);
      setScriptAgentSuccess("Script-agent plan generated.");

      if (data.saved?.formatId && data.saved?.sourceVideoId) {
        await loadLibrary();
        await loadPlans();
        setSelectedFormatId(data.saved.formatId);
        setSelectedVideoId(data.saved.sourceVideoId);
      }
    } catch (err) {
      setScriptAgentError(err instanceof Error ? err.message : "Failed to generate script-agent plan.");
    } finally {
      setIsGeneratingScriptAgentPlan(false);
    }
  }, [
    collectionId,
    scriptAgentTopicBrief,
    scriptAgentCampaignMode,
    scriptAgentVideoType,
    scriptAgentCharacterId,
    scriptAgentDurationSeconds,
    reasoningModel,
    loadLibrary,
    loadPlans,
  ]);

  const handleGenerateCycleDayPlan = useCallback(async () => {
    setIsGeneratingCycleDayPlan(true);
    setCycleDayAgentError("");
    setCycleDayAgentSuccess("");

    try {
      const response = await fetch("/api/video-agent/cycle-day-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          cycleStartDate: cycleDayPlanStartDate,
          cycleLengthDays: cycleDayPlanLength,
          reasoningModel,
        }),
      });

      const data = (await response.json()) as CycleDayPlanCreateResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate cycle-day plan.");
      }

      setCycleDayAgentSuccess(
        `Cycle plan ${data.plan?.planNumber || ""} generated and saved.`.trim()
      );
      await loadCycleDayPlans();
      setSelectedCycleDayPlanId("latest");
      setSelectedCycleDayNumber(1);
    } catch (err) {
      setCycleDayAgentError(err instanceof Error ? err.message : "Failed to generate cycle-day plan.");
    } finally {
      setIsGeneratingCycleDayPlan(false);
    }
  }, [
    collectionId,
    cycleDayPlanStartDate,
    cycleDayPlanLength,
    reasoningModel,
    loadCycleDayPlans,
  ]);

  const handleGenerateCycleDayScript = useCallback(async () => {
    const targetPlan = selectedCycleDayPlan;
    if (!targetPlan) {
      setCycleDayAgentError("Generate or select a cycle plan first.");
      return;
    }

    const dayExists = targetPlan.days.some((day) => day.dayNumber === selectedCycleDayNumber);
    if (!dayExists) {
      setCycleDayAgentError("Select a valid cycle day from the selected plan.");
      return;
    }

    const parsedDuration = Number(cycleDayDurationSeconds);
    const targetDurationSeconds = Number.isFinite(parsedDuration) && parsedDuration > 0
      ? Math.round(parsedDuration)
      : null;

    setIsGeneratingCycleDayScript(true);
    setCycleDayAgentError("");
    setCycleDayAgentSuccess("");

    try {
      const response = await fetch("/api/video-agent/cycle-day-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          cyclePlanId: targetPlan.id,
          cycleDayNumber: selectedCycleDayNumber,
          characterId: cycleDayCharacterId === "auto" ? null : cycleDayCharacterId,
          targetDurationSeconds,
          reasoningModel,
        }),
      });

      const data = (await response.json()) as CycleDayAgentResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate cycle-day script plan.");
      }

      if (!data.plan) {
        throw new Error("No cycle-day script plan returned.");
      }

      setCycleDayAgentPlan(data.plan);
      setCycleDayAgentSuccess("Cycle-day script plan generated.");

      if (data.saved?.formatId && data.saved?.sourceVideoId) {
        await loadLibrary();
        await loadPlans();
        setSelectedFormatId(data.saved.formatId);
        setSelectedVideoId(data.saved.sourceVideoId);
      }
    } catch (err) {
      setCycleDayAgentError(err instanceof Error ? err.message : "Failed to generate cycle-day script plan.");
    } finally {
      setIsGeneratingCycleDayScript(false);
    }
  }, [
    collectionId,
    selectedCycleDayPlan,
    selectedCycleDayNumber,
    cycleDayCharacterId,
    cycleDayDurationSeconds,
    reasoningModel,
    loadLibrary,
    loadPlans,
  ]);

  const handleGenerateIslamicSeriesEpisode = useCallback(async () => {
    const selectedEpisode = selectedIslamicSeriesEpisode;
    if (!selectedEpisode) {
      setIslamicSeriesError("No series episode is available to generate.");
      return;
    }

    setIsGeneratingIslamicSeriesEpisode(true);
    setIslamicSeriesError("");
    setIslamicSeriesSuccess("");

    try {
      const response = await fetch("/api/video-agent/islamic-menstruation-series-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          episodeId: selectedEpisode.id,
          targetDurationSeconds: islamicSeriesDurationSeconds,
          customFocus: islamicSeriesCustomFocus.trim(),
          reasoningModel,
        }),
      });

      const data = (await response.json()) as IslamicSeriesAgentResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate Islamic series episode script.");
      }

      if (!data.plan) {
        throw new Error("No Islamic series plan returned.");
      }

      setIslamicSeriesPlan(data.plan);
      setIslamicSeriesEpisode(data.episode || selectedEpisode);
      setIslamicSeriesSuccess(
        data.saved?.planNumber
          ? `Episode script generated and saved as plan ${data.saved.planNumber}.`
          : "Episode script generated."
      );

      if (data.saved?.formatId && data.saved?.sourceVideoId) {
        await loadLibrary();
        await loadPlans();
        setSelectedFormatId(data.saved.formatId);
        setSelectedVideoId(data.saved.sourceVideoId);
      }

      await loadIslamicSeriesMeta();
    } catch (err) {
      setIslamicSeriesError(err instanceof Error ? err.message : "Failed to generate Islamic series episode script.");
    } finally {
      setIsGeneratingIslamicSeriesEpisode(false);
    }
  }, [
    selectedIslamicSeriesEpisode,
    collectionId,
    islamicSeriesDurationSeconds,
    islamicSeriesCustomFocus,
    reasoningModel,
    loadLibrary,
    loadPlans,
    loadIslamicSeriesMeta,
  ]);

  const handleCopyScriptAgentVeoPrompt = useCallback(async (segmentId: number, prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedScriptAgentSegmentId(segmentId);
      window.setTimeout(() => {
        setCopiedScriptAgentSegmentId((current) => (current === segmentId ? null : current));
      }, 1800);
    } catch {
      setCopiedScriptAgentSegmentId(null);
    }
  }, []);

  const handleRefreshR2 = useCallback(async (videoId: string) => {
    setRefreshingR2VideoId(videoId);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/video-agent/refresh-r2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId, videoId }),
      });

      const data = (await response.json()) as { r2VideoUrl?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to refresh R2 video.");
      }

      setSuccess("Video saved to R2.");
      void loadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh R2 video.");
    } finally {
      setRefreshingR2VideoId(null);
    }
  }, [collectionId, loadLibrary]);

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setNodePositions((prev) => ({
        ...prev,
        [node.id]: node.position,
      }));
    },
    []
  );

  const canvasGraph = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const typeStartX = 120;
    const typeSpacingX = 360;
    const typeY = 120;

    orderedTypes.forEach((type, typeIndex) => {
      const typeNodeId = `type-${type}`;
      const typeX = typeStartX + typeIndex * typeSpacingX;
      const formats = formatsByType.get(type) || [];
      const typeExpanded = expandedType === type;

      nodes.push({
        id: typeNodeId,
        type: "typeNode",
        position: { x: typeX, y: typeY },
        data: {
          formatType: type,
          formatCount: formats.length,
          expandedType,
          selectedType: expandedType,
          onToggleType: handleToggleType,
        } satisfies FormatTypeNodeData,
      });

      if (!typeExpanded) return;

      const formatY = typeY + 150;
      const videoY = formatY + 180;
      const formatGap = 80;
      const videoSpacingX = 260;

      const groupWidths = formats.map((format) => {
        const count = Math.max(1, format.videos.length);
        return Math.max(260, 230 + (count - 1) * videoSpacingX);
      });

      const totalWidth = groupWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, formats.length - 1) * formatGap;
      let cursorX = typeX - totalWidth / 2;

      formats.forEach((format, formatIndex) => {
        const groupWidth = groupWidths[formatIndex] || 260;
        const groupCenterX = cursorX + groupWidth / 2;
        const formatNodeId = `format-${format.id}`;

        nodes.push({
          id: formatNodeId,
          type: "formatNode",
          position: {
            x: groupCenterX - 125,
            y: formatY,
          },
          data: {
            format,
            selectedFormatId,
            onSelect: (formatId: string) => setSelectedFormatId(formatId),
          } satisfies FormatNodeData,
        });

        edges.push({
          id: `${typeNodeId}->${formatNodeId}`,
          source: typeNodeId,
          target: formatNodeId,
          type: "smoothstep",
          style: {
            stroke: "#c4b5fd",
            strokeWidth: 1.5,
            strokeDasharray: "4 4",
          },
        });

        const videos = format.videos;
        const rowWidth = Math.max(0, videos.length - 1) * videoSpacingX;
        const videoCenterStartX = groupCenterX - rowWidth / 2;

        videos.forEach((video, videoIndex) => {
          const videoNodeId = `video-${video.id}`;

          nodes.push({
            id: videoNodeId,
            type: "videoNode",
            position: {
              x: videoCenterStartX + videoIndex * videoSpacingX - 115,
              y: videoY,
            },
            data: {
              formatId: format.id,
              formatName: format.format_name,
              formatType: format.format_type,
              video,
              ratio: clampAspectRatio(videoAspectRatios[video.id] || 9 / 16),
              selectedVideoId,
              playingVideoId,
              directMediaUrl: getVideoDirectMediaUrl(video),
              reasoningModel,
              onReasoningModelChange: (value: string) => {
                if (isReasoningModel(value)) setReasoningModel(value);
              },
              useMotionControl,
              onUseMotionControlChange: setUseMotionControl,
              useKlingMotionControl,
              onUseKlingMotionControlChange: (value: boolean) => {
                setUseKlingMotionControl(value);
                if (value) setUseMotionControl(false);
              },
              startFrameImageModel,
              onStartFrameImageModelChange: (value: string) => {
                if (isImageGenerationModel(value)) setStartFrameImageModel(value);
              },
              isLoadingCharacters,
              ugcCharacters,
              selectedUgcCharacterId,
              onCharacterChange: (characterId: string | null) => setSelectedUgcCharacterId(characterId),
              onOpenCharacterStudio: () => router.push(`/collections/${collectionId}/characters`),
              onGeneratePlan: (formatId: string, videoId: string) => {
                void handleGeneratePlan(formatId, videoId);
              },
              onDeleteVideo: (formatId: string, videoId: string) => {
                void handleDeleteVideo(formatId, videoId);
              },
              isGeneratingPlan: isGeneratingPlan && selectedVideoId === video.id,
              isDeletingVideo: deletingVideoId === video.id,
              onGenerateStartFrame: (formatId: string, videoId: string, segmentIndex?: number) => {
                void handleGenerateStartFrame(formatId, videoId, segmentIndex);
              },
              onGenerateAllSegmentStartFrames: (formatId: string, videoId: string) => {
                void handleGenerateAllSegmentStartFrames(formatId, videoId);
              },
              onGenerateScriptCharacters: (formatId: string, videoId: string) => {
                void handleGenerateScriptCharacters(formatId, videoId);
              },
              isGeneratingStartFrame: generatingStartFrameVideoId === video.id,
              isGeneratingScriptCharacters: generatingScriptCharactersVideoId === video.id,
              generatingSegmentIndex,
              onUploadPreviousSegmentVideo: (
                formatId: string,
                videoId: string,
                segmentIndex: number,
                file: File
              ) => {
                void handleUploadPreviousSegmentVideo(formatId, videoId, segmentIndex, file);
              },
              isUploadingPreviousSegmentVideo: uploadingPreviousSegmentVideoId === video.id,
              uploadingPreviousSegmentIndex,
              plan: videoPlans[video.id] || null,
              hasR2Url: Boolean(getVideoR2Url(video)),
              isRefreshingR2: refreshingR2VideoId === video.id,
              onRefreshR2: (videoId: string) => { void handleRefreshR2(videoId); },
              error,
              success,
              onSelect: handleSelectVideo,
              onPlay: handlePlayVideo,
              onOpen: handleOpenSource,
              onDownload: handleDownloadVideo,
              onAspect: handleAspect,
            } satisfies VideoNodeData,
          });

          edges.push({
            id: `${formatNodeId}->${videoNodeId}`,
            source: formatNodeId,
            target: videoNodeId,
            type: "smoothstep",
            style: {
              stroke: "#c4b5fd",
              strokeWidth: 1.5,
              strokeDasharray: "4 4",
            },
          });
        });

        cursorX += groupWidth + formatGap;
      });
    });

    const positionedNodes = nodes.map((node) => {
      const override = nodePositions[node.id];
      if (!override) return node;
      return {
        ...node,
        position: override,
      };
    });

    return { nodes: positionedNodes, edges };
  }, [
    collectionId,
    orderedTypes,
    formatsByType,
    expandedType,
    handleToggleType,
    selectedFormatId,
    selectedVideoId,
    playingVideoId,
    reasoningModel,
    useMotionControl,
    useKlingMotionControl,
    startFrameImageModel,
    isLoadingCharacters,
    ugcCharacters,
    selectedUgcCharacterId,
    isGeneratingPlan,
    deletingVideoId,
    generatingStartFrameVideoId,
    generatingScriptCharactersVideoId,
    generatingSegmentIndex,
    uploadingPreviousSegmentVideoId,
    uploadingPreviousSegmentIndex,
    error,
    success,
    videoAspectRatios,
    videoPlans,
    refreshingR2VideoId,
    handleRefreshR2,
    router,
    handleSelectVideo,
    handlePlayVideo,
    handleOpenSource,
    handleDownloadVideo,
    handleAspect,
    handleGeneratePlan,
    handleDeleteVideo,
    handleGenerateStartFrame,
    handleGenerateAllSegmentStartFrames,
    handleGenerateScriptCharacters,
    handleUploadPreviousSegmentVideo,
    nodePositions,
  ]);

  const hasNodes = canvasGraph.nodes.length > 0;
  const showEmptyState = !isLoadingLibrary && !hasNodes && !error;
  const showErrorState = !isLoadingLibrary && !hasNodes && !!error;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[#eef2f7]">
      <section className="relative min-w-0 flex-1 overflow-hidden">
        <div className="absolute inset-0" style={{ width: "100%", height: "100%" }}>
          <ReactFlow
            nodes={canvasGraph.nodes}
            edges={canvasGraph.edges}
            nodeTypes={nodeTypes}
            onNodeDragStop={handleNodeDragStop}
            fitView
            fitViewOptions={{
              padding: 0.25,
              minZoom: 0.35,
              maxZoom: 1.1,
            }}
            minZoom={0.25}
            maxZoom={1.8}
            nodesDraggable
            nodeDragThreshold={8}
            nodesConnectable={false}
            elementsSelectable
            selectNodesOnDrag={false}
            panOnDrag
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Free}
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            className="bg-[#eff3f8]"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#cbd5e1" />
            <MiniMap
              pannable
              zoomable
              className="!bg-white"
              nodeStrokeColor="#cbd5e1"
              nodeColor="#f8fafc"
              nodeBorderRadius={8}
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {isLoadingLibrary ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-8 py-6 shadow-sm">
              <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
              <p className="text-sm font-medium text-slate-600">Loading video library...</p>
            </div>
          </div>
        ) : null}

        {showEmptyState ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-8 py-6 shadow-sm">
              <VideoIcon className="h-8 w-8 text-slate-400" />
              <p className="text-sm font-semibold text-slate-700">No videos yet</p>
              <p className="max-w-[260px] text-center text-xs text-slate-500">
                Click <strong>Add Video</strong> in the top bar to analyze a source video and start building your format library.
              </p>
            </div>
          </div>
        ) : null}

        {showErrorState ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-200 bg-white px-8 py-6 shadow-sm">
              <AlertCircle className="h-8 w-8 text-rose-500" />
              <p className="text-sm font-semibold text-slate-700">Failed to load library</p>
              <p className="max-w-[280px] text-center text-xs text-rose-600">{error}</p>
            </div>
          </div>
        ) : null}

        <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/collections/${collectionId}`)}
            className="pointer-events-auto bg-white"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsScriptAgentModalOpen(true)}
            className="pointer-events-auto bg-white"
          >
            <Sparkles className="mr-1.5 h-4 w-4" />
            Script Agent
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCycleDayAgentModalOpen(true)}
            className="pointer-events-auto bg-white"
          >
            <Clock className="mr-1.5 h-4 w-4" />
            Cycle Day Agent
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsIslamicSeriesAgentModalOpen(true)}
            className="pointer-events-auto bg-white"
          >
            <FileText className="mr-1.5 h-4 w-4" />
            Islamic Series Agent
          </Button>
        </div>

        <Dialog open={isScriptAgentModalOpen} onOpenChange={setIsScriptAgentModalOpen}>
          <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden p-0">
            <DialogHeader className="border-b border-slate-200">
              <DialogTitle className="text-base">Video Script Agent</DialogTitle>
              <DialogDescription className="text-xs text-slate-600">
                Generate original informational video scripts (no source video required).
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[74vh] space-y-3 overflow-y-auto px-6 pb-6 pt-4">
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Topic Brief (optional)</p>
                  <textarea
                    value={scriptAgentTopicBrief}
                    onChange={(event) => setScriptAgentTopicBrief(event.target.value)}
                    placeholder="Optional. Example: Practical guide for irregular periods after childbirth, with faith-sensitive worship tips and one subtle app support moment. If left empty, AI will choose a topic."
                    rows={4}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                  />
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Campaign Pattern</p>
                    <select
                      value={scriptAgentCampaignMode}
                      onChange={(event) => setScriptAgentCampaignMode(event.target.value as ScriptAgentSelectableCampaignMode)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                    >
                      <option value="standard">Standard educational</option>
                      <option value="widget_reaction_ugc">Widget reaction UGC</option>
                      <option value="widget_shock_hook_ugc">Widget shock-hook UGC</option>
                      <option value="ugc_shocking_fact_reaction">UGC shocking fact reaction</option>
                      <option value="widget_late_period_reaction_hook_ugc">Late-period reaction hook UGC (8s)</option>
                      <option value="ai_objects_educational_explainer">AI objects educational explainer (40-110s)</option>
                      <option value="mixed_media_relatable_pov">Mixed-media relatable POV (3D + real)</option>
                    </select>
                  </div>

                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Video Type</p>
                    <select
                      value={scriptAgentVideoType}
                      onChange={(event) => setScriptAgentVideoType(event.target.value as ScriptAgentVideoType)}
                      disabled={scriptAgentCampaignMode !== "standard"}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                    >
                      <option value="auto">Auto select</option>
                      <option value="ugc">UGC</option>
                      <option value="ai_animation">AI animation</option>
                      <option value="faceless_broll">Faceless B-roll</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </div>

                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Target Duration (seconds)</p>
                    <input
                      type="number"
                      min={
                        scriptAgentCampaignMode === "widget_late_period_reaction_hook_ugc"
                          ? 8
                          : scriptAgentCampaignMode === "ugc_shocking_fact_reaction"
                            ? 24
                          : scriptAgentCampaignMode === "mixed_media_relatable_pov"
                            ? 18
                          : scriptAgentCampaignMode === "ai_objects_educational_explainer"
                            ? 40
                            : 30
                      }
                      max={
                        scriptAgentCampaignMode === "widget_late_period_reaction_hook_ugc"
                          ? 8
                          : scriptAgentCampaignMode === "ugc_shocking_fact_reaction"
                            ? 90
                          : scriptAgentCampaignMode === "mixed_media_relatable_pov"
                            ? 45
                          : scriptAgentCampaignMode === "ai_objects_educational_explainer"
                            ? 110
                            : 180
                      }
                      disabled={scriptAgentCampaignMode === "widget_late_period_reaction_hook_ugc"}
                      value={scriptAgentDurationSeconds}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isFinite(value)) return;
                        const min =
                          scriptAgentCampaignMode === "widget_late_period_reaction_hook_ugc"
                            ? 8
                            : scriptAgentCampaignMode === "ugc_shocking_fact_reaction"
                              ? 24
                            : scriptAgentCampaignMode === "mixed_media_relatable_pov"
                              ? 18
                            : scriptAgentCampaignMode === "ai_objects_educational_explainer"
                              ? 40
                              : 30;
                        const max =
                          scriptAgentCampaignMode === "widget_late_period_reaction_hook_ugc"
                            ? 8
                            : scriptAgentCampaignMode === "ugc_shocking_fact_reaction"
                              ? 90
                            : scriptAgentCampaignMode === "mixed_media_relatable_pov"
                              ? 45
                            : scriptAgentCampaignMode === "ai_objects_educational_explainer"
                              ? 110
                              : 180;
                        setScriptAgentDurationSeconds(Math.max(min, Math.min(max, Math.round(value))));
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                    />
                  </div>

                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Character</p>
                    <select
                      value={scriptAgentCharacterId}
                      onChange={(event) => setScriptAgentCharacterId(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                    >
                      <option value="auto">Auto/default character</option>
                      {ugcCharacters
                        .filter((character) => {
                          const type = character.characterType || "ugc";
                          if (
                            scriptAgentCampaignMode === "widget_reaction_ugc" ||
                            scriptAgentCampaignMode === "widget_shock_hook_ugc" ||
                            scriptAgentCampaignMode === "ugc_shocking_fact_reaction" ||
                            scriptAgentCampaignMode === "widget_late_period_reaction_hook_ugc"
                          ) {
                            return type === "ugc";
                          }
                          if (scriptAgentCampaignMode === "mixed_media_relatable_pov") {
                            return type === "animated";
                          }
                          if (scriptAgentVideoType === "ai_animation") return type === "animated";
                          if (scriptAgentVideoType === "ugc") return type === "ugc";
                          if (scriptAgentVideoType === "hybrid") return type === "ugc";
                          return true;
                        })
                        .map((character) => (
                        <option key={character.id} value={character.id}>
                          {character.characterName}
                          {character.characterType ? ` (${character.characterType})` : ""}
                          {character.isDefault ? " (Default)" : ""}
                        </option>
                        ))}
                    </select>
                  </div>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  isLoading={isGeneratingScriptAgentPlan}
                  onClick={() => void handleGenerateScriptAgentPlan()}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {isGeneratingScriptAgentPlan ? "Generating..." : "Generate Script Plan"}
                </Button>

                {scriptAgentError ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">{scriptAgentError}</div>
                ) : null}
                {scriptAgentSuccess ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700">{scriptAgentSuccess}</div>
                ) : null}
              </div>

              {scriptAgentPlan ? (
                <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
                  <div>
                    <p className="text-xs font-semibold text-violet-800">{scriptAgentPlan.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {scriptAgentPlan.campaignMode ? (
                        <Badge variant="default">{scriptAgentPlan.campaignMode.replace(/_/g, " ")}</Badge>
                      ) : null}
                      <Badge variant="default">{scriptAgentPlan.topicCategory.replace(/_/g, " ")}</Badge>
                      <Badge variant="default">{scriptAgentPlan.selectedVideoType.replace(/_/g, " ")}</Badge>
                      <Badge variant="default">{`${scriptAgentPlan.targetDurationSeconds}s`}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-700">{scriptAgentPlan.objective}</p>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Script</p>
                    <p className="mt-1 text-xs text-slate-700"><span className="font-semibold text-slate-500">Hook:</span> {scriptAgentPlan.script.hook}</p>
                    <div className="mt-1.5 space-y-1.5">
                      {scriptAgentPlan.script.beats.map((beat, i) => (
                        <div key={`agent-beat-${i}`} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                          <p className="text-[10px] font-mono text-slate-500">{beat.timecode}</p>
                          {beat.visual ? <p className="text-xs text-slate-700"><span className="font-semibold text-slate-500">Visual:</span> {beat.visual}</p> : null}
                          {beat.narration ? <p className="text-xs text-slate-700"><span className="font-semibold text-slate-500">VO:</span> {beat.narration}</p> : null}
                          {beat.onScreenText ? <p className="text-xs text-slate-700"><span className="font-semibold text-slate-500">Text:</span> {beat.onScreenText}</p> : null}
                        </div>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-slate-700"><span className="font-semibold text-slate-500">CTA:</span> {scriptAgentPlan.script.cta}</p>
                  </div>

                  {scriptAgentPlan.motionControlSegments?.length ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Shot Groups</p>
                      <div className="mt-1.5 space-y-1.5">
                        {scriptAgentPlan.motionControlSegments.map((segment) => (
                          <div key={`agent-segment-${segment.segmentId}`} className="rounded border border-indigo-200 bg-white px-2 py-1.5">
                            <p className="text-xs font-semibold text-indigo-700">{`Segment ${segment.segmentId} - ${segment.timecode}`}</p>
                            <p className="text-[11px] text-slate-700"><span className="font-semibold text-slate-500">Start Frame:</span> {segment.startFramePrompt}</p>
                            {segment.veoPrompt ? (
                              <div className="mt-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Veo 3.1 Prompt</p>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7"
                                    onClick={() => void handleCopyScriptAgentVeoPrompt(segment.segmentId, segment.veoPrompt || "")}
                                  >
                                    <Copy className="mr-1 h-3.5 w-3.5" />
                                    {copiedScriptAgentSegmentId === segment.segmentId ? "Copied" : "Copy"}
                                  </Button>
                                </div>
                                <p className="whitespace-pre-wrap text-[11px] text-slate-700">{segment.veoPrompt}</p>
                              </div>
                            ) : null}
                            {!segment.veoPrompt && segment.multiShotPrompts?.length ? (
                              <div className="mt-1 space-y-1">
                                {segment.multiShotPrompts.map((shot, idx) => (
                                  <div key={`agent-shot-${segment.segmentId}-${idx}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                                    <p className="text-[10px] font-semibold text-slate-600">{shot.shotId || `shot${idx + 1}`}</p>
                                    <p className="text-[11px] text-slate-600">{shot.prompt}</p>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isCycleDayAgentModalOpen} onOpenChange={setIsCycleDayAgentModalOpen}>
          <DialogContent className="max-h-[88vh] max-w-4xl overflow-hidden p-0">
            <DialogHeader className="border-b border-slate-200">
              <DialogTitle className="text-base">Cycle Day Agent</DialogTitle>
              <DialogDescription className="text-xs text-slate-600">
                Generate calendar-based cycle plans, then pick one cycle day to produce a full 3D animated day-in-the-life Quran diary script.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[74vh] space-y-3 overflow-y-auto px-6 pb-6 pt-4">
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Step 1: Generate Full Cycle Plan</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cycle Start Date</p>
                    <input
                      type="date"
                      value={cycleDayPlanStartDate}
                      onChange={(event) => setCycleDayPlanStartDate(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cycle Length (days)</p>
                    <input
                      type="number"
                      min={24}
                      max={40}
                      value={cycleDayPlanLength}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isFinite(value)) return;
                        setCycleDayPlanLength(Math.max(24, Math.min(40, Math.round(value))));
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full"
                      isLoading={isGeneratingCycleDayPlan}
                      onClick={() => void handleGenerateCycleDayPlan()}
                    >
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      {isGeneratingCycleDayPlan ? "Generating Plan..." : "Generate Cycle Plan"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Step 2: Pick Day + Generate Script</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cycle Plan</p>
                    <select
                      value={selectedCycleDayPlanId}
                      onChange={(event) => setSelectedCycleDayPlanId(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                    >
                      <option value="latest">Latest plan</option>
                      {cycleDayPlans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {`Plan ${plan.planNumber} | ${plan.cycleStartDate} | ${plan.cycleLengthDays} days`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cycle Day</p>
                    <select
                      value={selectedCycleDayNumber}
                      onChange={(event) => setSelectedCycleDayNumber(Number(event.target.value))}
                      disabled={!selectedCycleDayOptions.length}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                    >
                      {selectedCycleDayOptions.length === 0 ? (
                        <option value={1}>No days available</option>
                      ) : (
                        selectedCycleDayOptions.map((day) => (
                          <option key={`${day.dayNumber}-${day.calendarDate}`} value={day.dayNumber}>
                            {`Day ${day.dayNumber} (${day.calendarDate})${day.isIstihada ? " - istihada" : ""}${day.isPeriodDay ? " - period" : ""}`}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Character</p>
                    <select
                      value={cycleDayCharacterId}
                      onChange={(event) => setCycleDayCharacterId(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                    >
                      <option value="auto">Auto/default animated character</option>
                      {ugcCharacters
                        .filter((character) => (character.characterType || "ugc") === "animated")
                        .map((character) => (
                          <option key={character.id} value={character.id}>
                            {character.characterName}
                            {character.isDefault ? " (Default)" : ""}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Duration (seconds, optional)</p>
                    <input
                      type="number"
                      min={30}
                      value={cycleDayDurationSeconds}
                      onChange={(event) => setCycleDayDurationSeconds(event.target.value)}
                      placeholder="Auto"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="min-w-[220px]"
                    isLoading={isGeneratingCycleDayScript}
                    onClick={() => void handleGenerateCycleDayScript()}
                    disabled={isLoadingCycleDayPlans || cycleDayPlans.length === 0}
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    {isGeneratingCycleDayScript ? "Generating Day Script..." : "Generate Cycle Day Script"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    isLoading={isLoadingCycleDayPlans}
                    onClick={() => void loadCycleDayPlans()}
                  >
                    Refresh Plans
                  </Button>
                </div>

                {selectedCycleDayPlan ? (
                  <div className="rounded border border-slate-200 bg-white px-2.5 py-2">
                    <p className="text-xs font-semibold text-slate-700">{selectedCycleDayPlan.title || `Cycle Plan ${selectedCycleDayPlan.planNumber}`}</p>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      {`Plan ${selectedCycleDayPlan.planNumber} | Start ${selectedCycleDayPlan.cycleStartDate} | ${selectedCycleDayPlan.cycleLengthDays} days`}
                    </p>
                    {selectedCycleDayPlan.overview ? (
                      <p className="mt-1 text-[11px] text-slate-600">{selectedCycleDayPlan.overview}</p>
                    ) : null}
                  </div>
                ) : null}

                {cycleDayAgentError ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">{cycleDayAgentError}</div>
                ) : null}
                {cycleDayAgentSuccess ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700">{cycleDayAgentSuccess}</div>
                ) : null}
              </div>

              {cycleDayAgentPlan ? (
                <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
                  <div>
                    <p className="text-xs font-semibold text-indigo-800">{cycleDayAgentPlan.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="default">{cycleDayAgentPlan.campaignMode?.replace(/_/g, " ") || "cycle day"}</Badge>
                      <Badge variant="default">{cycleDayAgentPlan.selectedVideoType.replace(/_/g, " ")}</Badge>
                      <Badge variant="default">{`${cycleDayAgentPlan.targetDurationSeconds}s`}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-700">{cycleDayAgentPlan.objective}</p>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Script</p>
                    <p className="mt-1 text-xs text-slate-700"><span className="font-semibold text-slate-500">Hook:</span> {cycleDayAgentPlan.script.hook}</p>
                    <div className="mt-1.5 space-y-1.5">
                      {cycleDayAgentPlan.script.beats.map((beat, i) => (
                        <div key={`cycle-agent-beat-${i}`} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                          <p className="text-[10px] font-mono text-slate-500">{beat.timecode}</p>
                          {beat.visual ? <p className="text-xs text-slate-700"><span className="font-semibold text-slate-500">Visual:</span> {beat.visual}</p> : null}
                          {beat.narration ? <p className="text-xs text-slate-700"><span className="font-semibold text-slate-500">VO:</span> {beat.narration}</p> : null}
                          {beat.onScreenText ? <p className="text-xs text-slate-700"><span className="font-semibold text-slate-500">Text:</span> {beat.onScreenText}</p> : null}
                        </div>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-slate-700"><span className="font-semibold text-slate-500">CTA:</span> {cycleDayAgentPlan.script.cta}</p>
                  </div>

                  {cycleDayAgentPlan.motionControlSegments?.length ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Shot Groups</p>
                      <div className="mt-1.5 space-y-1.5">
                        {cycleDayAgentPlan.motionControlSegments.map((segment) => (
                          <div key={`cycle-agent-segment-${segment.segmentId}`} className="rounded border border-indigo-200 bg-white px-2 py-1.5">
                            <p className="text-xs font-semibold text-indigo-700">{`Segment ${segment.segmentId} - ${segment.timecode}`}</p>
                            <p className="text-[11px] text-slate-700"><span className="font-semibold text-slate-500">Start Frame:</span> {segment.startFramePrompt}</p>
                            {segment.veoPrompt ? (
                              <div className="mt-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Veo 3.1 Prompt</p>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7"
                                    onClick={() => void handleCopyScriptAgentVeoPrompt(segment.segmentId, segment.veoPrompt || "")}
                                  >
                                    <Copy className="mr-1 h-3.5 w-3.5" />
                                    {copiedScriptAgentSegmentId === segment.segmentId ? "Copied" : "Copy"}
                                  </Button>
                                </div>
                                <p className="whitespace-pre-wrap text-[11px] text-slate-700">{segment.veoPrompt}</p>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isIslamicSeriesAgentModalOpen} onOpenChange={setIsIslamicSeriesAgentModalOpen}>
          <DialogContent className="max-h-[88vh] max-w-4xl overflow-hidden p-0">
            <DialogHeader className="border-b border-slate-200">
              <DialogTitle className="text-base">Islamic Menstruation Series Agent</DialogTitle>
              <DialogDescription className="text-xs text-slate-600">
                Generate 3D animated series episodes (~2:30) from foundational to advanced madhab-based menstruation teachings.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[74vh] space-y-3 overflow-y-auto px-6 pb-6 pt-4">
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Episode Setup</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Episode</p>
                    <select
                      value={selectedIslamicSeriesEpisodeId}
                      onChange={(event) => setSelectedIslamicSeriesEpisodeId(event.target.value)}
                      disabled={!islamicSeriesKnowledge?.topics?.length}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                    >
                      {(islamicSeriesKnowledge?.topics || []).map((topic) => (
                        <option key={topic.id} value={topic.id}>
                          {`${topic.title} (${topic.phase})`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Duration (seconds)</p>
                    <input
                      type="number"
                      min={120}
                      max={210}
                      value={islamicSeriesDurationSeconds}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isFinite(value)) return;
                        setIslamicSeriesDurationSeconds(Math.max(120, Math.min(210, Math.round(value))));
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                    />
                  </div>

                  <div className="flex items-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      isLoading={isLoadingIslamicSeriesMeta}
                      onClick={() => void loadIslamicSeriesMeta()}
                    >
                      Refresh Series Data
                    </Button>
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Custom Focus (optional)</p>
                  <textarea
                    value={islamicSeriesCustomFocus}
                    onChange={(event) => setIslamicSeriesCustomFocus(event.target.value)}
                    rows={3}
                    placeholder="Optional: Add custom angle for this episode, e.g. focus on Hanafi vs Shafii practical differences for prayer windows."
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                  />
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  isLoading={isGeneratingIslamicSeriesEpisode}
                  onClick={() => void handleGenerateIslamicSeriesEpisode()}
                  disabled={!selectedIslamicSeriesEpisode}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {isGeneratingIslamicSeriesEpisode ? "Generating Episode..." : "Generate Series Episode Script"}
                </Button>

                {selectedIslamicSeriesEpisode ? (
                  <div className="rounded border border-slate-200 bg-white px-2.5 py-2">
                    <p className="text-xs font-semibold text-slate-700">{selectedIslamicSeriesEpisode.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-600">{selectedIslamicSeriesEpisode.learningGoal}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {`Certainty tags: ${selectedIslamicSeriesEpisode.certaintyTags.join(", ")}`}
                    </p>
                  </div>
                ) : null}

                {islamicSeriesDocumentationPath ? (
                  <p className="text-[11px] text-slate-500">Knowledge base: <span className="font-mono">{islamicSeriesDocumentationPath}</span></p>
                ) : null}

                {islamicSeriesError ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">{islamicSeriesError}</div>
                ) : null}
                {islamicSeriesSuccess ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700">{islamicSeriesSuccess}</div>
                ) : null}
              </div>

              {islamicSeriesSavedPlans.length ? (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Saved Series Episodes</p>
                  <div className="space-y-1.5">
                    {islamicSeriesSavedPlans.slice(0, 10).map((item) => (
                      <div key={item.id} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                        <p className="text-xs font-semibold text-slate-700">{`Plan ${item.planNumber} - ${item.episodeTitle}`}</p>
                        <p className="text-[11px] text-slate-600">{`${item.phase} | ${item.targetDurationSeconds}s | ${new Date(item.createdAt).toLocaleString()}`}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {islamicSeriesPlan ? (
                <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
                  <div>
                    <p className="text-xs font-semibold text-indigo-800">{islamicSeriesPlan.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="default">{islamicSeriesEpisode?.phase || "series"}</Badge>
                      <Badge variant="default">{islamicSeriesPlan.selectedVideoType.replace(/_/g, " ")}</Badge>
                      <Badge variant="default">{`${islamicSeriesPlan.targetDurationSeconds}s`}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-700">{islamicSeriesPlan.objective}</p>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Script</p>
                    <p className="mt-1 text-xs text-slate-700"><span className="font-semibold text-slate-500">Hook:</span> {islamicSeriesPlan.script.hook}</p>
                    <div className="mt-1.5 space-y-1.5">
                      {islamicSeriesPlan.script.beats.map((beat, i) => (
                        <div key={`islamic-series-beat-${i}`} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                          <p className="text-[10px] font-mono text-slate-500">{beat.timecode}</p>
                          {beat.visual ? <p className="text-xs text-slate-700"><span className="font-semibold text-slate-500">Visual:</span> {beat.visual}</p> : null}
                          {beat.narration ? <p className="text-xs text-slate-700"><span className="font-semibold text-slate-500">VO:</span> {beat.narration}</p> : null}
                          {beat.onScreenText ? <p className="text-xs text-slate-700"><span className="font-semibold text-slate-500">Text:</span> {beat.onScreenText}</p> : null}
                        </div>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-slate-700"><span className="font-semibold text-slate-500">CTA:</span> {islamicSeriesPlan.script.cta}</p>
                  </div>

                  {islamicSeriesPlan.motionControlSegments?.length ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Shot Groups</p>
                      <div className="mt-1.5 space-y-1.5">
                        {islamicSeriesPlan.motionControlSegments.map((segment) => (
                          <div key={`islamic-series-segment-${segment.segmentId}`} className="rounded border border-indigo-200 bg-white px-2 py-1.5">
                            <p className="text-xs font-semibold text-indigo-700">{`Segment ${segment.segmentId} - ${segment.timecode}`}</p>
                            <p className="text-[11px] text-slate-700"><span className="font-semibold text-slate-500">Start Frame:</span> {segment.startFramePrompt}</p>
                            {segment.veoPrompt ? (
                              <div className="mt-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Veo 3.1 Prompt</p>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7"
                                    onClick={() => void handleCopyScriptAgentVeoPrompt(segment.segmentId, segment.veoPrompt || "")}
                                  >
                                    <Copy className="mr-1 h-3.5 w-3.5" />
                                    {copiedScriptAgentSegmentId === segment.segmentId ? "Copied" : "Copy"}
                                  </Button>
                                </div>
                                <p className="whitespace-pre-wrap text-[11px] text-slate-700">{segment.veoPrompt}</p>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>

      </section>
    </div>
  );
}
