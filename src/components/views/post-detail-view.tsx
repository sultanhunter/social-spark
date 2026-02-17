"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

type SlidePlan = {
  imagePrompt: string;
  headline: string;
  supportingText: string;
  textPlacement: "top" | "center" | "bottom";
  uiInstructions: {
    layoutConcept: string;
    artDirection: string;
    typography: {
      headlineFontFamily: string;
      headlineFontWeight: string;
      supportingFontFamily: string;
      supportingFontWeight: string;
      alignment: "left" | "center" | "right";
    };
    composition: {
      textArea: string;
      safeMargins: string;
      elementNotes: string[];
    };
    styling: {
      panelStyle: string;
      accentStyle: string;
      iconStyle: string;
    };
  };
};

type ScriptVersion = {
  id: "app_context" | "variant_only" | string;
  label: string;
  adaptationMode: "app_context" | "variant_only";
  usesAppContext: boolean;
  script: string;
  slidePlans: SlidePlan[];
};

type GeneratedVersionResult = {
  id: string;
  label: string;
  adaptationMode: "app_context" | "variant_only";
  usesAppContext: boolean;
  script: string;
  plans: SlidePlan[];
  images: string[];
};

type RecreationStep = "prepare" | "script" | "complete";

type NicheState = {
  isIslamic: boolean;
  isPregnancyOrPeriodRelated: boolean;
  canIncorporateAppContext: boolean;
  canReframeToIslamicAppContext: boolean;
  canRecreate: boolean;
  confidence: number;
  reason: string;
} | null;

type RecreatedHistoryItem = {
  id: string;
  script: string | null;
  generated_media_urls: string[];
  status: "draft" | "generating" | "completed" | "failed";
  created_at: string;
  updated_at: string;
};

function isAdaptationMode(value: unknown): value is "app_context" | "variant_only" {
  return value === "app_context" || value === "variant_only";
}

function sanitizeScriptVersions(payload: unknown): ScriptVersion[] {
  if (!Array.isArray(payload)) return [];

  return payload
    .map((item): ScriptVersion | null => {
      if (typeof item !== "object" || item === null) return null;
      const row = item as Record<string, unknown>;

      const script = typeof row.script === "string" ? row.script : "";
      if (!script.trim()) return null;

      const adaptationMode = isAdaptationMode(row.adaptationMode)
        ? row.adaptationMode
        : typeof row.usesAppContext === "boolean" && row.usesAppContext
          ? "app_context"
          : "variant_only";

      return {
        id: typeof row.id === "string" && row.id.length > 0 ? row.id : adaptationMode,
        label:
          typeof row.label === "string" && row.label.length > 0
            ? row.label
            : adaptationMode === "app_context"
              ? "App Context Rewrite"
              : "Original Topic Variant",
        adaptationMode,
        usesAppContext: adaptationMode === "app_context",
        script,
        slidePlans: Array.isArray(row.slidePlans) ? (row.slidePlans as SlidePlan[]) : [],
      };
    })
    .filter((version): version is ScriptVersion => Boolean(version));
}

function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function statusBadgeVariant(status: RecreatedHistoryItem["status"]): "default" | "warning" | "success" {
  if (status === "completed") return "success";
  if (status === "failed") return "warning";
  return "default";
}

interface PostDetailViewProps {
  postId: string;
}

