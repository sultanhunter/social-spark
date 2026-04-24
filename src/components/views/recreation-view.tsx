"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Eraser,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ASSET_STYLE_PRESETS,
  DEFAULT_ASSET_STYLE_PRESET,
  getAssetStylePreset,
  type AssetStylePresetId,
} from "@/lib/asset-style";

type SlidePlan = {
  headline: string;
  supportingText: string;
  figmaInstructions: string[];
  assetPrompts: { prompt: string; description: string }[];
};

type ScriptVersion = {
  id: "app_context" | "variant_only" | string;
  label: string;
  adaptationMode: "app_context" | "variant_only";
  usesAppContext: boolean;
  script: string;
  slidePlans: SlidePlan[];
  recreatedPostId?: string;
};

type GeneratedVersionResult = {
  id: string;
  label: string;
  adaptationMode: "app_context" | "variant_only";
  usesAppContext: boolean;
  script: string;
  plans: SlidePlan[];
  images: string[];
  recreatedPostId?: string;
  generatedCount?: number;
  totalAssets?: number;
};

type QueuedAsset = {
  index: number;
  prompt: string;
  label: string;
};

type RecreationStep = "prepare" | "script" | "complete";

type NicheState = {
  isRelevant: boolean;
  confidence: number;
  reason: string;
} | null;

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
        : (typeof row.usesAppContext === "boolean" && row.usesAppContext)
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
        recreatedPostId:
          typeof row.recreatedPostId === "string" && row.recreatedPostId.trim().length > 0
            ? row.recreatedPostId
            : undefined,
      };
    })
    .filter((version): version is ScriptVersion => Boolean(version));
}

function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function buildAssetQueue(slidePlans: SlidePlan[]): QueuedAsset[] {
  const queue: QueuedAsset[] = [];
  let index = 0;

  for (const plan of slidePlans) {
    if (!Array.isArray(plan.assetPrompts) || plan.assetPrompts.length === 0) {
      queue.push({
        index,
        prompt:
          "Clean abstract background with soft pink-to-blush gradients, suitable as a design asset for a social slide.",
        label: `Slide: ${plan.headline || `Slide ${index + 1}`}`,
      });
      index += 1;
      continue;
    }

    for (const asset of plan.assetPrompts) {
      queue.push({
        index,
        prompt: asset.prompt,
        label: asset.description || `Asset ${index + 1}`,
      });
      index += 1;
    }
  }

  return queue;
}

