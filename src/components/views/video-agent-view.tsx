"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Copy,
  ExternalLink,
  Link2,
  Play,
  Sparkles,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  integrationMode?: "standard_adaptation" | "public_figure_overlay_only";
  publicFigureNotes?: string;
  overlayOpportunities?: string[];
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

type CharacterAngle = {
  id: string;
  angleKey: string;
  angleLabel: string;
  imageUrl: string;
};

type UgcCharacter = {
  id: string;
  characterName: string;
  personaSummary: string;
  imageModel: string | null;
  isDefault?: boolean;
  referenceImageUrl: string | null;
  angles?: CharacterAngle[];
};

type CharacterResponse = {
  characters?: UgcCharacter[];
  character?: UgcCharacter | null;
  error?: string;
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
  const formatAnalysis = getVideoFormatAnalysis(video);
  const method = formatAnalysis?.analysisMethod;
  return typeof method === "string" ? method : null;
}

function getVideoFrameCount(video: LibraryVideo): number | null {
  const formatAnalysis = getVideoFormatAnalysis(video);
  const count = formatAnalysis?.sampledFrameCount;
  return typeof count === "number" && Number.isFinite(count) ? count : null;
}

function getVideoDirectMediaUrl(video: LibraryVideo): string | null {
  const formatAnalysis = getVideoFormatAnalysis(video);
  const url = formatAnalysis?.directMediaUrl;
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
  const [playingCardVideoId, setPlayingCardVideoId] = useState<string | null>(null);
  const [videoAspectRatios, setVideoAspectRatios] = useState<Record<string, number>>({});

  const [ugcCharacters, setUgcCharacters] = useState<UgcCharacter[]>([]);
  const [selectedUgcCharacterId, setSelectedUgcCharacterId] = useState<string | null>(null);

  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [plan, setPlan] = useState<VideoPlan | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

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
    () => ugcCharacters.find((item) => item.id === selectedUgcCharacterId) || null,
    [ugcCharacters, selectedUgcCharacterId]
  );

  const selectedVideoDirectUrl = selectedVideo ? getVideoDirectMediaUrl(selectedVideo) : null;

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
          if (nextFormatId) {
            next[nextFormatId] = true;
          }
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

      const list = Array.isArray(data.characters)
        ? data.characters
        : data.character
          ? [data.character]
          : [];
      setUgcCharacters(list);

      setSelectedUgcCharacterId((current) => {
        if (current && list.some((item) => item.id === current)) return current;
        const defaultCharacter = list.find((item) => item.isDefault) || null;
        return defaultCharacter?.id || list[0]?.id || null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load UGC characters.");
    } finally {
      setIsLoadingCharacters(false);
    }
  }, [collectionId]);

  const loadSavedPlans = useCallback(
    async (options?: { formatId?: string | null; videoId?: string | null; preferredPlanId?: string | null }) => {
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

  const scriptClipboardText = useMemo(() => {
    if (!plan) return "";
    const beats = plan.script.beats
      .map(
        (beat, index) =>
          `Beat ${index + 1} (${beat.timecode})\nVisual: ${beat.visual}\nNarration: ${beat.narration}\nOn-screen text: ${beat.onScreenText}\nEdit note: ${beat.editNote}`
      )
      .join("\n\n");

    return [`Hook: ${plan.script.hook}`, "", beats, "", `CTA: ${plan.script.cta}`].join("\n");
  }, [plan]);

  const higgsfieldClipboardText = useMemo(() => {
    if (!plan) return "";
    return plan.higgsfieldPrompts
      .map(
        (item, index) =>
          `Scene ${index + 1} - ${item.scene}\nDuration: ${getPromptDuration(item)}\nModel: ${getPromptModel(
            item
          )}\nWhy: ${getPromptReason(item)}\nPrompt: ${item.prompt}`
      )
      .join("\n\n");
  }, [plan]);

  const handleAnalyze = async () => {
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
  };

  const handleGeneratePlan = async () => {
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
  };

  const selectedVideoAspectRatio = selectedVideo
    ? clampAspectRatio(videoAspectRatios[selectedVideo.id] || 9 / 16)
    : 9 / 16;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[#e9edf3]">
      <aside
        className={`border-r border-slate-200 bg-white transition-all duration-200 ${
          leftCollapsed ? "w-14" : "w-[320px]"
        }`}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-2.5 py-2">
            {!leftCollapsed ? (
              <Button variant="ghost" size="sm" onClick={() => router.push(`/collections/${collectionId}`)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            ) : (
              <Button variant="ghost" size="icon" onClick={() => router.push(`/collections/${collectionId}`)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setLeftCollapsed((prev) => !prev)}>
              {leftCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>

          {leftCollapsed ? (
            <div className="flex flex-1 flex-col items-center gap-2 py-3">
              <Button variant="ghost" size="icon" onClick={() => setLeftCollapsed(false)}>
                <Clapperboard className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Canvas Controls</CardTitle>
                  <CardDescription>Analyze links and set generation options.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    icon={<Link2 className="h-4 w-4" />}
                    placeholder="https://..."
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                  />
                  <textarea
                    value={userNotes}
                    onChange={(event) => setUserNotes(event.target.value)}
                    rows={2}
                    placeholder="Optional notes..."
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                  />
                  <select
                    value={reasoningModel}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (isReasoningModel(value)) setReasoningModel(value);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                  >
                    {REASONING_MODELS.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  {selectedFormat?.format_type === "ugc" ? (
                    <>
                      <select
                        value={selectedUgcCharacterId || ""}
                        onChange={(event) => setSelectedUgcCharacterId(event.target.value || null)}
                        disabled={isLoadingCharacters}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                      >
                        <option value="">{isLoadingCharacters ? "Loading characters..." : "Select UGC character"}</option>
                        {ugcCharacters.map((character) => (
                          <option key={character.id} value={character.id}>
                            {character.characterName}
                            {character.isDefault ? " (Default)" : ""}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/collections/${collectionId}/characters`)}
                      >
                        <Users className="mr-1.5 h-3.5 w-3.5" />
                        Open Character Studio
                      </Button>
                    </>
                  ) : null}

                  <Button variant="primary" onClick={handleAnalyze} isLoading={isAnalyzing}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    {isAnalyzing ? "Analyzing..." : "Analyze & Group"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Selection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-slate-600">
                  <p>
                    <span className="font-semibold text-slate-700">Format:</span> {selectedFormat?.format_name || "None"}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700">Video:</span> {selectedVideo?.title || "None"}
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleGeneratePlan}
                    isLoading={isGeneratingPlan}
                    disabled={!selectedVideo}
                    className="w-full"
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    {isGeneratingPlan ? "Generating..." : "Generate Plan"}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </aside>

      <section className="relative min-w-0 flex-1 overflow-auto">
        <div
          className="min-h-full px-6 py-6"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(148,163,184,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.15) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          <div className="mx-auto w-full max-w-[1700px] rounded-[28px] border border-slate-300 bg-white/95 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.14)]">
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-sm font-semibold text-slate-800">Video Canvas</p>
              <Badge variant="default">{activeCollection?.app_name || "Muslimah Pro"}</Badge>
              {selectedFormat ? (
                <>
                  <Badge variant={formatTypeVariant(selectedFormat.format_type)}>{selectedFormat.format_type}</Badge>
                  <Badge variant="default">{selectedFormat.videos.length} videos</Badge>
                </>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                {selectedVideo ? (
                  <p className="max-w-[420px] truncate text-xs text-slate-500">Selected: {selectedVideo.title || "Untitled source"}</p>
                ) : (
                  <p className="text-xs text-slate-500">Select any video card from the canvas</p>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleGeneratePlan}
                  isLoading={isGeneratingPlan}
                  disabled={!selectedVideo}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {isGeneratingPlan ? "Generating..." : "Generate Plan"}
                </Button>
              </div>
            </div>

            {error ? (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            {success ? (
              <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {success}
              </div>
            ) : null}

            {selectedVideo ? (
              <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,340px)_1fr]">
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100" style={{ aspectRatio: selectedVideoAspectRatio }}>
                    {selectedVideoDirectUrl ? (
                      <video
                        key={selectedVideoDirectUrl}
                        src={selectedVideoDirectUrl}
                        controls
                        playsInline
                        preload="metadata"
                        poster={selectedVideo.thumbnail_url || undefined}
                        className="h-full w-full object-cover"
                      />
                    ) : selectedVideo.thumbnail_url ? (
                      <img
                        src={selectedVideo.thumbnail_url}
                        alt={selectedVideo.title || "Selected source thumbnail"}
                        className="h-full w-full object-cover"
                        onLoad={(event) => {
                          const { naturalWidth, naturalHeight } = event.currentTarget;
                          if (naturalWidth > 0 && naturalHeight > 0) {
                            setVideoAspectRatios((prev) => ({
                              ...prev,
                              [selectedVideo.id]: naturalWidth / naturalHeight,
                            }));
                          }
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-500">
                        <Clapperboard className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 text-sm text-slate-700">
                    <p className="font-semibold text-slate-800">{selectedVideo.title || "Untitled source"}</p>
                    <p className="line-clamp-2 text-xs text-slate-600">{selectedVideo.description || selectedVideo.source_url}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="default">{selectedVideo.platform}</Badge>
                      {(() => {
                        const method = getVideoAnalysisMethod(selectedVideo);
                        const frameCount = getVideoFrameCount(selectedVideo);
                        if (!method) return null;
                        return (
                          <Badge variant="default">
                            {method.replace(/_/g, " ")}
                            {typeof frameCount === "number" ? ` (${frameCount} frames)` : ""}
                          </Badge>
                        );
                      })()}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(selectedVideo.source_url, "_blank", "noopener,noreferrer")}
                      >
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        Open source
                      </Button>
                    </div>
                    {selectedFormat ? <p className="text-xs text-slate-600">{selectedFormat.summary}</p> : null}
                  </div>
                </div>
              </div>
            ) : null}

            {isLoadingLibrary ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                Loading formats...
              </div>
            ) : library.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                No format groups yet. Analyze your first video link.
              </div>
            ) : (
              <div className="space-y-4">
                {library.map((format) => {
                  const expanded = Boolean(expandedFormats[format.id]);
                  return (
                    <div key={format.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedFormats((prev) => ({
                            ...prev,
                            [format.id]: !expanded,
                          }));
                          setSelectedFormatId(format.id);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-left"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">{format.format_name}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <Badge variant={formatTypeVariant(format.format_type)}>{format.format_type}</Badge>
                            <Badge variant="default">{format.videos.length} videos</Badge>
                          </div>
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`}
                        />
                      </button>

                      {expanded ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {format.videos.map((video) => {
                            const ratio = clampAspectRatio(videoAspectRatios[video.id] || 9 / 16);
                            const isSelected = selectedVideoId === video.id;
                            const directMediaUrl = getVideoDirectMediaUrl(video);

                            return (
                              <div
                                key={video.id}
                                className={`rounded-xl border bg-white p-2.5 shadow-sm transition ${
                                  isSelected ? "border-rose-300 ring-2 ring-rose-100" : "border-slate-200"
                                }`}
                              >
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => {
                                    setSelectedFormatId(format.id);
                                    setSelectedVideoId(video.id);
                                    if (directMediaUrl) setPlayingCardVideoId(video.id);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      setSelectedFormatId(format.id);
                                      setSelectedVideoId(video.id);
                                      if (directMediaUrl) setPlayingCardVideoId(video.id);
                                    }
                                  }}
                                  className="cursor-pointer"
                                >
                                  <div className="relative overflow-hidden rounded-lg border border-slate-200" style={{ aspectRatio: ratio }}>
                                    {directMediaUrl && playingCardVideoId === video.id ? (
                                      <video
                                        key={`${video.id}-canvas`}
                                        src={directMediaUrl}
                                        controls
                                        autoPlay
                                        muted
                                        playsInline
                                        preload="metadata"
                                        poster={video.thumbnail_url || undefined}
                                        className="h-full w-full object-cover"
                                      />
                                    ) : video.thumbnail_url ? (
                                      <img
                                        src={video.thumbnail_url}
                                        alt={video.title || "Video thumbnail"}
                                        className="h-full w-full object-cover"
                                        onLoad={(event) => {
                                          const { naturalWidth, naturalHeight } = event.currentTarget;
                                          if (naturalWidth > 0 && naturalHeight > 0) {
                                            setVideoAspectRatios((prev) => ({
                                              ...prev,
                                              [video.id]: naturalWidth / naturalHeight,
                                            }));
                                          }
                                        }}
                                      />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-500">
                                        <Clapperboard className="h-6 w-6" />
                                      </div>
                                    )}
                                    {directMediaUrl && playingCardVideoId !== video.id ? (
                                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                                        <div className="rounded-full bg-black/55 p-2 text-white">
                                          <Play className="h-4 w-4" />
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>

                                <p className="mt-1.5 truncate text-xs font-semibold text-slate-800">
                                  {video.title || "Untitled source"}
                                </p>

                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <Badge variant="default">{video.platform}</Badge>
                                  {(() => {
                                    const method = getVideoAnalysisMethod(video);
                                    if (!method) return null;
                                    return <Badge variant="default">{method.replace(/_/g, " ")}</Badge>;
                                  })()}
                                </div>

                                <div className="mt-2 flex items-center justify-between">
                                  {directMediaUrl ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        setSelectedFormatId(format.id);
                                        setSelectedVideoId(video.id);
                                        setPlayingCardVideoId(video.id);
                                      }}
                                    >
                                      <Play className="mr-1 h-3.5 w-3.5" />
                                      Play
                                    </Button>
                                  ) : (
                                    <span />
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => window.open(video.source_url, "_blank", "noopener,noreferrer")}
                                  >
                                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                                    Open
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <aside
        className={`border-l border-slate-200 bg-white transition-all duration-200 ${
          rightCollapsed ? "w-14" : "w-[430px]"
        }`}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            {rightCollapsed ? null : <p className="text-sm font-semibold text-slate-700">Recreation Plan</p>}
            <Button variant="ghost" size="icon" onClick={() => setRightCollapsed((prev) => !prev)}>
              {rightCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>

          {rightCollapsed ? (
            <div className="flex flex-1 flex-col items-center gap-2 py-3">
              <Button variant="ghost" size="icon" onClick={() => setRightCollapsed(false)}>
                <Sparkles className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Saved Plans</CardTitle>
                  <CardDescription>
                    {isLoadingPlans ? "Loading..." : `${savedPlans.length} saved for selected video`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {savedPlans.length === 0 ? (
                    <p className="text-xs text-slate-500">No saved plans yet.</p>
                  ) : (
                    savedPlans.map((saved) => (
                      <button
                        key={saved.id}
                        type="button"
                        onClick={() => {
                          setPlan(saved.plan);
                          setPlanId(saved.id);
                          setSuccess("Loaded saved plan.");
                        }}
                        className={`w-full rounded-md border px-2.5 py-2 text-left ${
                          saved.id === planId
                            ? "border-rose-300 bg-rose-50"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <p className="truncate text-xs font-semibold text-slate-700">{saved.plan.title || "Saved plan"}</p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {formatDateTime(saved.generatedAt || saved.created_at)}
                          {saved.reasoningModel ? ` · ${saved.reasoningModel}` : ""}
                        </p>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>

              {plan ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{plan.title}</CardTitle>
                    <CardDescription>{plan.deliverableSpec.duration}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-slate-700">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Strategy</p>
                      <p className="mt-1 text-sm">{plan.strategy}</p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Script Hook</p>
                      <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-2">{plan.script.hook}</p>
                    </div>

                    <div className="space-y-2">
                      {plan.script.beats.map((beat, index) => (
                        <div key={`${beat.timecode}-${index}`} className="rounded-md border border-slate-200 bg-white p-2">
                          <p className="text-[11px] font-semibold text-slate-500">{beat.timecode}</p>
                          <p className="text-xs"><span className="font-semibold">Visual:</span> {beat.visual}</p>
                          <p className="mt-1 text-xs"><span className="font-semibold">Narration:</span> {beat.narration}</p>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Higgsfield Shots</p>
                      {plan.higgsfieldPrompts.map((item, index) => (
                        <div key={`${item.scene}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                          <p className="text-xs font-semibold text-slate-700">{index + 1}. {item.scene}</p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <Badge variant="default">Duration: {getPromptDuration(item)}</Badge>
                            <Badge variant="video">Model: {getPromptModel(item)}</Badge>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">Why: {getPromptReason(item)}</p>
                          <p className="mt-1 text-xs text-slate-700">{item.prompt}</p>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(scriptClipboardText)}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                        Copy Script
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(higgsfieldClipboardText)}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                        Copy Higgsfield
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-slate-500">
                    Generate or select a plan to view it here.
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
