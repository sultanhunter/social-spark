"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  Clapperboard,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
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

type HiggsfieldPrompt = {
  generationType?: string;
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
  isLoadingCharacters: boolean;
  ugcCharacters: UgcCharacter[];
  selectedUgcCharacterId: string | null;
  onCharacterChange: (characterId: string | null) => void;
  onOpenCharacterStudio: () => void;
  onGeneratePlan: (formatId: string, videoId: string) => void;
  isGeneratingPlan: boolean;
  plan: VideoPlan | null;
  hasR2Url: boolean;
  isRefreshingR2: boolean;
  onRefreshR2: (videoId: string) => void;
  error: string;
  success: string;
  onSelect: (formatId: string, videoId: string) => void;
  onPlay: (formatId: string, videoId: string) => void;
  onOpen: (url: string) => void;
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
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);

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
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="truncate text-[11px] text-slate-500">{data.video.platform}</p>
        {plan ? <Badge variant="success">Plan Ready</Badge> : null}
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
        className={`nodrag overflow-hidden transition-all duration-300 ease-out ${
          isSelected ? "mt-2 max-h-[800px] opacity-100" : "max-h-0 opacity-0"
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

          {data.formatType === "ugc" ? (
            <>
              <select
                value={data.selectedUgcCharacterId || ""}
                onChange={(event) => data.onCharacterChange(event.target.value || null)}
                disabled={data.isLoadingCharacters}
                className="nodrag w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
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
                <Users className="mr-1 h-3.5 w-3.5" />
                Character Studio
              </Button>
            </>
          ) : null}

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
                  </div>

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

                  {plan.script ? (
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

                  {plan.higgsfieldPrompts?.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">AI Video Prompts</p>
                      <div className="mt-1.5 space-y-1.5">
                        {plan.higgsfieldPrompts.map((hp, i) => (
                          <div key={`hf-${i}`} className="rounded border border-blue-200 bg-blue-50 px-2.5 py-2">
                            {hp.generationType ? (
                              <Badge variant="default" className="mb-1">{hp.generationType.replace(/_/g, " ")}</Badge>
                            ) : null}
                            <p className="text-[10px] font-semibold text-blue-700">{hp.scene}{hp.shotDuration ? ` (${hp.shotDuration})` : ""}</p>
                            <p className="text-xs leading-relaxed text-slate-700">{hp.prompt}</p>
                            {hp.recommendedModel ? <p className="mt-0.5 text-[10px] text-blue-500">Model: {hp.recommendedModel}</p> : null}
                          </div>
                        ))}
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
  const [refreshingR2VideoId, setRefreshingR2VideoId] = useState<string | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
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

  useEffect(() => {
    void loadLibrary();
    void loadCharacters();
    void loadPlans();
  }, [loadLibrary, loadCharacters, loadPlans]);

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
  }, [collectionId, library, selectedFormat, selectedVideo, selectedUgcCharacter, reasoningModel, loadPlans]);

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
              isLoadingCharacters,
              ugcCharacters,
              selectedUgcCharacterId,
              onCharacterChange: (characterId: string | null) => setSelectedUgcCharacterId(characterId),
              onOpenCharacterStudio: () => router.push(`/collections/${collectionId}/characters`),
              onGeneratePlan: (formatId: string, videoId: string) => {
                void handleGeneratePlan(formatId, videoId);
              },
              isGeneratingPlan: isGeneratingPlan && selectedVideoId === video.id,
              plan: videoPlans[video.id] || null,
              hasR2Url: Boolean(getVideoR2Url(video)),
              isRefreshingR2: refreshingR2VideoId === video.id,
              onRefreshR2: (videoId: string) => { void handleRefreshR2(videoId); },
              error,
              success,
              onSelect: handleSelectVideo,
              onPlay: handlePlayVideo,
              onOpen: handleOpenSource,
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
    isLoadingCharacters,
    ugcCharacters,
    selectedUgcCharacterId,
    isGeneratingPlan,
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
    handleAspect,
    handleGeneratePlan,
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
