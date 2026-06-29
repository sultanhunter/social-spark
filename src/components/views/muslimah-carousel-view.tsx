"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MessageCircleHeart,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/app-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type MuslimahSpeaker = "older_sister" | "user";
type MuslimahSlideType = "hook" | "chat" | "app_reveal" | "cta";
type MuslimahJobStatus = "draft" | "generating" | "completed" | "failed";

type MuslimahProgressEvent = {
  id: string;
  at: string;
  stage: string;
  message: string;
  level: "info" | "warning" | "error";
  slideNumber?: number | null;
  progress?: number | null;
  elapsedMs?: number | null;
  details?: unknown;
};

type MuslimahChatMessage = {
  speaker: MuslimahSpeaker;
  text: string;
  timestamp: string;
};

type MuslimahCarouselSlide = {
  slideNumber: number;
  slideType: MuslimahSlideType;
  visualNotes: string;
  messages: MuslimahChatMessage[];
  hookText?: string;
  subtitle?: string;
  appScreenState?: string;
};

type MuslimahCarouselScript = {
  brand: "muslimah.health";
  hook: string;
  subtitle: string;
  hookBackground: string;
  freshTalkingPoints: string[];
  selectedFeatures: string[];
  slideOrder: number[];
  caption: string;
  slides: MuslimahCarouselSlide[];
};

type MuslimahGeneratedImage = {
  slideNumber: number;
  slideType: MuslimahSlideType;
  imageUrl: string;
  prompt: string;
  uploadedAt?: string;
};

type MuslimahGenerationResult = {
  scriptModel: string;
  imageModel: string;
  imageQuality: "medium";
  imageSize: "1024x1536";
  script: MuslimahCarouselScript;
  images: MuslimahGeneratedImage[];
  generatedImages?: boolean;
  published?: boolean;
  publishResult?: unknown;
};

type GenerateResponse = {
  jobId?: string;
  status?: MuslimahJobStatus;
  message?: string;
  script?: MuslimahCarouselScript | null;
  result?: MuslimahGenerationResult | null;
  error?: string;
};

type JobStatusResponse = {
  jobId: string;
  collectionId: string;
  status: MuslimahJobStatus;
  createdAt?: string;
  updatedAt?: string;
  error?: string | null;
  events?: MuslimahProgressEvent[];
  lastEvent?: MuslimahProgressEvent | null;
  progress?: number | null;
  partialImages?: MuslimahGeneratedImage[];
  script?: MuslimahCarouselScript | null;
  result?: MuslimahGenerationResult | null;
};

type R2GallerySlide = {
  key: string;
  publicUrl: string;
  size: number;
  lastModified: string | null;
  slideNumber: number | null;
  filename: string;
  downloadUrl: string;
};

type R2GalleryPost = {
  id: string;
  collectionId: string;
  postSlug: string;
  inferredBatch: number;
  slideCount: number;
  totalBytes: number;
  firstUploadedAt: string | null;
  lastUploadedAt: string | null;
  slides: R2GallerySlide[];
};

type R2GalleryResponse = {
  collectionId: string;
  prefix: string;
  totalObjects: number;
  posts: R2GalleryPost[];
  error?: string;
};

