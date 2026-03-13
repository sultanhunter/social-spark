"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Clapperboard,
  ExternalLink,
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
  PanOnScrollMode,
  Position,
  type Edge,
  type NodeChange,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

  return (
    <div className={`w-[230px] rounded-2xl border bg-white p-2.5 shadow-sm ${isSelected ? "border-rose-300 ring-2 ring-rose-100" : "border-slate-200"}`}>
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
        <Badge variant="default" className="max-w-[140px] truncate">{data.formatName}</Badge>
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

      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isSelected ? "mt-2 max-h-72 opacity-100" : "max-h-0 opacity-0"
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
            {data.isGeneratingPlan ? "Generating..." : "Generate Plan"}
          </Button>

          {data.error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">{data.error}</div>
          ) : null}
          {data.success ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700">{data.success}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FormatTypeCanvasNode({ data }: NodeProps<Node<FormatTypeNodeData>>) {
  const isExpanded = data.expandedType === data.formatType;
  const isSelected = data.selectedType === data.formatType;

  return (
    <div className={`nopan min-w-[220px] rounded-2xl border bg-white px-3 py-2 shadow-sm ${isSelected ? "border-rose-300" : "border-slate-200"}`}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-violet-300" />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-violet-300" />
      <button
        type="button"
        onClick={() => data.onToggleType(data.formatType)}
        className="nodrag nopan flex w-full items-center justify-between gap-2 text-left"
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

  const [, setIsLoadingLibrary] = useState(false);
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);

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
        const nextType = nextFormat?.format_type || formats[0]?.format_type || null;

        const nextVideoId =
          (preferred?.videoId && formats.some((item) => item.videos.some((video) => video.id === preferred.videoId))
            ? preferred.videoId
            : null) ||
          (selectedVideoId && formats.some((item) => item.videos.some((video) => video.id === selectedVideoId))
            ? selectedVideoId
            : null);

        setSelectedFormatId(nextFormatId);
        setSelectedVideoId(nextVideoId);
        setExpandedType(nextType);
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
    };

    window.addEventListener("video-agent:source-added", onSourceAdded as EventListener);
    return () => window.removeEventListener("video-agent:source-added", onSourceAdded as EventListener);
  }, [loadLibrary]);

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

      setSuccess("Recreation plan generated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate recreation plan.");
    } finally {
      setIsGeneratingPlan(false);
    }
  }, [collectionId, library, selectedFormat, selectedVideo, selectedUgcCharacter, reasoningModel]);

  const handleNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    setNodePositions((prev) => {
      const next = { ...prev };

      for (const change of changes) {
        if (change.type === "position" && change.position) {
          next[change.id] = change.position;
        }
        if (change.type === "remove") {
          delete next[change.id];
        }
      }

      return next;
    });
  }, []);

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
    router,
    handleSelectVideo,
    handlePlayVideo,
    handleOpenSource,
    handleAspect,
    handleGeneratePlan,
    nodePositions,
  ]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[#eef2f7]">
      <section className="relative min-w-0 flex-1 overflow-hidden">
        <div className="absolute inset-0">
          <ReactFlow
            nodes={canvasGraph.nodes}
            edges={canvasGraph.edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
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
            onNodeDragStop={(_, node) => {
              setNodePositions((prev) => ({
                ...prev,
                [node.id]: node.position,
              }));
            }}
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