export function RecreationView() {
  const { selectedPost, activeCollection, setSelectedPost } = useAppStore();

  const [step, setStep] = useState<RecreationStep>("prepare");
  const [scriptVersions, setScriptVersions] = useState<ScriptVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string>("");
  const [generatedVersions, setGeneratedVersions] = useState<GeneratedVersionResult[]>([]);
  const [scriptRequestMode, setScriptRequestMode] = useState<"default" | "hook_strategy">("default");
  const [removeBgLoading, setRemoveBgLoading] = useState<Record<string, boolean>>({});

  const handleDownload = async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank");
    }
  };

  const handleRemoveBg = async (versionId: string, imageIndex: number, imageUrl: string) => {
    const key = `${versionId}-${imageIndex}`;
    setRemoveBgLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/remove-bg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      // Replace the image in state with the bg-removed version
      setGeneratedVersions((prev) =>
        prev.map((v) => {
          if (v.id !== versionId) return v;
          const newImages = [...v.images];
          newImages[imageIndex] = data.url;
          return { ...v, images: newImages };
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Background removal failed");
    } finally {
      setRemoveBgLoading((prev) => ({ ...prev, [key]: false }));
    }
  };
  const [selectedReferenceImages, setSelectedReferenceImages] = useState<string[]>([]);
  const [nicheState, setNicheState] = useState<NicheState>(null);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [assetStyleId, setAssetStyleId] = useState<AssetStylePresetId>(DEFAULT_ASSET_STYLE_PRESET);
  const [imageProgress, setImageProgress] = useState<{ done: number; total: number; current: string }>({
    done: 0,
    total: 0,
    current: "",
  });
  const [error, setError] = useState("");

  const referenceImages = useMemo(() => {
    if (selectedPost?.media_urls?.length) return selectedPost.media_urls;
    if (selectedPost?.thumbnail_url) return [selectedPost.thumbnail_url];
    return [] as string[];
  }, [selectedPost]);

  const activeVersion = scriptVersions.find((version) => version.id === activeVersionId) || null;
  const selectedAssetStyle = getAssetStylePreset(assetStyleId);

  useEffect(() => {
    if (!selectedPost) {
      setStep("prepare");
      setScriptVersions([]);
      setActiveVersionId("");
      setGeneratedVersions([]);
      setSelectedReferenceImages([]);
      setNicheState(null);
      setImageProgress({ done: 0, total: 0, current: "" });
      setError("");
      return;
    }

    if (selectedPost.media_urls?.length) {
      setSelectedReferenceImages(selectedPost.media_urls);
    } else {
      setSelectedReferenceImages(selectedPost.thumbnail_url ? [selectedPost.thumbnail_url] : []);
    }
  }, [selectedPost]);

  if (!selectedPost) {
    return <PostSelectionView />;
  }

  const handleGenerateScript = async (mode: "default" | "hook_strategy" = "default") => {
    if (!activeCollection) return;
    if (referenceImages.length > 0 && selectedReferenceImages.length === 0) {
      setError("Select at least one reference image before generating scripts.");
      return;
    }

    setScriptRequestMode(mode);
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
          includeHookStrategy: mode === "hook_strategy",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate script");
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
              recreatedPostId:
                typeof data.recreatedPostId === "string" && data.recreatedPostId.trim().length > 0
                  ? data.recreatedPostId
                  : undefined,
            },
          ];
        })();

      if (versions.length === 0) {
        throw new Error("No script version was generated.");
      }

      setScriptVersions(versions);
      const hookVersion = versions.find((version) => version.id.includes("hook_strategy"));
      setActiveVersionId(
        mode === "hook_strategy"
          ? hookVersion?.id || data.primaryVersionId || versions[0].id
          : data.primaryVersionId || versions[0].id
      );
      setGeneratedVersions([]);
      setImageProgress({ done: 0, total: 0, current: "" });
      setNicheState({
        isRelevant: Boolean(data.isAppNicheRelevant),
        confidence: typeof data.relevanceConfidence === "number" ? data.relevanceConfidence : 0,
        reason: typeof data.relevanceReason === "string" ? data.relevanceReason : "",
      });
      setStep("script");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Script generation failed");
    } finally {
      setIsGeneratingScript(false);
      setScriptRequestMode("default");
    }
  };

  const handleGenerateImages = async () => {
    if (!activeCollection) return;
    if (scriptVersions.length === 0) {
      setError("Generate scripts first.");
      return;
    }

    setIsGeneratingImages(true);
    setError("");
    try {
      const baseResults: GeneratedVersionResult[] = scriptVersions.map((version) => ({
        id: version.id,
        label: version.label,
        adaptationMode: version.adaptationMode,
        usesAppContext: version.usesAppContext,
        script: version.script,
        plans: version.slidePlans,
        images: [],
        recreatedPostId: version.recreatedPostId,
        generatedCount: 0,
        totalAssets: buildAssetQueue(version.slidePlans).length,
      }));

      setGeneratedVersions(baseResults);
      setStep("complete");

      const totalAssets = baseResults.reduce((sum, version) => sum + (version.totalAssets || 0), 0);
      let completedAssets = 0;
      const failures: string[] = [];

      setImageProgress({
        done: 0,
        total: totalAssets,
        current: totalAssets > 0 ? "Preparing generation queue..." : "No assets to generate.",
      });

      for (const version of scriptVersions) {
        const queue = buildAssetQueue(version.slidePlans);

        if (!version.recreatedPostId) {
          failures.push(`${version.label}: missing recreated post id.`);
          completedAssets += queue.length;
          continue;
        }

        for (let index = 0; index < queue.length; index += 1) {
          const asset = queue[index];
          const currentLabel = `${version.label} · ${asset.label}`;

          setImageProgress({
            done: completedAssets,
            total: totalAssets,
            current: `Generating ${currentLabel}`,
          });

          try {
            const response = await fetch("/api/recreate/regenerate-asset", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                collectionId: activeCollection.id,
                postId: selectedPost.id,
                recreatedPostId: version.recreatedPostId,
                assetPrompt: asset.prompt,
                assetIndex: asset.index,
                totalAssets: queue.length,
                isFinalAsset: index === queue.length - 1,
                appName: activeCollection.app_name,
                assetStyleId,
              }),
            });

            const data = (await response.json()) as {
              error?: string;
              generatedMediaUrls?: unknown;
              generatedCount?: number;
              totalAssets?: number;
            };

            if (!response.ok) {
              throw new Error(data.error || "Failed to generate image asset.");
            }

            const nextImages = Array.isArray(data.generatedMediaUrls)
              ? data.generatedMediaUrls.map((item) => (typeof item === "string" ? item : ""))
              : [];

            setGeneratedVersions((prev) =>
              prev.map((item) =>
                item.id === version.id
                  ? {
                    ...item,
                    images: nextImages,
                    generatedCount:
                      typeof data.generatedCount === "number"
                        ? data.generatedCount
                        : nextImages.filter((url) => typeof url === "string" && url.trim().length > 0)
                          .length,
                    totalAssets:
                      typeof data.totalAssets === "number" ? data.totalAssets : item.totalAssets,
                  }
                  : item
              )
            );
          } catch (assetError) {
            failures.push(
              `${currentLabel}: ${
                assetError instanceof Error ? assetError.message : "Asset generation failed"
              }`
            );
          } finally {
            completedAssets += 1;
            setImageProgress({
              done: completedAssets,
              total: totalAssets,
              current:
                completedAssets >= totalAssets
                  ? "Generation complete."
                  : `Completed ${completedAssets}/${totalAssets}`,
            });
          }
        }
      }

      if (failures.length > 0) {
        setError(`Some assets failed: ${failures.slice(0, 3).join(" | ")}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image generation failed");
    } finally {
      setIsGeneratingImages(false);
    }
  };

  const resetSession = () => {
    setSelectedPost(null);
    setStep("prepare");
    setScriptVersions([]);
    setActiveVersionId("");
    setGeneratedVersions([]);
    setSelectedReferenceImages([]);
    setNicheState(null);
    setError("");
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4 lg:sticky lg:top-22 lg:h-fit">
          <Button variant="ghost" size="sm" onClick={resetSession}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to post list
          </Button>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Source Post</CardTitle>
              <CardDescription>Reference used for recreation</CardDescription>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workflow</CardTitle>
              <CardDescription>Designed for reliable AI-agent operation</CardDescription>
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
              <CardContent className="space-y-2 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <Badge variant={nicheState.isRelevant ? "success" : "warning"}>
                    {nicheState.isRelevant ? "Relevant" : "Not Relevant"}
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
              <CardTitle className="text-lg">Recreation Studio</CardTitle>
              <CardDescription>
                Run the default recreation flow, or optionally generate a separate hook-strategy version set.
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
                          className={`relative overflow-hidden rounded-xl border ${selected ? "border-rose-400 ring-2 ring-rose-200" : "border-slate-200"
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

              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-800">Asset Style Match</p>
                <div className="flex flex-wrap gap-2">
                  {ASSET_STYLE_PRESETS.map((preset) => {
                    const isActive = preset.id === assetStyleId;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setAssetStyleId(preset.id)}
                        className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                          isActive
                            ? "border-rose-300 bg-rose-50 text-rose-700"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <p className="font-medium">{preset.label}</p>
                        <p className="text-xs text-slate-500">{preset.description}</p>
                      </button>
                    );
                  })}
                </div>
                {selectedAssetStyle.stylePrompt ? (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Selected style prompt: {selectedAssetStyle.stylePrompt}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  onClick={() => handleGenerateScript("default")}
                  isLoading={isGeneratingScript && scriptRequestMode === "default"}
                  disabled={isGeneratingScript}
                >
                  <Wand2 className="mr-2 h-4 w-4" />
                  {isGeneratingScript && scriptRequestMode === "default"
                    ? "Generating scripts..."
                    : "Generate Scripts"}
                </Button>

                <Button
                  variant="outline"
                  onClick={() => handleGenerateScript("hook_strategy")}
                  isLoading={isGeneratingScript && scriptRequestMode === "hook_strategy"}
                  disabled={isGeneratingScript}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {isGeneratingScript && scriptRequestMode === "hook_strategy"
                    ? "Generating hook strategy..."
                    : "Generate Hook Strategy Set"}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleGenerateImages}
                  isLoading={isGeneratingImages}
                  disabled={scriptVersions.length === 0}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {isGeneratingImages ? "Generating asset-by-asset..." : "Generate All Versions"}
                </Button>
              </div>

              {imageProgress.total > 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <p>
                    Progress: {imageProgress.done}/{imageProgress.total}
                  </p>
                  {imageProgress.current ? <p className="text-xs text-slate-500">{imageProgress.current}</p> : null}
                </div>
              ) : null}

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
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${activeVersionId === version.id
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigator.clipboard.writeText(activeVersion.script)}
                      >
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
                          {plan.figmaInstructions && plan.figmaInstructions.length > 0 && (
                            <div className="mt-2 border-t border-slate-100 pt-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-500">Figma Instructions</p>
                              <ol className="mt-1 list-inside list-decimal space-y-0.5 text-xs text-slate-600">
                                {plan.figmaInstructions.map((step, stepIndex) => (
                                  <li key={stepIndex}>{step}</li>
                                ))}
                              </ol>
                            </div>
                          )}
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
                  <CardTitle className="text-base">Generated Outputs</CardTitle>
                  <CardDescription>All generated image sets by version</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {generatedVersions.map((result) => (
                    <div key={result.id} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={result.usesAppContext ? "success" : "default"}>{result.label}</Badge>
                        <Badge variant="default">
                          {result.images.filter((url) => typeof url === "string" && url.trim().length > 0).length} images
                        </Badge>
                        {typeof result.generatedCount === "number" && typeof result.totalAssets === "number" ? (
                          <Badge variant="default">
                            {result.generatedCount}/{result.totalAssets} assets
                          </Badge>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        {(() => {
                          const assetNames: string[] = [];
                          for (const plan of result.plans) {
                            if (plan.assetPrompts.length === 0) {
                              assetNames.push(`Slide: ${plan.headline}`);
                            } else {
                              for (const asset of plan.assetPrompts) {
                                assetNames.push(asset.description || asset.prompt.slice(0, 60));
                              }
                            }
                          }
                          return result.images.map((url, index) => {
                            if (!url || !url.trim()) return null;
                            const bgKey = `${result.id}-${index}`;
                            const isRemoving = removeBgLoading[bgKey];
                            const assetName = assetNames[index] || `Asset ${index + 1}`;
                            return (
                              <div key={bgKey} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white">
                                <img src={url} alt={assetName} className="aspect-square w-full object-cover" />
                                <p className="truncate border-t border-slate-100 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500" title={assetName}>
                                  {assetName}
                                </p>
                                <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 flex-1 bg-white/20 text-[11px] text-white backdrop-blur-sm hover:bg-white/40"
                                    onClick={() => handleDownload(url, `${result.label}-slide-${index + 1}.png`)}
                                  >
                                    <Download className="mr-1 h-3 w-3" />
                                    Download
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 flex-1 bg-white/20 text-[11px] text-white backdrop-blur-sm hover:bg-white/40"
                                    disabled={isRemoving}
                                    onClick={() => handleRemoveBg(result.id, index, url)}
                                  >
                                    {isRemoving ? (
                                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                    ) : (
                                      <Eraser className="mr-1 h-3 w-3" />
                                    )}
                                    {isRemoving ? "Removing..." : "Remove BG"}
                                  </Button>
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>
      </div>
    </div >
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

function PostSelectionView() {
  const { posts, setSelectedPost, activeCollection, setCurrentStep } = useAppStore();
  const slidePosts = posts.filter((post) => post.post_type === "image_slides");

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 md:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Recreate Posts</h2>
            <p className="text-sm text-slate-600">
              Select a saved slide post to generate high-quality recreation variants for {activeCollection?.app_name || "your app"}.
            </p>
          </div>
          <Button variant="ghost" onClick={() => setCurrentStep("storage")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Storage
          </Button>
        </div>

        {slidePosts.length === 0 ? (
          <Card>
            <CardContent className="py-14 text-center">
              <Layers className="mx-auto mb-3 h-8 w-8 text-slate-400" />
              <p className="text-base font-medium text-slate-800">No slide posts available</p>
              <p className="mt-1 text-sm text-slate-500">Save carousel posts in Storage first, then recreate them here.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {slidePosts.map((post) => (
              <button
                key={post.id}
                onClick={() => setSelectedPost(post)}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="aspect-square overflow-hidden bg-slate-100">
                  {post.thumbnail_url ? (
                    <img src={post.thumbnail_url} alt={post.title || "Saved post preview"} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-400">
                      <FileText className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-semibold text-slate-900">{post.title || "Untitled Post"}</p>
                  <p className="mt-1 text-xs text-slate-500">Click to open recreation studio</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
