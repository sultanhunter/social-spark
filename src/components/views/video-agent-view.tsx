"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  Clapperboard,
  Copy,
  ExternalLink,
  Link2,
  Plus,
  Play,
  Sparkles,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/app-store";
import {
  DEFAULT_REASONING_MODEL,
  REASONING_MODELS,
  isReasoningModel,
  type ReasoningModel,
} from "@/lib/reasoning-model";

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

type IntakeResponse = {
  createdNewFormat?: boolean;
  groupedVideoCount?: number | null;
  format?: { id?: string };
  video?: { id?: string };
  error?: string;
};

type PlanBeat = {
  timecode: string;
  visual: string;
  narration: string;
  onScreenText: string;
  editNote: string;
};

type HiggsfieldPrompt = {
  scene: string;
  prompt: string;
  recommendedModel?: string;
  modelReason?: string;
  shotDuration?: string;
};

type VideoPlan = {
  title: string;
  strategy: string;
  objective: string;
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
  higgsfieldPrompts: HiggsfieldPrompt[];
  productionSteps: string[];
  editingTimeline: string[];
  assetsChecklist: string[];
  qaChecklist: string[];
};

type RecreateResponse = {
  plan?: VideoPlan;
  planId?: string | null;
  generatedAt?: string;
  error?: string;
};

type SavedPlan = {
  id: string;
  format_id: string;
  source_video_id: string;
  reasoningModel?: string | null;
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
  isDefault?: boolean;
};

type CharacterResponse = {
  characters?: UgcCharacter[];
  character?: UgcCharacter | null;
  error?: string;
};

type FormatNodeData = {
  format: LibraryFormat;
  expanded: boolean;
  selectedFormatId: string | null;
  onToggle: (formatId: string) => void;
  onSelect: (formatId: string) => void;
};

type VideoNodeData = {
  formatId: string;
  video: LibraryVideo;
  ratio: number;
  selectedVideoId: string | null;
  playingVideoId: string | null;
  directMediaUrl: string | null;
  onSelect: (formatId: string, videoId: string) => void;
  onPlay: (formatId: string, videoId: string) => void;
  onOpen: (url: string) => void;
  onAspect: (videoId: string, ratio: number) => void;
};

type IntakeNodeData = {
  sourceUrl: string;
  userNotes: string;
  isAnalyzing: boolean;
  onSourceChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onAnalyze: () => void;
};

type PlanNodeData = {
  savedPlan: SavedPlan;
  selectedPlanId: string | null;
  onSelect: (planId: string) => void;
};

type ControlsNodeData = {
  appName: string;
  formatCount: number;
  isLoadingLibrary: boolean;
  selectedFormatType: string | null;
  selectedVideoTitle: string | null;
  selectedVideoPlatform: string | null;
  selectedVideoSourceUrl: string | null;
  reasoningModel: ReasoningModel;
  onReasoningModelChange: (value: string) => void;
  isUgcSelected: boolean;
  isLoadingCharacters: boolean;
  selectedUgcCharacterId: string | null;
  ugcCharacters: UgcCharacter[];
  onCharacterChange: (value: string | null) => void;
  onOpenCharacterStudio: () => void;
  onGeneratePlan: () => void;
  isGeneratingPlan: boolean;
  hasSelectedVideo: boolean;
  isLoadingPlans: boolean;
  savedPlanCount: number;
  error: string;
  success: string;
  onOpenSelectedSource: (url: string) => void;
};

type PlanDetailNodeData = {
  plan: VideoPlan;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onCopyScript: () => void;
  onCopyHiggsfield: () => void;
};