export function PostDetailView({ postId }: PostDetailViewProps) {
  const router = useRouter();
  const { activeCollection, posts, isPostsLoading } = useAppStore();

  const selectedPost = useMemo(() => posts.find((post) => post.id === postId) || null, [posts, postId]);

  const [step, setStep] = useState<RecreationStep>("prepare");
  const [scriptVersions, setScriptVersions] = useState<ScriptVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string>("");
  const [generatedVersions, setGeneratedVersions] = useState<GeneratedVersionResult[]>([]);
  const [selectedReferenceImages, setSelectedReferenceImages] = useState<string[]>([]);
  const [nicheState, setNicheState] = useState<NicheState>(null);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [error, setError] = useState("");
  const [recreatedPostId, setRecreatedPostId] = useState<string | null>(null);
  const [history, setHistory] = useState<RecreatedHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [downloadingSetIds, setDownloadingSetIds] = useState<Record<string, boolean>>({});
  const [downloadingImageIds, setDownloadingImageIds] = useState<Record<string, boolean>>({});

  const referenceImages = useMemo(() => {
    if (selectedPost?.media_urls?.length) return selectedPost.media_urls;
    if (selectedPost?.thumbnail_url) return [selectedPost.thumbnail_url];
    return [] as string[];
  }, [selectedPost]);

  const activeVersion = scriptVersions.find((version) => version.id === activeVersionId) || null;

  const parseFileExtension = (url: string): string => {
    try {
      const parsed = new URL(url);
      const filename = parsed.pathname.split("/").pop() || "";
      const ext = filename.includes(".") ? filename.split(".").pop() || "" : "";
      if (/^[a-zA-Z0-9]{2,5}$/.test(ext)) return ext.toLowerCase();
    } catch {
      // Ignore URL parse failures
    }

    return "png";
  };

  const downloadImageSet = async (setId: string, filePrefix: string, imageUrls: string[]) => {
    if (imageUrls.length === 0) return;

    setDownloadingSetIds((prev) => ({ ...prev, [setId]: true }));

    try {
      for (let index = 0; index < imageUrls.length; index += 1) {
        const url = imageUrls[index];
        const ext = parseFileExtension(url);
        const filename = `${filePrefix}-slide-${index + 1}.${ext}`;
        const proxyUrl = `/api/media/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;

        const response = await fetch(proxyUrl);
        if (!response.ok) {
          throw new Error(`Failed to download image ${index + 1}`);
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download all images");
    } finally {
      setDownloadingSetIds((prev) => ({ ...prev, [setId]: false }));
    }
  };

  const downloadSingleImage = async (imageId: string, filePrefix: string, url: string, index: number) => {
    setDownloadingImageIds((prev) => ({ ...prev, [imageId]: true }));

    try {
      const ext = parseFileExtension(url);
      const filename = `${filePrefix}-slide-${index + 1}.${ext}`;
      const proxyUrl = `/api/media/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;

      const response = await fetch(proxyUrl);
      if (!response.ok) {
        throw new Error(`Failed to download image ${index + 1}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download image");
    } finally {
      setDownloadingImageIds((prev) => ({ ...prev, [imageId]: false }));
    }
  };

  const loadHistory = useCallback(async () => {
    if (!activeCollection) return;

    setIsHistoryLoading(true);

    try {
      const response = await fetch(`/api/recreate/history/${activeCollection.id}/${postId}`);
      if (!response.ok) throw new Error("Failed to fetch recreation history");

      const data = await response.json();
      setHistory(Array.isArray(data) ? (data as RecreatedHistoryItem[]) : []);
    } catch (err) {
      console.error("Failed to fetch recreation history:", err);
      setHistory([]);
    } finally {
      setIsHistoryLoading(false);
    }
  }, [activeCollection, postId]);

  useEffect(() => {
    if (!selectedPost) return;

    setStep("prepare");
    setScriptVersions([]);
    setActiveVersionId("");
    setGeneratedVersions([]);
    setNicheState(null);
    setError("");
    setRecreatedPostId(null);

    if (selectedPost.media_urls?.length) {
      setSelectedReferenceImages(selectedPost.media_urls);
    } else {
      setSelectedReferenceImages(selectedPost.thumbnail_url ? [selectedPost.thumbnail_url] : []);
    }
  }, [selectedPost]);

  useEffect(() => {
    if (!activeCollection) {
      setHistory([]);
      return;
    }

    loadHistory();
  }, [activeCollection, loadHistory]);

  const handleGenerateScript = async () => {
    if (!activeCollection || !selectedPost) return;
    if (referenceImages.length > 0 && selectedReferenceImages.length === 0) {
      setError("Select at least one reference image before generating scripts.");
      return;
    }

    setIsGeneratingScript(true);
    setError("");

    try {
      const response = await fetch("/api/recreate/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: selectedPost.id,
          collectionId: activeCollection.id,
          referenceImageUrls: selectedReferenceImages,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate script");
      }

      const canRecreate = typeof data.canRecreate === "boolean" ? data.canRecreate : Boolean(data.isIslamic);
      setNicheState({
        isIslamic: Boolean(data.isIslamic),
        isPregnancyOrPeriodRelated: Boolean(data.isPregnancyOrPeriodRelated),
        canIncorporateAppContext: Boolean(data.canIncorporateAppContext),
        canReframeToIslamicAppContext: Boolean(data.canReframeToIslamicAppContext),
        canRecreate,
        confidence: typeof data.relevanceConfidence === "number" ? data.relevanceConfidence : 0,
        reason: typeof data.relevanceReason === "string" ? data.relevanceReason : "",
      });

      if (!canRecreate) {
        setScriptVersions([]);
        setActiveVersionId("");
        setGeneratedVersions([]);
        setRecreatedPostId(null);
        setStep("prepare");
        return;
      }

      const versions = Array.isArray(data.versions)
        ? sanitizeScriptVersions(data.versions)
        : (() => {
            const fallbackScript = typeof data.script === "string" ? data.script : "";
            if (!fallbackScript.trim()) return [];
            const fallbackMode: ScriptVersion["adaptationMode"] = data.isAppNicheRelevant
              ? "app_context"
              : "variant_only";
            return [
              {
                id: "fallback",
                label: "Generated Script",
                adaptationMode: fallbackMode,
                usesAppContext: fallbackMode === "app_context",
                script: fallbackScript,
                slidePlans: Array.isArray(data.slidePlans) ? (data.slidePlans as SlidePlan[]) : [],
              },
            ];
          })();

      if (versions.length === 0) {
        throw new Error("No script version was generated.");
      }

      setScriptVersions(versions);
      setActiveVersionId(data.primaryVersionId || versions[0].id);
      setGeneratedVersions([]);
      setRecreatedPostId(typeof data.recreatedPostId === "string" ? data.recreatedPostId : null);
      setStep("script");
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Script generation failed");
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleGenerateImages = async () => {
    if (!activeCollection || !selectedPost) return;
    if (scriptVersions.length === 0) {
      setError("Generate scripts first.");
      return;
    }

    setIsGeneratingImages(true);
    setError("");

    try {
      const fallbackScript = activeVersion?.script || scriptVersions[0]?.script || "";
      const fallbackPlans = activeVersion?.slidePlans || scriptVersions[0]?.slidePlans || [];

      const response = await fetch("/api/recreate/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: fallbackScript,
          slidePlans: fallbackPlans,
          versions: scriptVersions,
          collectionId: activeCollection.id,
          postId: selectedPost.id,
          appName: activeCollection.app_name,
          recreatedPostId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate images");
      }

      const results = Array.isArray(data.versionResults) ? (data.versionResults as GeneratedVersionResult[]) : [];

      if (results.length === 0 && Array.isArray(data.images)) {
        setGeneratedVersions([
          {
            id: "fallback",
            label: activeVersion?.label || "Generated Output",
            adaptationMode: activeVersion?.adaptationMode || "variant_only",
            usesAppContext: Boolean(activeVersion?.usesAppContext),
            script: fallbackScript,
            plans: fallbackPlans,
            images: data.images,
          },
        ]);
      } else {
        setGeneratedVersions(results);
      }

      setStep("complete");
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image generation failed");
    } finally {
      setIsGeneratingImages(false);
    }
  };

  const resetSession = () => {
    setStep("prepare");
    setScriptVersions([]);
    setActiveVersionId("");
    setGeneratedVersions([]);
    setNicheState(null);
    setError("");
    setRecreatedPostId(null);
    setSelectedReferenceImages(referenceImages);
  };

  const isRecreationBlocked = Boolean(nicheState && !nicheState.canRecreate);

  const generationButtonConfig =
    step === "prepare"
      ? {
          label: isGeneratingScript ? "Classifying and generating scripts..." : "Step 1: Classify & Generate Scripts",
          onClick: handleGenerateScript,
          isLoading: isGeneratingScript,
          icon: Wand2,
          disabled: false,
        }
      : step === "script"
        ? {
            label: isGeneratingImages ? "Generating images..." : "Step 2: Generate All Versions",
            onClick: handleGenerateImages,
            isLoading: isGeneratingImages,
            icon: Sparkles,
            disabled: scriptVersions.length === 0,
          }
        : {
            label: "Start New Draft Session",
            onClick: resetSession,
            isLoading: false,
            icon: Wand2,
            disabled: false,
          };

  const GenerationIcon = generationButtonConfig.icon;

  if (!activeCollection) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Collection not found</h2>
          <p className="mt-2 text-sm text-slate-600">Select a collection from the sidebar to continue.</p>
          <Button variant="outline" className="mt-5" onClick={() => router.push("/")}>Go Home</Button>
        </div>
      </div>
    );
  }

  if (isPostsLoading && !selectedPost) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm text-slate-600 shadow-sm">
          Loading post details...
        </div>
      </div>
    );
  }

  if (!selectedPost) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Post not found in this collection</h2>
          <p className="mt-2 text-sm text-slate-600">
            The post may have been removed, or the URL is no longer valid.
          </p>
          <Button variant="outline" className="mt-5" onClick={() => router.push(`/collections/${activeCollection.id}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Collection
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4 lg:sticky lg:top-22 lg:h-fit">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/collections/${activeCollection.id}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to imported posts
          </Button>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Source Post</CardTitle>
              <CardDescription>Imported post used as recreation input</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                {selectedPost.thumbnail_url ? (
                  <img src={selectedPost.thumbnail_url} alt="Original post preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-500">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div>
                <p className="line-clamp-2 text-sm font-semibold text-slate-900">{selectedPost.title || "Untitled Post"}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="default">{selectedPost.platform}</Badge>
                  <Badge variant={selectedPost.post_type === "image_slides" ? "slides" : "video"}>
                    {selectedPost.post_type === "image_slides" ? "Slides" : "Video"}
                  </Badge>
                </div>
              </div>
              <a
                href={selectedPost.original_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-xs font-medium text-rose-700 hover:text-rose-600"
              >
                View original post
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workflow</CardTitle>
              <CardDescription>Single-post deterministic pipeline for AI agents</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <StatusRow label="1. Select references" done={selectedReferenceImages.length > 0 || referenceImages.length === 0} />
              <StatusRow label="2. Generate scripts" done={step !== "prepare"} />
              <StatusRow label="3. Generate images" done={step === "complete"} />
            </CardContent>
          </Card>

          {nicheState && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Niche Match</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={nicheState.isIslamic ? "success" : "warning"}>
                    Step 1 Islam: {nicheState.isIslamic ? "Pass" : "Fail"}
                  </Badge>
                  <Badge variant={nicheState.isPregnancyOrPeriodRelated ? "success" : "default"}>
                    Step 2 Pregnancy/Period: {nicheState.isPregnancyOrPeriodRelated ? "Pass" : "Fail"}
                  </Badge>
                  {!nicheState.isPregnancyOrPeriodRelated && nicheState.isIslamic ? (
                    <Badge variant={nicheState.canIncorporateAppContext ? "success" : "warning"}>
                      App Context Fit: {nicheState.canIncorporateAppContext ? "Yes" : "No"}
                    </Badge>
                  ) : null}
                  {!nicheState.isIslamic && nicheState.isPregnancyOrPeriodRelated ? (
                    <Badge variant={nicheState.canReframeToIslamicAppContext ? "success" : "warning"}>
                      Reframe to Islamic + App: {nicheState.canReframeToIslamicAppContext ? "Yes" : "No"}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={nicheState.canRecreate ? "success" : "warning"}>
                    {nicheState.canRecreate ? "Recreation Enabled" : "Recreation Disabled"}
                  </Badge>
                  <span>Confidence: {toPercent(nicheState.confidence)}</span>
                </div>
                {nicheState.reason ? <p>{nicheState.reason}</p> : null}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recreate This Post</CardTitle>
              <CardDescription>
                The flow first checks Islamic + pregnancy/period match before deciding which recreation sets to generate.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-800">Reference Images</p>
                {referenceImages.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {referenceImages.map((url, index) => {
                      const selected = selectedReferenceImages.includes(url);
                      return (
                        <button
                          key={`${url}-${index}`}
                          type="button"
                          onClick={() => {
                            setSelectedReferenceImages((prev) =>
                              prev.includes(url) ? prev.filter((item) => item !== url) : [...prev, url]
                            );
                          }}
                          className={`relative overflow-hidden rounded-xl border ${
                            selected ? "border-rose-400 ring-2 ring-rose-200" : "border-slate-200"
                          }`}
                        >
                          <img src={url} alt={`Reference ${index + 1}`} className="aspect-square w-full object-cover" />
                          <span className="absolute left-2 top-2 rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            {selected ? "Selected" : `Ref ${index + 1}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    No source images found. The model will use post text only.
                  </p>
                )}
              </div>

              {isRecreationBlocked ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Recreation is disabled for this post because it cannot be converted into a valid Islamic + app-context flow.
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="primary"
                    onClick={generationButtonConfig.onClick}
                    isLoading={generationButtonConfig.isLoading}
                    disabled={generationButtonConfig.disabled}
                  >
                    <GenerationIcon className="mr-2 h-4 w-4" />
                    {generationButtonConfig.label}
                  </Button>
                </div>
              )}

              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {scriptVersions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Generated Script Versions</CardTitle>
                <CardDescription>Select a version to review script details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {scriptVersions.map((version) => (
                    <button
                      key={version.id}
                      onClick={() => setActiveVersionId(version.id)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                        activeVersionId === version.id
                          ? "border-rose-300 bg-rose-50 text-rose-700"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      {version.label}
                    </button>
                  ))}
                </div>

                {activeVersion && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={activeVersion.usesAppContext ? "success" : "default"}>
                        {activeVersion.adaptationMode}
                      </Badge>
                      <Badge variant="default">{activeVersion.slidePlans.length} slides planned</Badge>
                      <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(activeVersion.script)}>
                        <Copy className="mr-2 h-4 w-4" />
                        Copy Script
                      </Button>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{activeVersion.script}</pre>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      {activeVersion.slidePlans.map((plan, index) => (
                        <div key={`${activeVersion.id}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Slide {index + 1}</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">{plan.headline}</p>
                          <p className="mt-1 text-xs text-slate-600">{plan.supportingText || "No supporting text"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {generatedVersions.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Current Session Outputs</CardTitle>
                  <CardDescription>Generated image sets from this active draft session</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {generatedVersions.map((result) => (
                    <div key={result.id} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={result.usesAppContext ? "success" : "default"}>{result.label}</Badge>
                        <Badge variant="default">{result.images.length} images</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-auto"
                          disabled={result.images.length === 0}
                          isLoading={Boolean(downloadingSetIds[`current-${result.id}`])}
                          onClick={() => downloadImageSet(`current-${result.id}`, `${result.id}-current`, result.images)}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download All
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        {result.images.map((url, index) => {
                          const imageId = `current-${result.id}-${index}`;

                          return (
                            <div
                              key={`${result.id}-${index}`}
                              className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                            >
                              <img
                                src={url}
                                alt={`${result.label} slide ${index + 1}`}
                                className="aspect-square w-full object-cover"
                              />
                              <div className="border-t border-slate-200 bg-white p-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-full justify-center"
                                  isLoading={Boolean(downloadingImageIds[imageId])}
                                  onClick={() =>
                                    downloadSingleImage(imageId, `${result.id}-current`, url, index)
                                  }
                                >
                                  <Download className="mr-2 h-4 w-4" />
                                  Download
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Previously Recreated Posts</CardTitle>
              <CardDescription>All recreations already generated from this imported post</CardDescription>
            </CardHeader>
            <CardContent>
              {isHistoryLoading ? (
                <p className="text-sm text-slate-500">Loading recreation history...</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-slate-500">No recreated posts yet. Generate scripts and images to create one.</p>
              ) : (
                <div className="space-y-4">
                  {history.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
                        <Badge variant="default">{item.generated_media_urls?.length || 0} images</Badge>
                        <span className="text-xs text-slate-500">Created {formatDate(item.created_at)}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-auto"
                          disabled={!item.generated_media_urls?.length}
                          isLoading={Boolean(downloadingSetIds[`history-${item.id}`])}
                          onClick={() =>
                            downloadImageSet(`history-${item.id}`, `recreated-${item.id}`, item.generated_media_urls || [])
                          }
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download All
                        </Button>
                      </div>
                      {Array.isArray(item.generated_media_urls) && item.generated_media_urls.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                          {item.generated_media_urls.map((url, index) => {
                            const imageId = `history-${item.id}-${index}`;

                            return (
                              <div
                                key={`${item.id}-${index}`}
                                className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                              >
                                <img
                                  src={url}
                                  alt={`Recreated slide ${index + 1}`}
                                  className="aspect-square w-full object-cover"
                                />
                                <div className="border-t border-slate-200 bg-white p-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-full justify-center"
                                    isLoading={Boolean(downloadingImageIds[imageId])}
                                    onClick={() =>
                                      downloadSingleImage(imageId, `recreated-${item.id}`, url, index)
                                    }
                                  >
                                    <Download className="mr-2 h-4 w-4" />
                                    Download
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">No images generated for this recreation yet.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {done ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      ) : (
        <div className="h-4 w-4 rounded-full border border-slate-300" />
      )}
      <span className={done ? "text-slate-700" : "text-slate-500"}>{label}</span>
    </div>
  );
}
