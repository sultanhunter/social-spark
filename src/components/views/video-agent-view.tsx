"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  Copy,
  ExternalLink,
  Link2,
  ListChecks,
  Sparkles,
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
  why_it_works: string[];
  hook_patterns: string[];
  shot_pattern: string[];
  editing_style: string[];
  script_scaffold: string | null;
  higgsfield_prompt_template: string | null;
  recreation_checklist: string[];
  duration_guidance: string | null;
  confidence: number | null;
  source_count: number;
  updated_at: string;
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

function formatTypeVariant(type: string): "default" | "video" | "success" {
  if (type === "ugc") return "video";
  if (type === "ai_video") return "success";
  return "default";
}

function getVideoAnalysisMethod(video: LibraryVideo): string | null {
  const payload = video.analysis_payload;
  if (!payload || typeof payload !== "object") return null;

  const formatAnalysis = (payload as Record<string, unknown>).formatAnalysis;
  if (!formatAnalysis || typeof formatAnalysis !== "object") return null;

  const method = (formatAnalysis as Record<string, unknown>).analysisMethod;
  return typeof method === "string" ? method : null;
}

function getVideoFrameCount(video: LibraryVideo): number | null {
  const payload = video.analysis_payload;
  if (!payload || typeof payload !== "object") return null;

  const formatAnalysis = (payload as Record<string, unknown>).formatAnalysis;
  if (!formatAnalysis || typeof formatAnalysis !== "object") return null;

  const frameCount = (formatAnalysis as Record<string, unknown>).sampledFrameCount;
  return typeof frameCount === "number" && Number.isFinite(frameCount) ? frameCount : null;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [plan, setPlan] = useState<VideoPlan | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadLibrary = useCallback(
    async (preferred?: { formatId?: string | null; videoId?: string | null }) => {
      setIsLoadingLibrary(true);

      try {
        const response = await fetch(`/api/video-agent/formats?collectionId=${encodeURIComponent(collectionId)}`, {
          method: "GET",
          cache: "no-store",
        });

        const data = (await response.json()) as FormatsResponse;

        if (!response.ok) {
          throw new Error(data.error || "Failed to load video format library.");
        }

        const formats = Array.isArray(data.formats) ? data.formats : [];
        setLibrary(formats);

        setSelectedFormatId((current) => {
          const preferredId = preferred?.formatId;
          if (preferredId && formats.some((item) => item.id === preferredId)) {
            return preferredId;
          }
          if (current && formats.some((item) => item.id === current)) {
            return current;
          }
          return formats[0]?.id || null;
        });

        setSelectedVideoId((current) => {
          const preferredVideoId = preferred?.videoId;
          if (preferredVideoId && formats.some((format) => format.videos.some((video) => video.id === preferredVideoId))) {
            return preferredVideoId;
          }
          if (current && formats.some((format) => format.videos.some((video) => video.id === current))) {
            return current;
          }
          return formats[0]?.videos[0]?.id || null;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load video format library.");
      } finally {
        setIsLoadingLibrary(false);
      }
    },
    [collectionId]
  );

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const selectedFormat = useMemo(
    () => library.find((format) => format.id === selectedFormatId) || null,
    [library, selectedFormatId]
  );

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

  const selectedVideo = useMemo(
    () => selectedFormat?.videos.find((video) => video.id === selectedVideoId) || null,
    [selectedFormat, selectedVideoId]
  );

  const loadSavedPlans = useCallback(
    async (options?: {
      formatId?: string | null;
      videoId?: string | null;
      preferredPlanId?: string | null;
    }) => {
      const effectiveFormatId = options?.formatId ?? selectedFormatId;
      const effectiveVideoId = options?.videoId ?? selectedVideoId;

      if (!effectiveFormatId || !effectiveVideoId) {
        setSavedPlans([]);
        setPlan(null);
        setPlanId(null);
        return;
      }

      setIsLoadingPlans(true);

      try {
        const url = `/api/video-agent/plans?collectionId=${encodeURIComponent(collectionId)}&formatId=${encodeURIComponent(effectiveFormatId)}&videoId=${encodeURIComponent(effectiveVideoId)}&limit=20`;

        const response = await fetch(url, {
          method: "GET",
          cache: "no-store",
        });

        const data = (await response.json()) as PlansResponse;

        if (!response.ok) {
          throw new Error(data.error || "Failed to load saved recreation plans.");
        }

        const plans = Array.isArray(data.plans) ? data.plans : [];
        setSavedPlans(plans);

        const preferredPlan =
          (options?.preferredPlanId
            ? plans.find((item) => item.id === options.preferredPlanId)
            : null) || plans[0] || null;

        if (!preferredPlan) {
          setPlan(null);
          setPlanId(null);
          return;
        }

        setPlan(preferredPlan.plan);
        setPlanId(preferredPlan.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load saved recreation plans.");
      } finally {
        setIsLoadingPlans(false);
      }
    },
    [collectionId, selectedFormatId, selectedVideoId]
  );

  useEffect(() => {
    void loadSavedPlans();
  }, [loadSavedPlans]);

  const scriptClipboardText = useMemo(() => {
    if (!plan) return "";

    const beatLines = plan.script.beats
      .map((beat, index) => {
        return [
          `Beat ${index + 1} (${beat.timecode})`,
          `Visual: ${beat.visual}`,
          `Narration: ${beat.narration}`,
          `On-screen text: ${beat.onScreenText}`,
          `Edit note: ${beat.editNote}`,
        ].join("\n");
      })
      .join("\n\n");

    return [`Hook: ${plan.script.hook}`, "", beatLines, "", `CTA: ${plan.script.cta}`].join("\n");
  }, [plan]);

  const higgsfieldClipboardText = useMemo(() => {
    if (!plan) return "";
    return plan.higgsfieldPrompts
      .map(
        (item, index) =>
          `Scene ${index + 1} - ${item.scene}\nDuration: ${getPromptDuration(item)}\nModel: ${getPromptModel(item)}\nWhy: ${getPromptReason(item)}\nPrompt: ${item.prompt}`
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
    setPlan(null);
    setPlanId(null);

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
        throw new Error(data.error || "Failed to analyze video format.");
      }

      const selectedCountText =
        typeof data.groupedVideoCount === "number"
          ? ` (${data.groupedVideoCount} videos now in this format)`
          : "";

      setSuccess(
        data.createdNewFormat
          ? `Created a new format group${selectedCountText}.`
          : `Matched an existing format group${selectedCountText}.`
      );

      setSourceUrl("");

      await loadLibrary({
        formatId: data.format?.id || null,
        videoId: data.video?.id || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze video format.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGeneratePlan = async () => {
    if (!selectedFormat || !selectedVideo) {
      setError("Select a format and a source video before generating a recreation plan.");
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
          reasoningModel,
        }),
      });

      const data = (await response.json()) as RecreateResponse;

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate recreation plan.");
      }

      if (!data.plan) {
        throw new Error("No plan was returned.");
      }

      setPlan(data.plan);
      setPlanId(data.planId || null);
      setSuccess("Generated your recreation plan and script.");

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

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4 lg:sticky lg:top-22 lg:h-fit">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/collections/${collectionId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to collection
          </Button>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Video Pipeline</CardTitle>
              <CardDescription>
                Upload links, classify reusable video formats, then generate execution-ready plans for your app.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <StatusRow label="1. Analyze link" done={library.length > 0} />
              <StatusRow label="2. Select format + source" done={Boolean(selectedFormat && selectedVideo)} />
              <StatusRow label="3. Generate recreation plan" done={Boolean(plan)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">App Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>
                <span className="font-medium text-slate-800">Target app:</span>{" "}
                {activeCollection?.app_name || "Muslimah Pro"}
              </p>
              <p>{activeCollection?.app_description || "Add collection app description for better adaptation quality."}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saved Formats</CardTitle>
              <CardDescription>{isLoadingLibrary ? "Refreshing..." : `${library.length} grouped formats`}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {library.length === 0 ? (
                <p className="text-sm text-slate-500">No format groups yet. Analyze your first video link.</p>
              ) : (
                library.map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    onClick={() => {
                      setSelectedFormatId(format.id);
                      setPlan(null);
                      setPlanId(null);
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                      selectedFormatId === format.id
                        ? "border-rose-300 bg-rose-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <p className={`truncate text-sm font-semibold ${selectedFormatId === format.id ? "text-rose-800" : "text-slate-800"}`}>
                      {format.format_name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant={formatTypeVariant(format.format_type)}>{format.format_type}</Badge>
                      <Badge variant="default">{format.source_count} videos</Badge>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Analyze New Video Link</CardTitle>
              <CardDescription>
                Paste a source link. The agent classifies its format and groups it into your reusable format library.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-800">Video URL</label>
                <Input
                  icon={<Link2 className="h-4 w-4" />}
                  placeholder="https://www.instagram.com/reel/..."
                  value={sourceUrl}
                  onChange={(event) => {
                    setSourceUrl(event.target.value);
                    setError("");
                  }}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-800">Notes (optional)</label>
                <textarea
                  value={userNotes}
                  onChange={(event) => setUserNotes(event.target.value)}
                  rows={3}
                  placeholder="Add why this video stood out (hook, pacing, visuals, offer style)..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-800">Analysis Model</label>
                <select
                  value={reasoningModel}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (isReasoningModel(value)) {
                      setReasoningModel(value);
                    }
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                >
                  {REASONING_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>

              <Button variant="primary" onClick={handleAnalyze} isLoading={isAnalyzing}>
                <Clapperboard className="mr-2 h-4 w-4" />
                {isAnalyzing ? "Analyzing format..." : "Analyze & Group Video"}
              </Button>

              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              {success ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {success}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {selectedFormat ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Selected Format: {selectedFormat.format_name}</CardTitle>
                <CardDescription>
                  Signature: <span className="font-mono text-xs">{selectedFormat.format_signature}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={formatTypeVariant(selectedFormat.format_type)}>{selectedFormat.format_type}</Badge>
                  <Badge variant="default">{selectedFormat.source_count} videos grouped</Badge>
                  {typeof selectedFormat.confidence === "number" ? (
                    <Badge variant="default">confidence {Math.round(selectedFormat.confidence * 100)}%</Badge>
                  ) : null}
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  {selectedFormat.summary}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <SimpleList title="Hook Patterns" items={selectedFormat.hook_patterns} />
                  <SimpleList title="Editing Style" items={selectedFormat.editing_style} />
                </div>

                <SimpleList title="Shot Pattern" items={selectedFormat.shot_pattern} />

                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-800">Videos in this format</p>
                  {selectedFormat.videos.length === 0 ? (
                    <p className="text-sm text-slate-500">No videos saved in this group yet.</p>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                      {selectedFormat.videos.map((video) => {
                        const isActive = selectedVideoId === video.id;
                        const analysisMethod = getVideoAnalysisMethod(video);
                        const frameCount = getVideoFrameCount(video);

                        return (
                          <button
                            key={video.id}
                            type="button"
                            onClick={() => {
                              setSelectedVideoId(video.id);
                              setPlan(null);
                              setPlanId(null);
                            }}
                            className={`rounded-lg border p-3 text-left transition ${
                              isActive
                                ? "border-rose-300 bg-rose-50"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <p className={`truncate text-sm font-semibold ${isActive ? "text-rose-800" : "text-slate-800"}`}>
                              {video.title || "Untitled source video"}
                            </p>
                            <p className={`mt-1 line-clamp-2 text-xs ${isActive ? "text-rose-600" : "text-slate-500"}`}>
                              {video.description || video.source_url}
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              <Badge variant="default">{video.platform}</Badge>
                              {analysisMethod ? (
                                <Badge variant="default">
                                  {analysisMethod.replace(/_/g, " ")}
                                  {typeof frameCount === "number" ? ` (${frameCount} frames)` : ""}
                                </Badge>
                              ) : null}
                              <a
                                href={video.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                className="inline-flex items-center gap-1 text-xs text-rose-700 hover:text-rose-600"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Open
                              </a>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button variant="primary" onClick={handleGeneratePlan} isLoading={isGeneratingPlan}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    {isGeneratingPlan ? "Generating plan..." : "Generate Recreation Plan"}
                  </Button>
                  {scriptClipboardText ? (
                    <Button variant="outline" onClick={() => navigator.clipboard.writeText(scriptClipboardText)}>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy Script
                    </Button>
                  ) : null}
                  {higgsfieldClipboardText ? (
                    <Button variant="outline" onClick={() => navigator.clipboard.writeText(higgsfieldClipboardText)}>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy Higgsfield Prompts
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved Recreation Plans</p>
                    <span className="text-xs text-slate-500">
                      {isLoadingPlans ? "Loading..." : `${savedPlans.length} saved`}
                    </span>
                  </div>

                  {savedPlans.length === 0 ? (
                    <p className="text-xs text-slate-500">No saved plans for this source yet. Generate one to persist it.</p>
                  ) : (
                    <div className="space-y-2">
                      {savedPlans.map((savedPlan) => {
                        const isActivePlan = planId === savedPlan.id;

                        return (
                          <button
                            key={savedPlan.id}
                            type="button"
                            onClick={() => {
                              setPlan(savedPlan.plan);
                              setPlanId(savedPlan.id);
                              setSuccess("Loaded saved recreation plan.");
                            }}
                            className={`w-full rounded-md border px-3 py-2 text-left transition ${
                              isActivePlan
                                ? "border-rose-300 bg-rose-50"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <p className={`text-xs font-semibold ${isActivePlan ? "text-rose-700" : "text-slate-700"}`}>
                              {savedPlan.plan.title || "Saved plan"}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {formatDateTime(savedPlan.generatedAt || savedPlan.created_at)}
                              {savedPlan.reasoningModel ? ` · ${savedPlan.reasoningModel}` : ""}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {plan ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recreation Plan</CardTitle>
                <CardDescription>
                  {plan.title}
                  {planId ? ` · Plan ID ${planId.slice(0, 8)}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-slate-700">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Strategy</p>
                  <p className="mt-1">{plan.strategy}</p>
                  <p className="mt-2 text-xs text-slate-500">Objective: {plan.objective}</p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <SimpleList
                    title="Deliverable Spec"
                    items={[
                      `Duration: ${plan.deliverableSpec.duration}`,
                      `Aspect ratio: ${plan.deliverableSpec.aspectRatio}`,
                      `Platforms: ${plan.deliverableSpec.platforms.join(", ") || "N/A"}`,
                      `Voice style: ${plan.deliverableSpec.voiceStyle}`,
                    ]}
                  />
                  <SimpleList title="Production Steps" items={plan.productionSteps} />
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Script Hook</p>
                  <p className="mt-1 font-medium text-slate-800">{plan.script.hook}</p>
                  <div className="mt-3 space-y-2">
                    {plan.script.beats.map((beat, index) => (
                      <div key={`${beat.timecode}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <p className="text-xs font-semibold text-slate-600">{beat.timecode}</p>
                        <p className="mt-1 text-sm text-slate-700"><span className="font-semibold">Visual:</span> {beat.visual}</p>
                        <p className="mt-1 text-sm text-slate-700"><span className="font-semibold">Narration:</span> {beat.narration}</p>
                        <p className="mt-1 text-sm text-slate-700"><span className="font-semibold">On-screen:</span> {beat.onScreenText}</p>
                        <p className="mt-1 text-xs text-slate-500"><span className="font-semibold">Edit note:</span> {beat.editNote}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-sm text-emerald-800">
                    CTA: {plan.script.cta}
                  </p>
                </div>

                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Higgsfield Prompts</p>
                  <div className="space-y-2">
                    {plan.higgsfieldPrompts.map((item, index) => (
                      <div key={`${item.scene}-${index}`} className="rounded-md border border-slate-200 bg-white p-2.5">
                        <p className="text-sm font-semibold text-slate-800">{index + 1}. {item.scene}</p>
                        <p className="mt-1 text-xs text-slate-600">
                          <span className="font-semibold">Duration:</span> {getPromptDuration(item)}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          <span className="font-semibold">Model:</span> {getPromptModel(item)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          <span className="font-semibold">Why:</span> {getPromptReason(item)}
                        </p>
                        <p className="mt-1.5 text-sm text-slate-700">{item.prompt}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <SimpleList title="Editing Timeline" items={plan.editingTimeline} />
                  <SimpleList title="Assets Checklist" items={plan.assetsChecklist} />
                  <SimpleList title="QA Checklist" items={plan.qaChecklist} />
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <ListChecks className="h-4 w-4 text-slate-400" />}
      <span className={done ? "text-slate-700" : "text-slate-500"}>{label}</span>
    </div>
  );
}

function SimpleList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">No items yet.</p>
      ) : (
        <ul className="space-y-1 text-sm text-slate-700">
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>• {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