function formatTypeVariant(type: string): "default" | "video" | "success" {
  if (type === "ugc") return "video";
  if (type === "ai_video") return "success";
  return "default";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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

function getVideoAnalysisMethod(video: LibraryVideo): string | null {
  const analysis = getVideoFormatAnalysis(video);
  const method = analysis?.analysisMethod;
  return typeof method === "string" ? method : null;
}

function getVideoFrameCount(video: LibraryVideo): number | null {
  const analysis = getVideoFormatAnalysis(video);
  const count = analysis?.sampledFrameCount;
  return typeof count === "number" && Number.isFinite(count) ? count : null;
}

function getVideoDirectMediaUrl(video: LibraryVideo): string | null {
  const analysis = getVideoFormatAnalysis(video);
  const url = analysis?.directMediaUrl;
  return typeof url === "string" && url.trim().length > 0 ? url : null;
}

function getPromptModel(item: HiggsfieldPrompt): string {
  const value = typeof item.recommendedModel === "string" ? item.recommendedModel.trim() : "";
  return value || "Higgsfield Realistic Character";
}

function getPromptReason(item: HiggsfieldPrompt): string {
  const value = typeof item.modelReason === "string" ? item.modelReason.trim() : "";
  return value || "Best for natural human motion and identity consistency.";
}

function getPromptDuration(item: HiggsfieldPrompt): string {
  const value = typeof item.shotDuration === "string" ? item.shotDuration.trim() : "";
  return value || "4s";
}

function buildScriptClipboardText(plan: VideoPlan): string {
  const beats = plan.script.beats
    .map(
      (beat, index) =>
        `Beat ${index + 1} (${beat.timecode})\nVisual: ${beat.visual}\nNarration: ${beat.narration}\nOn-screen text: ${beat.onScreenText}\nEdit note: ${beat.editNote}`
    )
    .join("\n\n");

  return [`Hook: ${plan.script.hook}`, "", beats, "", `CTA: ${plan.script.cta}`].join("\n");
}

function buildHiggsfieldClipboardText(plan: VideoPlan): string {
  return plan.higgsfieldPrompts
    .map(
      (item, index) =>
        `Scene ${index + 1} - ${item.scene}\nDuration: ${getPromptDuration(item)}\nModel: ${getPromptModel(item)}\nWhy: ${getPromptReason(item)}\nPrompt: ${item.prompt}`
    )
    .join("\n\n");
}

function FormatCanvasNode({ data }: NodeProps<Node<FormatNodeData>>) {
  const isActive = data.selectedFormatId === data.format.id;

  return (
    <div className={`min-w-[260px] rounded-2xl border bg-white px-3 py-2 shadow-sm ${isActive ? "border-rose-300" : "border-slate-200"}`}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-violet-300" />
      <button
        type="button"
        onClick={() => {
          data.onSelect(data.format.id);
          data.onToggle(data.format.id);
        }}
        className="nodrag flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{data.format.format_name}</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={formatTypeVariant(data.format.format_type)}>{data.format.format_type}</Badge>
            <Badge variant="default">{data.format.videos.length} videos</Badge>
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${data.expanded ? "rotate-180" : ""}`} />
      </button>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-violet-300" />
    </div>
  );
}

function VideoCanvasNode({ data }: NodeProps<Node<VideoNodeData>>) {
  const isSelected = data.selectedVideoId === data.video.id;
  const isPlaying = data.directMediaUrl && data.playingVideoId === data.video.id;

  return (
    <div className={`w-[230px] rounded-2xl border bg-white p-2.5 shadow-sm ${isSelected ? "border-rose-300 ring-2 ring-rose-100" : "border-slate-200"}`}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-violet-300" />

      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          data.onSelect(data.formatId, data.video.id);
          if (data.directMediaUrl) {
            data.onPlay(data.formatId, data.video.id);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            data.onSelect(data.formatId, data.video.id);
            if (data.directMediaUrl) {
              data.onPlay(data.formatId, data.video.id);
            }
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
              muted
              playsInline
              preload="metadata"
              poster={data.video.thumbnail_url || undefined}
              className="h-full w-full object-cover"
              onLoadedMetadata={(event) => {
                const target = event.currentTarget;
                if (target.videoWidth > 0 && target.videoHeight > 0) {
                  data.onAspect(data.video.id, target.videoWidth / target.videoHeight);
                }
              }}
            />
          ) : data.video.thumbnail_url ? (
            <img
              src={data.video.thumbnail_url}
              alt={data.video.title || "Video thumbnail"}
              className="h-full w-full object-cover"
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0) {
                  data.onAspect(data.video.id, naturalWidth / naturalHeight);
                }
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-500">
              <Clapperboard className="h-6 w-6" />
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
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Badge variant="default">{data.video.platform}</Badge>
        {(() => {
          const method = getVideoAnalysisMethod(data.video);
          const frameCount = getVideoFrameCount(data.video);
          if (!method) return null;
          return <Badge variant="default">{method.replace(/_/g, " ")}{typeof frameCount === "number" ? ` (${frameCount})` : ""}</Badge>;
        })()}
      </div>

      <div className="mt-2 flex items-center justify-between">
        {data.directMediaUrl ? (
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
        ) : <span />}

        <Button variant="ghost" size="sm" onClick={() => data.onOpen(data.video.source_url)} className="nodrag">
          <ExternalLink className="mr-1 h-3.5 w-3.5" />
          Open
        </Button>
      </div>
    </div>
  );
}

function IntakeCanvasNode({ data }: NodeProps<Node<IntakeNodeData>>) {
  return (
    <div className="w-[360px] rounded-2xl border border-rose-200 bg-white p-3 shadow-sm">
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-rose-300" />

      <div className="mb-2 flex items-center gap-2">
        <div className="rounded-full bg-rose-100 p-1.5 text-rose-600">
          <Plus className="h-3.5 w-3.5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">Add Source Video</p>
          <p className="text-xs text-slate-500">Paste URL and group it on canvas.</p>
        </div>
      </div>

      <div className="space-y-2">
        <Input
          icon={<Link2 className="h-4 w-4" />}
          placeholder="https://..."
          value={data.sourceUrl}
          onChange={(event) => data.onSourceChange(event.target.value)}
        />
        <textarea
          value={data.userNotes}
          onChange={(event) => data.onNotesChange(event.target.value)}
          rows={2}
          placeholder="Optional notes..."
          className="nodrag w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
        />
        <Button variant="primary" onClick={data.onAnalyze} isLoading={data.isAnalyzing} className="nodrag w-full">
          <Sparkles className="mr-2 h-4 w-4" />
          {data.isAnalyzing ? "Analyzing..." : "Analyze & Group"}
        </Button>
      </div>
    </div>
  );
}

function PlanCanvasNode({ data }: NodeProps<Node<PlanNodeData>>) {
  const selected = data.selectedPlanId === data.savedPlan.id;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => data.onSelect(data.savedPlan.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          data.onSelect(data.savedPlan.id);
        }
      }}
      className={`w-[260px] cursor-pointer rounded-xl border bg-white p-2.5 shadow-sm ${
        selected ? "border-rose-300 ring-2 ring-rose-100" : "border-slate-200"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-violet-300" />
      <p className="truncate text-xs font-semibold text-slate-800">{data.savedPlan.plan.title || "Saved plan"}</p>
      <p className="mt-1 text-[11px] text-slate-500">
        {formatDateTime(data.savedPlan.generatedAt || data.savedPlan.created_at)}
      </p>
      {data.savedPlan.reasoningModel ? (
        <Badge variant="default" className="mt-1.5">
          {data.savedPlan.reasoningModel}
        </Badge>
      ) : null}
    </div>
  );
}

function ControlsCanvasNode({ data }: NodeProps<Node<ControlsNodeData>>) {
  return (
    <div className="w-[360px] rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-violet-300" />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-violet-300" />

      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">Plan Controls</p>
        <Badge variant="default" className="max-w-[170px] truncate">{data.appName}</Badge>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="default">
            {data.isLoadingLibrary ? "Loading..." : `${data.formatCount} formats`}
          </Badge>
          {data.selectedFormatType ? (
            <Badge variant={formatTypeVariant(data.selectedFormatType)}>{data.selectedFormatType}</Badge>
          ) : null}
        </div>

        <select
          value={data.reasoningModel}
          onChange={(event) => data.onReasoningModelChange(event.target.value)}
          className="nodrag w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
        >
          {REASONING_MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>

        {data.isUgcSelected ? (
          <>
            <select
              value={data.selectedUgcCharacterId || ""}
              onChange={(event) => data.onCharacterChange(event.target.value || null)}
              disabled={data.isLoadingCharacters}
              className="nodrag w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
            >
              <option value="">{data.isLoadingCharacters ? "Loading characters..." : "Select UGC character"}</option>
              {data.ugcCharacters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.characterName}
                  {character.isDefault ? " (Default)" : ""}
                </option>
              ))}
            </select>

            <Button variant="outline" size="sm" onClick={data.onOpenCharacterStudio} className="nodrag w-full">
              <Users className="mr-1.5 h-3.5 w-3.5" />
              Character Studio
            </Button>
          </>
        ) : null}

        {data.selectedVideoTitle ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
            <p className="truncate font-semibold text-slate-800">{data.selectedVideoTitle}</p>
            <p className="mt-1">{data.selectedVideoPlatform || "Unknown platform"}</p>
            {data.selectedVideoSourceUrl ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => data.onOpenSelectedSource(data.selectedVideoSourceUrl || "")}
                className="nodrag mt-1 h-7 px-2"
              >
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                Open source
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2.5 py-2 text-xs text-slate-500">
            Select a video node to generate a plan.
          </p>
        )}

        <Button
          variant="primary"
          onClick={data.onGeneratePlan}
          isLoading={data.isGeneratingPlan}
          disabled={!data.hasSelectedVideo}
          className="nodrag w-full"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {data.isGeneratingPlan ? "Generating..." : "Generate Plan"}
        </Button>

        <p className="text-xs text-slate-500">
          {data.isLoadingPlans
            ? "Loading saved plans..."
            : data.savedPlanCount > 0
            ? `${data.savedPlanCount} saved plans. Select plan nodes to switch.`
            : "No saved plans yet for selected video."}
        </p>

        {data.error ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{data.error}</span>
          </div>
        ) : null}

        {data.success ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-700">
            {data.success}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PlanDetailCanvasNode({ data }: NodeProps<Node<PlanDetailNodeData>>) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ${
        data.isExpanded ? "w-[430px]" : "w-[300px]"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-indigo-300" />

      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{data.plan.title}</p>
          <p className="text-xs text-slate-500">{data.plan.deliverableSpec.duration}</p>
        </div>
        <Button variant="outline" size="sm" className="nodrag h-7 px-2" onClick={data.onToggleExpanded}>
          {data.isExpanded ? "Collapse" : "Expand"}
        </Button>
      </div>

      <div className="mb-2 flex gap-2">
        <Button variant="outline" size="sm" onClick={data.onCopyScript} className="nodrag h-7 px-2">
          <Copy className="mr-1 h-3.5 w-3.5" />
          Script
        </Button>
        <Button variant="outline" size="sm" onClick={data.onCopyHiggsfield} className="nodrag h-7 px-2">
          <Copy className="mr-1 h-3.5 w-3.5" />
          Higgsfield
        </Button>
      </div>

      {data.isExpanded ? (
        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1 text-xs text-slate-700">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Strategy</p>
            <p className="mt-1">{data.plan.strategy}</p>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Script Hook</p>
            <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-2">{data.plan.script.hook}</p>
          </div>

          <div className="space-y-1.5">
            {data.plan.script.beats.map((beat, index) => (
              <div key={`${beat.timecode}-${index}`} className="rounded-md border border-slate-200 bg-white p-2">
                <p className="text-[11px] font-semibold text-slate-500">{beat.timecode}</p>
                <p><span className="font-semibold">Visual:</span> {beat.visual}</p>
                <p className="mt-0.5"><span className="font-semibold">Narration:</span> {beat.narration}</p>
                <p className="mt-0.5"><span className="font-semibold">On-screen:</span> {beat.onScreenText}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500">Expand this node to inspect the full plan details.</p>
      )}
    </div>
  );
}

const nodeTypes = {
  intakeNode: IntakeCanvasNode,
  controlsNode: ControlsCanvasNode,
  formatNode: FormatCanvasNode,
  videoNode: VideoCanvasNode,
  planNode: PlanCanvasNode,
  planDetailNode: PlanDetailCanvasNode,
};

export function VideoAgentView({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const { activeCollection } = useAppStore();

  const [sourceUrl, setSourceUrl] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [reasoningModel, setReasoningModel] = useState<ReasoningModel>(DEFAULT_REASONING_MODEL);

  const [library, setLibrary] = useState<LibraryFormat[]>([]);
  const [expandedFormats, setExpandedFormats] = useState<Record<string, boolean>>({});
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [videoAspectRatios, setVideoAspectRatios] = useState<Record<string, number>>({});

  const [ugcCharacters, setUgcCharacters] = useState<UgcCharacter[]>([]);
  const [selectedUgcCharacterId, setSelectedUgcCharacterId] = useState<string | null>(null);

  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [plan, setPlan] = useState<VideoPlan | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [isPlanDetailExpanded, setIsPlanDetailExpanded] = useState(false);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node, Edge> | null>(null);

  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(false);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedFormat = useMemo(
    () => library.find((format) => format.id === selectedFormatId) || null,
    [library, selectedFormatId]
  );

  const selectedVideo = useMemo(
    () => selectedFormat?.videos.find((video) => video.id === selectedVideoId) || null,
    [selectedFormat, selectedVideoId]
  );

  const selectedUgcCharacter = useMemo(
    () => ugcCharacters.find((character) => character.id === selectedUgcCharacterId) || null,
    [ugcCharacters, selectedUgcCharacterId]
  );

  const handleSelectVideo = useCallback((formatId: string, videoId: string) => {
    setSelectedFormatId(formatId);
    setSelectedVideoId(videoId);
  }, []);

  const handlePlayVideo = useCallback((formatId: string, videoId: string) => {
    setSelectedFormatId(formatId);
    setSelectedVideoId(videoId);
    setPlayingVideoId(videoId);
  }, []);

  const handleOpenSource = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
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

        const nextFormatId =
          (preferred?.formatId && formats.some((item) => item.id === preferred.formatId)
            ? preferred.formatId
            : null) ||
          (selectedFormatId && formats.some((item) => item.id === selectedFormatId)
            ? selectedFormatId
            : null) ||
          formats[0]?.id ||
          null;

        const nextFormat = formats.find((item) => item.id === nextFormatId) || null;

        const nextVideoId =
          (preferred?.videoId && formats.some((item) => item.videos.some((video) => video.id === preferred.videoId))
            ? preferred.videoId
            : null) ||
          (selectedVideoId && formats.some((item) => item.videos.some((video) => video.id === selectedVideoId))
            ? selectedVideoId
            : null) ||
          nextFormat?.videos[0]?.id ||
          null;

        setSelectedFormatId(nextFormatId);
        setSelectedVideoId(nextVideoId);

        setExpandedFormats((prev) => {
          const next = { ...prev };
          if (nextFormatId) next[nextFormatId] = true;
          if (formats.length > 0 && !Object.values(next).some(Boolean)) {
            next[formats[0].id] = true;
          }
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load video format library.");
      } finally {
        setIsLoadingLibrary(false);
      }
    },
    [collectionId, selectedFormatId, selectedVideoId]
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load UGC characters.");
    } finally {
      setIsLoadingCharacters(false);
    }
  }, [collectionId]);

  const loadSavedPlans = useCallback(
    async (options?: {
      formatId?: string | null;
      videoId?: string | null;
      preferredPlanId?: string | null;
    }) => {
      const formatId = options?.formatId ?? selectedFormatId;
      const videoId = options?.videoId ?? selectedVideoId;

      if (!formatId || !videoId) {
        setSavedPlans([]);
        setPlan(null);
        setPlanId(null);
        return;
      }

      setIsLoadingPlans(true);
      try {
        const response = await fetch(
          `/api/video-agent/plans?collectionId=${encodeURIComponent(collectionId)}&formatId=${encodeURIComponent(formatId)}&videoId=${encodeURIComponent(videoId)}&limit=20`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const data = (await response.json()) as PlansResponse;
        if (!response.ok) {
          throw new Error(data.error || "Failed to load saved recreation plans.");
        }

        const plans = Array.isArray(data.plans) ? data.plans : [];
        setSavedPlans(plans);

        const preferred =
          (options?.preferredPlanId
            ? plans.find((item) => item.id === options.preferredPlanId)
            : null) || plans[0] || null;

        if (!preferred) {
          setPlan(null);
          setPlanId(null);
          return;
        }

        setPlan(preferred.plan);
        setPlanId(preferred.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load saved recreation plans.");
      } finally {
        setIsLoadingPlans(false);
      }
    },
    [collectionId, selectedFormatId, selectedVideoId]
  );

  useEffect(() => {
    void loadLibrary();
    void loadCharacters();
  }, [loadLibrary, loadCharacters]);

  useEffect(() => {
    if (!selectedFormat) {
      setSelectedVideoId(null);
      return;
    }

    if (selectedVideoId && selectedFormat.videos.some((video) => video.id === selectedVideoId)) {
      return;
    }

    setSelectedVideoId(selectedFormat.videos[0]?.id || null);
  }, [selectedFormat, selectedVideoId]);

  useEffect(() => {
    void loadSavedPlans();
  }, [loadSavedPlans]);

  const handleAnalyze = useCallback(async () => {
    if (!sourceUrl.trim()) {
      setError("Paste a video URL first.");
      return;
    }

    setIsAnalyzing(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/video-agent/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          url: sourceUrl.trim(),
          userNotes: userNotes.trim() || null,
          reasoningModel,
        }),
      });

      const data = (await response.json()) as IntakeResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to analyze and group video.");
      }

      setSourceUrl("");
      const countText =
        typeof data.groupedVideoCount === "number"
          ? ` (${data.groupedVideoCount} videos in group)`
          : "";
      setSuccess(
        data.createdNewFormat
          ? `New format created${countText}.`
          : `Matched existing format${countText}.`
      );

      await loadLibrary({
        formatId: data.format?.id || null,
        videoId: data.video?.id || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze and group video.");
    } finally {
      setIsAnalyzing(false);
    }
  }, [collectionId, sourceUrl, userNotes, reasoningModel, loadLibrary]);

  const handleGeneratePlan = useCallback(async () => {
    if (!selectedFormat || !selectedVideo) {
      setError("Select a format and video first.");
      return;
    }

    if (selectedFormat.format_type === "ugc" && !selectedUgcCharacter) {
      setError("This is a UGC format. Select a character from Character Studio first.");
      return;
    }

    setIsGeneratingPlan(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/video-agent/recreate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          formatId: selectedFormat.id,
          videoId: selectedVideo.id,
          characterId: selectedFormat.format_type === "ugc" ? selectedUgcCharacter?.id : null,
          reasoningModel,
        }),
      });

      const data = (await response.json()) as RecreateResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate recreation plan.");
      }

      if (!data.plan) {
        throw new Error("No plan returned.");
      }

      setPlan(data.plan);
      setPlanId(data.planId || null);
      setIsPlanDetailExpanded(true);
      setSuccess("Recreation plan generated.");

      await loadSavedPlans({
        formatId: selectedFormat.id,
        videoId: selectedVideo.id,
        preferredPlanId: data.planId || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate recreation plan.");
    } finally {
      setIsGeneratingPlan(false);
    }
  }, [collectionId, selectedFormat, selectedVideo, selectedUgcCharacter, reasoningModel, loadSavedPlans]);

  const canvasGraph = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const videoPositions: Record<string, { x: number; y: number }> = {};
    const planNodePositions: Record<string, { x: number; y: number; nodeId: string }> = {};

    nodes.push({
      id: "intake-node",
      type: "intakeNode",
      position: { x: 120, y: 40 },
      data: {
        sourceUrl,
        userNotes,
        isAnalyzing,
        onSourceChange: (value: string) => setSourceUrl(value),
        onNotesChange: (value: string) => setUserNotes(value),
        onAnalyze: () => {
          void handleAnalyze();
        },
      } satisfies IntakeNodeData,
    });

    nodes.push({
      id: "controls-node",
      type: "controlsNode",
      position: { x: 520, y: 40 },
      data: {
        appName: activeCollection?.app_name || "Muslimah Pro",
        formatCount: library.length,
        isLoadingLibrary,
        selectedFormatType: selectedFormat?.format_type || null,
        selectedVideoTitle: selectedVideo?.title || null,
        selectedVideoPlatform: selectedVideo?.platform || null,
        selectedVideoSourceUrl: selectedVideo?.source_url || null,
        reasoningModel,
        onReasoningModelChange: (value: string) => {
          if (isReasoningModel(value)) setReasoningModel(value);
        },
        isUgcSelected: selectedFormat?.format_type === "ugc",
        isLoadingCharacters,
        selectedUgcCharacterId,
        ugcCharacters,
        onCharacterChange: (value: string | null) => setSelectedUgcCharacterId(value),
        onOpenCharacterStudio: () => router.push(`/collections/${collectionId}/characters`),
        onGeneratePlan: () => {
          void handleGeneratePlan();
        },
        isGeneratingPlan,
        hasSelectedVideo: Boolean(selectedVideo),
        isLoadingPlans,
        savedPlanCount: savedPlans.length,
        error,
        success,
        onOpenSelectedSource: handleOpenSource,
      } satisfies ControlsNodeData,
    });

    edges.push({
      id: "intake->controls",
      source: "intake-node",
      target: "controls-node",
      type: "smoothstep",
      style: {
        stroke: "#c4b5fd",
        strokeWidth: 1.6,
      },
    });

    let cursorY = 270;

    for (const format of library) {
      const expanded = Boolean(expandedFormats[format.id]);
      const formatNodeId = `format-${format.id}`;

      nodes.push({
        id: formatNodeId,
        type: "formatNode",
        position: { x: 120, y: cursorY },
        data: {
          format,
          expanded,
          selectedFormatId,
          onToggle: (id: string) => {
            setExpandedFormats((prev) => ({
              ...prev,
              [id]: !prev[id],
            }));
          },
          onSelect: (id: string) => setSelectedFormatId(id),
        } satisfies FormatNodeData,
      });

      edges.push({
        id: `intake->${formatNodeId}`,
        source: "intake-node",
        target: formatNodeId,
        type: "smoothstep",
        style: {
          stroke: "#fda4af",
          strokeWidth: 1.6,
          strokeDasharray: "4 4",
        },
      });

      if (!expanded) {
        cursorY += 170;
        continue;
      }

      const columns = 4;
      const spacingX = 270;
      const spacingY = 300;

      format.videos.forEach((video, index) => {
        const row = Math.floor(index / columns);
        const col = index % columns;
        const videoNodeId = `video-${video.id}`;

        nodes.push({
          id: videoNodeId,
          type: "videoNode",
          position: {
            x: 70 + col * spacingX,
            y: cursorY + 170 + row * spacingY,
          },
          data: {
            formatId: format.id,
            video,
            ratio: clampAspectRatio(videoAspectRatios[video.id] || 9 / 16),
            selectedVideoId,
            playingVideoId,
            directMediaUrl: getVideoDirectMediaUrl(video),
            onSelect: handleSelectVideo,
            onPlay: handlePlayVideo,
            onOpen: handleOpenSource,
            onAspect: handleAspect,
          } satisfies VideoNodeData,
        });

        videoPositions[video.id] = {
          x: 70 + col * spacingX,
          y: cursorY + 170 + row * spacingY,
        };

        edges.push({
          id: `${formatNodeId}->${videoNodeId}`,
          source: formatNodeId,
          target: videoNodeId,
          type: "smoothstep",
          style: {
            stroke: "#c4b5fd",
            strokeWidth: 1.6,
            strokeDasharray: "4 4",
          },
        });
      });

      const rows = Math.max(1, Math.ceil(format.videos.length / columns));
      cursorY += 190 + rows * spacingY;
    }

    if (selectedVideoId && videoPositions[selectedVideoId] && savedPlans.length > 0) {
      const anchor = videoPositions[selectedVideoId];

      savedPlans.forEach((saved, index) => {
        const planNodeId = `plan-${saved.id}`;

        nodes.push({
          id: planNodeId,
          type: "planNode",
          position: {
            x: anchor.x + 320,
            y: anchor.y + index * 120,
          },
          data: {
            savedPlan: saved,
            selectedPlanId: planId,
            onSelect: (selectedPlan) => {
              const match = savedPlans.find((item) => item.id === selectedPlan);
              if (!match) return;
              setPlan(match.plan);
              setPlanId(match.id);
              setIsPlanDetailExpanded(true);
              setSuccess("Loaded saved plan.");
            },
          } satisfies PlanNodeData,
        });

        planNodePositions[saved.id] = {
          x: anchor.x + 320,
          y: anchor.y + index * 120,
          nodeId: planNodeId,
        };

        edges.push({
          id: `video-${selectedVideoId}->${planNodeId}`,
          source: `video-${selectedVideoId}`,
          target: planNodeId,
          type: "smoothstep",
          style: {
            stroke: "#a5b4fc",
            strokeWidth: 1.4,
          },
        });
      });
    }

    if (plan && selectedVideoId && videoPositions[selectedVideoId]) {
      const selectedPlanPosition = planId ? planNodePositions[planId] : null;
      const fallbackAnchor = videoPositions[selectedVideoId];
      const detailX = selectedPlanPosition ? selectedPlanPosition.x + 300 : fallbackAnchor.x + 620;
      const detailY = selectedPlanPosition
        ? selectedPlanPosition.y - (isPlanDetailExpanded ? 60 : 20)
        : fallbackAnchor.y - (isPlanDetailExpanded ? 60 : 20);

      nodes.push({
        id: "plan-detail-node",
        type: "planDetailNode",
        position: {
          x: detailX,
          y: detailY,
        },
        data: {
          plan,
          isExpanded: isPlanDetailExpanded,
          onToggleExpanded: () => setIsPlanDetailExpanded((prev) => !prev),
          onCopyScript: () => {
            void navigator.clipboard.writeText(buildScriptClipboardText(plan));
          },
          onCopyHiggsfield: () => {
            void navigator.clipboard.writeText(buildHiggsfieldClipboardText(plan));
          },
        } satisfies PlanDetailNodeData,
      });

      const sourceNode = selectedPlanPosition ? selectedPlanPosition.nodeId : `video-${selectedVideoId}`;

      edges.push({
        id: `${sourceNode}->plan-detail-node`,
        source: sourceNode,
        target: "plan-detail-node",
        type: "smoothstep",
        style: {
          stroke: "#818cf8",
          strokeWidth: 1.5,
        },
      });
    }

    return { nodes, edges };
  }, [
    activeCollection?.app_name,
    collectionId,
    error,
    library,
    expandedFormats,
    handleGeneratePlan,
    sourceUrl,
    userNotes,
    isAnalyzing,
    isLoadingLibrary,
    isLoadingPlans,
    isLoadingCharacters,
    isGeneratingPlan,
    selectedFormatId,
    selectedFormat,
    selectedVideoId,
    selectedVideo,
    selectedUgcCharacterId,
    ugcCharacters,
    reasoningModel,
    success,
    playingVideoId,
    savedPlans,
    plan,
    planId,
    isPlanDetailExpanded,
    videoAspectRatios,
    router,
    handleSelectVideo,
    handlePlayVideo,
    handleOpenSource,
    handleAspect,
    handleAnalyze,
  ]);

  useEffect(() => {
    if (!flowInstance || !selectedVideoId) return;

    const focusIds = [`video-${selectedVideoId}`];
    if (selectedFormatId) {
      focusIds.push(`format-${selectedFormatId}`);
    }
    for (const saved of savedPlans) {
      focusIds.push(`plan-${saved.id}`);
    }
    if (plan) {
      focusIds.push("plan-detail-node");
    }

    const focusNodes = canvasGraph.nodes.filter((node) => focusIds.includes(node.id));
    if (focusNodes.length === 0) return;

    const timeoutId = window.setTimeout(() => {
      void flowInstance.fitView({
        nodes: focusNodes.map((node) => ({ id: node.id })),
        padding: 0.35,
        duration: 380,
        minZoom: 0.3,
        maxZoom: 1.1,
      });
    }, 80);

    return () => window.clearTimeout(timeoutId);
  }, [flowInstance, selectedVideoId, selectedFormatId, savedPlans, plan, canvasGraph.nodes]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[#eef2f7]">
      <section className="relative min-w-0 flex-1 overflow-hidden">
        <div className="absolute inset-0">
          <ReactFlow
            nodes={canvasGraph.nodes}
            edges={canvasGraph.edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{
              padding: 0.25,
              minZoom: 0.35,
              maxZoom: 1.1,
            }}
            minZoom={0.25}
            maxZoom={1.8}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag
            zoomOnScroll
            className="bg-[#eff3f8]"
            onInit={(instance) => setFlowInstance(instance)}
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

        <div className="pointer-events-none absolute left-4 top-4 z-10">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/collections/${collectionId}`)}
            className="pointer-events-auto bg-white"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </Button>
        </div>
      </section>
    </div>
  );
}