const statusCopy: Record<MuslimahJobStatus, string> = {
  draft: "Waiting",
  generating: "Generating",
  completed: "Completed",
  failed: "Failed",
};

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSlideLabel(slideType: MuslimahSlideType): string {
  if (slideType === "app_reveal") return "App reveal";
  return slideType.charAt(0).toUpperCase() + slideType.slice(1);
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatElapsed(value?: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${Math.round(value / 1000)}s`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPostSlug(slug: string): string {
  return slug
    .split("/")
    .pop()!
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function MuslimahCarouselView({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const { activeCollection } = useAppStore();

  const [focus, setFocus] = useState("fresh worship + wellness angle for today's Flo carousel");
  const [previousHookBackground, setPreviousHookBackground] = useState("");
  const [previousFeaturesText, setPreviousFeaturesText] = useState("");
  const [publish, setPublish] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<MuslimahJobStatus | null>(null);
  const [script, setScript] = useState<MuslimahCarouselScript | null>(null);
  const [result, setResult] = useState<MuslimahGenerationResult | null>(null);
  const [partialImages, setPartialImages] = useState<MuslimahGeneratedImage[]>([]);
  const [progressEvents, setProgressEvents] = useState<MuslimahProgressEvent[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [r2Posts, setR2Posts] = useState<R2GalleryPost[]>([]);
  const [isLoadingR2Posts, setIsLoadingR2Posts] = useState(false);
  const [r2Error, setR2Error] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copied, setCopied] = useState(false);

  const previousFeatures = useMemo(() => splitList(previousFeaturesText), [previousFeaturesText]);
  const slides = useMemo(() => script?.slides ?? result?.script.slides ?? [], [result, script]);
  const generatedImages = useMemo(
    () => [...(result?.images?.length ? result.images : partialImages)].sort((a, b) => a.slideNumber - b.slideNumber),
    [partialImages, result]
  );
  const isShowingPartialImages = !result?.images?.length && partialImages.length > 0;
  const latestEvent = progressEvents.at(-1) || null;

  const loadR2Gallery = useCallback(async () => {
    setIsLoadingR2Posts(true);
    setR2Error("");

    try {
      const response = await fetch(
        `/api/muslimah-carousel/r2-gallery?collectionId=${encodeURIComponent(collectionId)}&max=1000`,
        { method: "GET", cache: "no-store" }
      );
      const data = (await response.json()) as R2GalleryResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to load R2 carousel images.");
      }

      setR2Posts(Array.isArray(data.posts) ? data.posts : []);
    } catch (err) {
      setR2Error(err instanceof Error ? err.message : "Failed to load R2 carousel images.");
    } finally {
      setIsLoadingR2Posts(false);
    }
  }, [collectionId]);

  useEffect(() => {
    void loadR2Gallery();
  }, [loadR2Gallery]);

  const pollJob = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/muslimah-carousel/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      cache: "no-store",
    });
    const data = (await response.json()) as JobStatusResponse & { error?: string };

    if (!response.ok) {
      throw new Error(data.error || "Failed to check muslimah carousel job status.");
    }

    setJobStatus(data.status);
    setProgressEvents(Array.isArray(data.events) ? data.events : []);
    setPartialImages(Array.isArray(data.partialImages) ? data.partialImages : []);
    setProgress(typeof data.progress === "number" ? data.progress : data.lastEvent?.progress ?? null);

    if (data.script) {
      setScript(data.script);
    }

    if (data.status === "completed") {
      if (data.result) {
        setResult(data.result);
        setScript(data.result.script);
      }
      setSuccess("Carousel generation completed.");
      setActiveJobId(null);
      void loadR2Gallery();
      return;
    }

    if (data.status === "failed") {
      setError(data.error || "Muslimah carousel generation failed.");
      setActiveJobId(null);
    }
  }, [loadR2Gallery]);

  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;

    const safePoll = async () => {
      try {
        await pollJob(activeJobId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to poll carousel job.");
        }
      }
    };

    void safePoll();
    const intervalId = setInterval(() => {
      void safePoll();
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [activeJobId, pollJob]);

  const buildPayload = (generateImages: boolean) => ({
    collectionId,
    focus: focus.trim(),
    previousHookBackground: previousHookBackground.trim() || undefined,
    previousFeatures,
    generateImages,
    publish: generateImages ? publish : false,
  });

  const handlePreviewScript = async () => {
    setIsPreviewing(true);
    setError("");
    setSuccess("");
    setResult(null);
    setPartialImages([]);
    setProgressEvents([]);
    setProgress(null);

    try {
      const response = await fetch("/api/muslimah-carousel/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(false)),
      });
      const data = (await response.json()) as GenerateResponse;

      if (!response.ok || !data.script) {
        throw new Error(data.error || "Failed to generate script preview.");
      }

      setScript(data.script);
      setSuccess("Script preview generated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Script preview failed.");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleStartPipeline = async () => {
    setIsStarting(true);
    setError("");
    setSuccess("");
    setResult(null);
    setPartialImages([]);
    setActiveJobId(null);
    setJobStatus(null);
    setProgressEvents([]);
    setProgress(null);

    try {
      const response = await fetch("/api/muslimah-carousel/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(true)),
      });
      const data = (await response.json()) as GenerateResponse;

      if (!response.ok || !data.jobId) {
        throw new Error(data.error || "Failed to start muslimah carousel pipeline.");
      }

      setScript(data.script ?? null);
      setActiveJobId(data.jobId);
      setJobStatus(data.status ?? "generating");
      setProgressEvents([
        {
          id: `${Date.now()}-started`,
          at: new Date().toISOString(),
          stage: "started",
          message: data.message || "Carousel pipeline started on Render.",
          level: "info",
          progress: 2,
        },
      ]);
      setProgress(2);
      setSuccess(data.message || "Carousel pipeline started on Render.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline start failed.");
    } finally {
      setIsStarting(false);
    }
  };

  const copyScript = async () => {
    if (!script) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(script, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[330px_1fr]">
        <div className="space-y-4 lg:sticky lg:top-22 lg:h-fit">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/collections/${collectionId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to collection
          </Button>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Flo Carousel Pipeline</CardTitle>
              <CardDescription>muslimah.health carousel generation through GPT-5.5 and GPT Image 2.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <StatusRow label="Script JSON" done={Boolean(script)} />
              <StatusRow label="Render image job" done={Boolean(activeJobId || result)} />
              <StatusRow label="Image output" done={generatedImages.length > 0} />
              <StatusRow label="Publish" done={Boolean(result?.published)} />
              {latestEvent ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">{latestEvent.stage.replace(/_/g, " ")}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{latestEvent.message}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Collection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>
                <span className="font-medium text-slate-800">Name:</span>{" "}
                {activeCollection?.name || "Current collection"}
              </p>
              <p>
                <span className="font-medium text-slate-800">App:</span>{" "}
                {activeCollection?.app_name || "muslimah.health"}
              </p>
              {activeJobId ? (
                <p className="break-all text-xs">
                  <span className="font-medium text-slate-800">Job:</span> {activeJobId}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Start muslimah.health Carousel</CardTitle>
                  <CardDescription>
                    Creates the fixed 10-slide “Why I stopped using Flo as a Muslim woman” carousel.
                  </CardDescription>
                </div>
                {jobStatus ? (
                  <Badge variant={jobStatus === "failed" ? "error" : jobStatus === "completed" ? "success" : "default"}>
                    {statusCopy[jobStatus]}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 md:col-span-2">
                  <span className="text-sm font-semibold text-slate-800">Focus</span>
                  <textarea
                    value={focus}
                    onChange={(event) => setFocus(event.target.value)}
                    rows={3}
                    className="w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-300"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-800">Previous hook background</span>
                  <Input
                    value={previousHookBackground}
                    onChange={(event) => setPreviousHookBackground(event.target.value)}
                    placeholder="pink satin"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-800">Recently used features</span>
                  <Input
                    value={previousFeaturesText}
                    onChange={(event) => setPreviousFeaturesText(event.target.value)}
                    placeholder="Prayer, Ghusl, Sleep"
                  />
                </label>
              </div>

              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={publish}
                  onChange={(event) => setPublish(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-rose-500 focus:ring-rose-300"
                />
                Publish after images are generated
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={handlePreviewScript} isLoading={isPreviewing}>
                  <MessageCircleHeart className="mr-2 h-4 w-4" />
                  Preview Script
                </Button>
                <Button variant="primary" onClick={handleStartPipeline} isLoading={isStarting}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Start Pipeline
                </Button>
                {activeJobId ? (
                  <Button variant="outline" onClick={() => void pollJob(activeJobId)}>
                    <Loader2 className="mr-2 h-4 w-4" />
                    Refresh Status
                  </Button>
                ) : null}
              </div>

              {success ? (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{success}</span>
                </div>
              ) : null}

              {error ? (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {(activeJobId || progressEvents.length > 0) ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">Live Worker Debug</CardTitle>
                    <CardDescription>
                      Render progress updates written through the Vercel callback into Supabase.
                    </CardDescription>
                  </div>
                  {typeof progress === "number" ? (
                    <Badge variant={jobStatus === "failed" ? "error" : jobStatus === "completed" ? "success" : "warning"}>
                      {Math.max(0, Math.min(100, Math.round(progress)))}%
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      jobStatus === "failed" ? "bg-rose-500" : jobStatus === "completed" ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                    style={{ width: `${Math.max(3, Math.min(100, progress ?? 3))}%` }}
                  />
                </div>

                {progressEvents.length > 0 ? (
                  <div className="space-y-2">
                    {progressEvents.map((event) => (
                      <div
                        key={event.id}
                        className={`rounded-xl border px-4 py-3 ${
                          event.level === "error"
                            ? "border-rose-200 bg-rose-50"
                            : event.level === "warning"
                              ? "border-amber-200 bg-amber-50"
                              : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={event.level === "error" ? "error" : event.level === "warning" ? "warning" : "default"}>
                              {event.stage.replace(/_/g, " ")}
                            </Badge>
                            {event.slideNumber ? (
                              <span className="text-xs font-medium text-slate-500">Slide {event.slideNumber}</span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <Clock3 className="h-3.5 w-3.5" />
                            <span>{formatEventTime(event.at)}</span>
                            {formatElapsed(event.elapsedMs) ? <span>{formatElapsed(event.elapsedMs)}</span> : null}
                          </div>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-slate-700">{event.message}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Waiting for the first worker update.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {generatedImages.length > 0 ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">Generated Slides</CardTitle>
                    <CardDescription>
                      {isShowingPartialImages
                        ? `${generatedImages.length} uploaded slides so far. Final carousel is still running.`
                        : `${generatedImages.length} portrait images from GPT Image 2.`}
                    </CardDescription>
                  </div>
                  {isShowingPartialImages ? <Badge variant="warning">Partial</Badge> : <Badge variant="success">Final</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {generatedImages.map((image) => (
                    <div key={`${image.slideNumber}-${image.imageUrl}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <div
                        className="aspect-[2/3] bg-slate-100 bg-cover bg-center"
                        style={{ backgroundImage: `url("${image.imageUrl}")` }}
                        role="img"
                        aria-label={`Slide ${image.slideNumber}`}
                      />
                      <div className="space-y-2 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="default">Slide {image.slideNumber}</Badge>
                            <span className="text-xs font-medium text-slate-500">{getSlideLabel(image.slideType)}</span>
                          </div>
                          <a href={image.imageUrl} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-rose-600">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                        <p className="line-clamp-3 text-xs leading-relaxed text-slate-500">{image.prompt}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ImageIcon className="h-5 w-5 text-rose-500" />
                  Image Output
                </CardTitle>
                <CardDescription>
                  Images appear here after the Render worker finishes and calls back into this app.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">R2 Carousel Archive</CardTitle>
                  <CardDescription>
                    Existing muslimah.health carousel images grouped by inferred R2 post batch.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => void loadR2Gallery()} isLoading={isLoadingR2Posts}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {r2Error ? (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{r2Error}</span>
                </div>
              ) : null}

              {!r2Error && isLoadingR2Posts && r2Posts.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Loading R2 carousel images...
                </div>
              ) : null}

              {!isLoadingR2Posts && !r2Error && r2Posts.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  No R2 carousel images found for this collection yet.
                </div>
              ) : null}

              {r2Posts.map((post) => (
                <div key={post.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-slate-900">{formatPostSlug(post.postSlug)}</h4>
                        <Badge variant={post.slideCount >= 10 ? "success" : "warning"}>
                          {post.slideCount}/10 slides
                        </Badge>
                        <Badge variant="default">Batch {post.inferredBatch}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDateTime(post.lastUploadedAt)} · {formatBytes(post.totalBytes)}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {post.slides.map((slide) => (
                      <div key={slide.key} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        <div
                          className="aspect-[2/3] bg-slate-100 bg-cover bg-center"
                          style={{ backgroundImage: `url("${slide.publicUrl}")` }}
                          role="img"
                          aria-label={`R2 slide ${slide.slideNumber || "unknown"}`}
                        />
                        <div className="space-y-2 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant="default">
                              {slide.slideNumber ? `Slide ${slide.slideNumber}` : "Slide ?"}
                            </Badge>
                            <span className="text-[11px] text-slate-500">{formatBytes(slide.size)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <a
                              href={slide.publicUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 flex-1 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:border-rose-200 hover:text-rose-600"
                            >
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                              Open
                            </a>
                            <a
                              href={slide.downloadUrl}
                              className="inline-flex h-8 flex-1 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:border-rose-200 hover:text-rose-600"
                            >
                              <Download className="mr-1.5 h-3.5 w-3.5" />
                              Download
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {script ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">Script JSON</CardTitle>
                    <CardDescription>
                      Hook background: {script.hookBackground || "auto"} · {script.selectedFeatures.length} selected features
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={copyScript}>
                    <Copy className="mr-2 h-4 w-4" />
                    {copied ? "Copied" : "Copy JSON"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3">
                  <p className="text-base font-semibold text-slate-900">{script.hook}</p>
                  <p className="mt-1 text-sm text-slate-700">{script.subtitle}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {script.freshTalkingPoints.map((topic) => (
                    <Badge key={topic} variant="slides">
                      {topic}
                    </Badge>
                  ))}
                </div>

                <div className="space-y-3">
                  {slides.map((slide) => (
                    <div key={slide.slideNumber} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Badge variant="default">Slide {slide.slideNumber}</Badge>
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {getSlideLabel(slide.slideType)}
                        </span>
                      </div>
                      {slide.messages.length > 0 ? (
                        <div className="space-y-2">
                          {slide.messages.map((message, index) => (
                            <div
                              key={`${slide.slideNumber}-${index}-${message.timestamp}`}
                              className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm ${
                                message.speaker === "user"
                                  ? "ml-auto bg-lime-100 text-slate-900"
                                  : "bg-slate-50 text-slate-900"
                              }`}
                            >
                              <p>{message.text}</p>
                              <p className="mt-1 text-right text-[11px] text-slate-500">{message.timestamp}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-700">{slide.visualNotes}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Caption</p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{script.caption}</p>
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
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {done ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      ) : (
        <span className="h-2 w-2 rounded-full bg-slate-300" />
      )}
    </div>
  );
}
