"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  IMAGE_GENERATION_MODELS,
  isImageGenerationModel,
} from "@/lib/image-generation-model";
import {
  DEFAULT_REASONING_MODEL,
  REASONING_MODELS,
  isReasoningModel,
} from "@/lib/reasoning-model";
import { formatDate } from "@/lib/utils";

type SlidePlan = {
  headline: string;
  supportingText: string;
  figmaInstructions: string[];
  assetPrompts: { prompt: string; description: string }[];
};

type ScriptVersion = {
  id: string;
  label: string;
  adaptationMode: "app_context" | "variant_only";
  usesAppContext: boolean;
  uiGenerationMode: "reference_exact" | "ai_creative";
  followsReferenceLayout: boolean;
  script: string;
  slidePlans: SlidePlan[];
  recreatedPostId?: string | null;
};

type GeneratedVersionResult = {
  id: string;
  label: string;
  adaptationMode: "app_context" | "variant_only";
  usesAppContext: boolean;
  uiGenerationMode: "reference_exact" | "ai_creative";
  followsReferenceLayout: boolean;
  script: string;
  plans: SlidePlan[];
  images: string[];
  recreatedPostId?: string | null;
  caption?: string | null;
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
  caption?: string | null;
  status: "draft" | "generating" | "completed" | "failed";
  generation_state?: {
    setType?: string;
    adaptationMode?: string;
    versionLabel?: string;
    stage?: string;
    totalSlides?: number;
    completedSlides?: number;
    failedSlides?: number;
    currentSlide?: number | null;
    error?: string | null;
    slides?: Array<{
      slideIndex?: number;
      status?: string;
      attempt?: number;
      maxAttempts?: number;
      verificationScore?: number | null;
      message?: string | null;
      issues?: string[];
    }>;
  } | null;
  created_at: string;
  updated_at: string;
  slide_plans?: SlidePlan[] | null;
};

function isAdaptationMode(value: unknown): value is "app_context" | "variant_only" {
  return value === "app_context" || value === "variant_only";
}

function isUIGenerationMode(value: unknown): value is "reference_exact" | "ai_creative" {
  return value === "reference_exact" || value === "ai_creative";
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
        uiGenerationMode: isUIGenerationMode(row.uiGenerationMode) ? row.uiGenerationMode : "ai_creative",
        followsReferenceLayout: isUIGenerationMode(row.uiGenerationMode)
          ? row.uiGenerationMode === "reference_exact"
          : false,
        script,
        slidePlans: Array.isArray(row.slidePlans) ? (row.slidePlans as SlidePlan[]) : [],
        recreatedPostId: typeof row.recreatedPostId === "string" ? row.recreatedPostId : null,
      };
    })
    .filter((version): version is ScriptVersion => Boolean(version));
}

function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function extractSlideScriptSections(script: string | null | undefined): string[] {
  if (typeof script !== "string") return [];

  const normalized = script.replace(/\r/g, "").trim();
  if (!normalized) return [];

  const matches = normalized.match(/(?:^|\n)(Slide\s+\d+[\s\S]*?)(?=\nSlide\s+\d+|$)/gi);
  if (!matches) return [];

  return matches.map((section) => section.trim()).filter((section) => section.length > 0);
}

function HistorySlidePlans({ plans, itemId, script }: { plans: SlidePlan[]; itemId: string; script?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const slideScripts = useMemo(() => extractSlideScriptSections(script), [script]);

  const allInstructions = plans
    .map((p, i) => {
      const lines = [`--- Slide ${i + 1}: ${p.headline} ---`];
      const slideScript = slideScripts[i];
      if (slideScript) {
        lines.push("Slide Script:", slideScript);
      }
      lines.push("Figma Instructions:", ...p.figmaInstructions);
      return lines.join("\n");
    })
    .join("\n\n");

  const handleCopy = () => {
    navigator.clipboard.writeText(allInstructions);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white">
      <button
        className="flex w-full items-center justify-between p-3 text-left text-xs font-medium text-slate-600 hover:bg-slate-50"
        onClick={() => setExpanded(!expanded)}
      >
        <span>Figma Instructions ({plans.length} slides)</span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {expanded && (
        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="mr-1 h-3 w-3" />
              {copied ? "Copied!" : "Copy All Instructions"}
            </Button>
          </div>
          <div className="space-y-3">
            {plans.map((plan, i) => (
              <div key={`${itemId}-plan-${i}`} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <p className="text-xs font-semibold text-slate-700">
                  Slide {i + 1}: {plan.headline}
                </p>
                {plan.supportingText && (
                  <p className="mt-0.5 text-[11px] text-slate-500">{plan.supportingText}</p>
                )}
                <div className="mt-1.5 grid gap-2 md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-white p-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Slide Script</p>
                    <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-700">
                      {slideScripts[i] || "Script block not available for this slide."}
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white p-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Figma Instructions</p>
                    <ul className="mt-1 space-y-0.5">
                      {plan.figmaInstructions.map((instruction, j) => (
                        <li key={j} className="text-[11px] leading-relaxed text-slate-600">
                          {instruction}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                {plan.assetPrompts?.length > 0 && (
                  <div className="mt-1.5 border-t border-slate-100 pt-1.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Assets</p>
                    {plan.assetPrompts.map((asset, k) => (
                      <p key={k} className="text-[11px] text-slate-500">• {asset.description || asset.prompt}</p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function statusBadgeVariant(status: RecreatedHistoryItem["status"]): "default" | "warning" | "success" {
  if (status === "completed") return "success";
  if (status === "failed") return "warning";
  return "default";
}

function normalizeHistorySetType(value: unknown): "variant_only" | "app_context" | "hook_strategy" | null {
  if (value === "variant_only" || value === "app_context" || value === "hook_strategy") {
    return value;
  }
  return null;
}

function inferHistorySetType(item: RecreatedHistoryItem): "variant_only" | "app_context" | "hook_strategy" | "unknown" {
  const fromState = normalizeHistorySetType(item.generation_state?.setType);
  if (fromState) return fromState;

  if (typeof item.script === "string") {
    if (/Adaptation Mode\s*:\s*app_context/i.test(item.script)) return "app_context";
    if (/Adaptation Mode\s*:\s*variant_only/i.test(item.script)) return "variant_only";
  }

  return "unknown";
}

function setTypeLabel(value: "variant_only" | "app_context" | "hook_strategy" | "unknown"): string {
  if (value === "hook_strategy") return "hook_strategy";
  if (value === "app_context") return "app_context";
  if (value === "variant_only") return "variant_only";
  return "unknown";
}

function historyChanged(prev: RecreatedHistoryItem[], next: RecreatedHistoryItem[]): boolean {
  if (prev.length !== next.length) return true;

  for (let index = 0; index < prev.length; index += 1) {
    const current = prev[index];
    const incoming = next[index];

    if (current.id !== incoming.id) return true;
    if (current.status !== incoming.status) return true;
    if (current.updated_at !== incoming.updated_at) return true;
    if ((current.generated_media_urls?.length || 0) !== (incoming.generated_media_urls?.length || 0)) {
      return true;
    }
    if ((current.caption || "") !== (incoming.caption || "")) return true;
  }

  return false;
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
  const [scriptRequestMode, setScriptRequestMode] = useState<"default" | "hook_strategy">("default");
  const [error, setError] = useState("");
  const [reasoningModel, setReasoningModel] = useState(DEFAULT_REASONING_MODEL);
  const [imageGenerationModel, setImageGenerationModel] = useState(DEFAULT_IMAGE_GENERATION_MODEL);
  const [recreatedPostId, setRecreatedPostId] = useState<string | null>(null);
  const [history, setHistory] = useState<RecreatedHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [generatingHistoryBySetId, setGeneratingHistoryBySetId] = useState<Record<string, boolean>>({});
  const [downloadingSetIds, setDownloadingSetIds] = useState<Record<string, boolean>>({});
  const [downloadingImageIds, setDownloadingImageIds] = useState<Record<string, boolean>>({});
  const [removeBgLoading, setRemoveBgLoading] = useState<Record<string, boolean>>({});

  const handleRemoveBg = async (imageKey: string, imageUrl: string, versionId?: string, historyItemId?: string) => {
    setRemoveBgLoading((prev) => ({ ...prev, [imageKey]: true }));
    try {
      const res = await fetch("/api/remove-bg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      if (versionId) {
        setGeneratedVersions((prev) =>
          prev.map((v) => {
            if (v.id !== versionId) return v;
            const newImages = [...v.images];
            newImages[imageKey.split("-").pop() ? Number(imageKey.split("-").pop()) : 0] = data.url;
            return { ...v, images: newImages };
          })
        );
      }
      if (historyItemId) {
        window.open(data.url, "_blank");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Background removal failed");
    } finally {
      setRemoveBgLoading((prev) => ({ ...prev, [imageKey]: false }));
    }
  };
  const [captionLoadingBySetId, setCaptionLoadingBySetId] = useState<Record<string, boolean>>({});
  const [captionsBySetId, setCaptionsBySetId] = useState<Record<string, string>>({});
  const [postingInstagramBySetId, setPostingInstagramBySetId] = useState<Record<string, boolean>>({});
  const [instagramResultBySetId, setInstagramResultBySetId] = useState<
    Record<string, { mediaId: string; permalink: string | null }>
  >({});

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

  const handleGenerateCaption = async ({
    setId,
    script,
    slidePlans,
    recreatedPostId: captionRecreatedPostId,
  }: {
    setId: string;
    script: string;
    slidePlans?: SlidePlan[];
    recreatedPostId?: string | null;
  }) => {
    if (!activeCollection) return;

    setCaptionLoadingBySetId((prev) => ({ ...prev, [setId]: true }));
    setError("");

    try {
      const response = await fetch("/api/recreate/caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId: activeCollection.id,
          postId,
          script,
          slidePlans,
          recreatedPostId: captionRecreatedPostId,
          reasoningModel,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate caption");
      }

      if (isReasoningModel(data.reasoningModel)) {
        setReasoningModel(data.reasoningModel);
      }

      const caption = typeof data.caption === "string" ? data.caption.trim() : "";
      if (!caption) {
        throw new Error("Caption generation failed");
      }

      setCaptionsBySetId((prev) => ({ ...prev, [setId]: caption }));

      if (captionRecreatedPostId) {
        setHistory((prev) =>
          prev.map((item) =>
            item.id === captionRecreatedPostId
              ? {
                ...item,
                caption,
              }
              : item
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate caption");
    } finally {
      setCaptionLoadingBySetId((prev) => ({ ...prev, [setId]: false }));
    }
  };

  const handlePublishToInstagram = async ({
    setId,
    imageUrls,
    caption,
    recreatedPostId: publishRecreatedPostId,
  }: {
    setId: string;
    imageUrls: string[];
    caption?: string;
    recreatedPostId?: string | null;
  }) => {
    if (!activeCollection) return;
    if (imageUrls.length === 0) {
      setError("No images available for Instagram publishing.");
      return;
    }

    setPostingInstagramBySetId((prev) => ({ ...prev, [setId]: true }));
    setError("");

    try {
      const response = await fetch("/api/social/instagram/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId: activeCollection.id,
          postId,
          recreatedPostId: publishRecreatedPostId,
          imageUrls,
          caption: caption || "",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to publish to Instagram");
      }

      const mediaId = typeof data.mediaId === "string" ? data.mediaId : "";
      if (!mediaId) {
        throw new Error("Instagram publish succeeded but no media ID was returned.");
      }

      const permalink = typeof data.permalink === "string" ? data.permalink : null;

      setInstagramResultBySetId((prev) => ({
        ...prev,
        [setId]: {
          mediaId,
          permalink,
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish to Instagram");
    } finally {
      setPostingInstagramBySetId((prev) => ({ ...prev, [setId]: false }));
    }
  };

  const handleGenerateHistoryImages = async (item: RecreatedHistoryItem) => {
    if (!activeCollection || !selectedPost) return;

    const script = typeof item.script === "string" ? item.script.trim() : "";
    if (!script) {
      setError("Cannot generate images for this set because its script is missing.");
      return;
    }

    setGeneratingHistoryBySetId((prev) => ({ ...prev, [item.id]: true }));
    setError("");

    try {
      const adaptationMode: "app_context" | "variant_only" = /Adaptation Mode\s*:\s*app_context/i.test(script)
        ? "app_context"
        : "variant_only";
      const setType = inferHistorySetType(item);

      const slidePlans = Array.isArray(item.slide_plans) ? item.slide_plans : [];

      const response = await fetch("/api/recreate/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script,
          slidePlans,
          versions: [
            {
              id: `history-${item.id}`,
              label: "History Regeneration",
              setType: setType === "unknown" ? adaptationMode : setType,
              adaptationMode,
              usesAppContext: adaptationMode === "app_context",
              uiGenerationMode: "ai_creative",
              followsReferenceLayout: false,
              script,
              slidePlans,
              recreatedPostId: item.id,
            },
          ],
          collectionId: activeCollection.id,
          postId: selectedPost.id,
          appName: activeCollection.app_name,
          recreatedPostId: item.id,
          reasoningModel,
          imageGenerationModel,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate images for this set");
      }

      if (isReasoningModel(data.reasoningModel)) {
        setReasoningModel(data.reasoningModel);
      }

      if (isImageGenerationModel(data.imageGenerationModel)) {
        setImageGenerationModel(data.imageGenerationModel);
      }

      await loadHistory({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate images for this set");
    } finally {
      setGeneratingHistoryBySetId((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const loadHistory = useCallback(async (options?: { silent?: boolean }) => {
    if (!activeCollection) return;
    const silent = Boolean(options?.silent);

    if (!silent) {
      setIsHistoryLoading(true);
    }

    try {
      const response = await fetch(`/api/recreate/history/${activeCollection.id}/${postId}`);
      if (!response.ok) throw new Error("Failed to fetch recreation history");

      const data = await response.json();
      const nextHistory = Array.isArray(data) ? (data as RecreatedHistoryItem[]) : [];
      setHistory((prev) => (historyChanged(prev, nextHistory) ? nextHistory : prev));
    } catch (err) {
      console.error("Failed to fetch recreation history:", err);
      if (!silent) {
        setHistory([]);
      }
    } finally {
      if (!silent) {
        setIsHistoryLoading(false);
      }
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
    setCaptionsBySetId({});
    setCaptionLoadingBySetId({});
    setPostingInstagramBySetId({});
    setInstagramResultBySetId({});
    setGeneratingHistoryBySetId({});

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

  useEffect(() => {
    const hasGeneratingHistory = history.some((item) => item.status === "generating");
    if (!isGeneratingImages && !hasGeneratingHistory) return;

    const intervalId = window.setInterval(() => {
      void loadHistory({ silent: true });
    }, 2500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isGeneratingImages, history, loadHistory]);

  const handleGenerateScript = async (mode: "default" | "hook_strategy" = "default") => {
    if (!activeCollection || !selectedPost) return;
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
          reasoningModel,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate script");
      }

      if (isReasoningModel(data.reasoningModel)) {
        setReasoningModel(data.reasoningModel);
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

      const versions: ScriptVersion[] = Array.isArray(data.versions)
        ? sanitizeScriptVersions(data.versions)
        : ((): ScriptVersion[] => {
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
              uiGenerationMode: "ai_creative",
              followsReferenceLayout: false,
              script: fallbackScript,
              slidePlans: Array.isArray(data.slidePlans) ? (data.slidePlans as SlidePlan[]) : [],
              recreatedPostId: typeof data.recreatedPostId === "string" ? data.recreatedPostId : null,
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
      setRecreatedPostId(typeof data.recreatedPostId === "string" ? data.recreatedPostId : null);
      setStep("script");
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Script generation failed");
    } finally {
      setIsGeneratingScript(false);
      setScriptRequestMode("default");
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
          reasoningModel,
          imageGenerationModel,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate images");
      }

      if (isReasoningModel(data.reasoningModel)) {
        setReasoningModel(data.reasoningModel);
      }

      if (isImageGenerationModel(data.imageGenerationModel)) {
        setImageGenerationModel(data.imageGenerationModel);
      }

      const results = Array.isArray(data.versionResults) ? (data.versionResults as GeneratedVersionResult[]) : [];
      const failedVersions = Array.isArray(data.failedVersions)
        ? data.failedVersions.filter(
          (item: unknown): item is { label?: string; error?: string } =>
            typeof item === "object" && item !== null
        )
        : [];

      if (results.length === 0 && Array.isArray(data.images)) {
        setGeneratedVersions([
          {
            id: "fallback",
            label: activeVersion?.label || "Generated Output",
            adaptationMode: activeVersion?.adaptationMode || "variant_only",
            usesAppContext: Boolean(activeVersion?.usesAppContext),
            uiGenerationMode: activeVersion?.uiGenerationMode || "ai_creative",
            followsReferenceLayout: Boolean(activeVersion?.followsReferenceLayout),
            script: fallbackScript,
            plans: fallbackPlans,
            images: data.images,
            recreatedPostId: typeof data.recreatedPostId === "string" ? data.recreatedPostId : null,
          },
        ]);
      } else {
        setGeneratedVersions(results);
      }

      if (failedVersions.length > 0) {
        const failures = failedVersions
          .map((item: { label?: string; error?: string }) =>
            `${item.label || "Version"}: ${item.error || "Unknown error"}`
          )
          .join(" | ");
        setError(`Some versions failed during verification pipeline. ${failures}`);
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
    setCaptionsBySetId({});
    setCaptionLoadingBySetId({});
    setPostingInstagramBySetId({});
    setInstagramResultBySetId({});
    setGeneratingHistoryBySetId({});
  };

  const isRecreationBlocked = Boolean(nicheState && !nicheState.canRecreate);

  const generationButtonConfig =
    step === "prepare"
      ? {
        label:
          isGeneratingScript && scriptRequestMode === "default"
            ? "Classifying and generating scripts..."
            : "Step 1: Classify & Generate Scripts",
        onClick: () => {
          void handleGenerateScript("default");
        },
        isLoading: isGeneratingScript && scriptRequestMode === "default",
        icon: Wand2,
        disabled: isGeneratingScript,
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
                The flow checks Islamic + pregnancy/period match, then you can run standard recreation or an optional hook-strategy recreation.
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
                <p className="text-sm font-semibold text-slate-800">Reasoning Model</p>
                <select
                  value={reasoningModel}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (isReasoningModel(value)) {
                      setReasoningModel(value);
                    }
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                >
                  {REASONING_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-800">Image Generation Model</p>
                <select
                  value={imageGenerationModel}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (isImageGenerationModel(value)) {
                      setImageGenerationModel(value);
                    }
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                >
                  {IMAGE_GENERATION_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
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
                  {step === "prepare" ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        void handleGenerateScript("hook_strategy");
                      }}
                      isLoading={isGeneratingScript && scriptRequestMode === "hook_strategy"}
                      disabled={isGeneratingScript}
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      {isGeneratingScript && scriptRequestMode === "hook_strategy"
                        ? "Generating hook strategy..."
                        : "Hook Strategy Recreation"}
                    </Button>
                  ) : null}
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
                      <Badge variant="default">
                        {activeVersion.uiGenerationMode === "reference_exact" ? "Exact Source UI" : "AI Creative UI"}
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
                  <CardTitle className="text-base">Current Session Outputs</CardTitle>
                  <CardDescription>Generated image sets from this active draft session</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {generatedVersions.map((result) => {
                    const captionKey = `current-${result.id}`;
                    const caption = captionsBySetId[captionKey] || result.caption || "";
                    const hasCaption = Boolean(caption.trim());
                    const instagramResult = instagramResultBySetId[captionKey];

                    return (
                      <div key={result.id} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={result.usesAppContext ? "success" : "default"}>{result.label}</Badge>
                          <Badge variant="default">
                            {result.uiGenerationMode === "reference_exact" ? "Exact Source UI" : "AI Creative UI"}
                          </Badge>
                          <Badge variant="default">{result.images.length} images</Badge>
                          <div className="ml-auto flex flex-wrap items-center gap-2">
                            {hasCaption ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigator.clipboard.writeText(caption)}
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                Copy Caption
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                isLoading={Boolean(captionLoadingBySetId[captionKey])}
                                onClick={() =>
                                  handleGenerateCaption({
                                    setId: captionKey,
                                    script: result.script,
                                    slidePlans: result.plans,
                                    recreatedPostId: result.recreatedPostId,
                                  })
                                }
                              >
                                <Sparkles className="mr-2 h-4 w-4" />
                                Generate Caption
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={result.images.length === 0}
                              isLoading={Boolean(downloadingSetIds[`current-${result.id}`])}
                              onClick={() =>
                                downloadImageSet(`current-${result.id}`, `${result.id}-current`, result.images)
                              }
                            >
                              <Download className="mr-2 h-4 w-4" />
                              Download All
                            </Button>
                            {instagramResult?.permalink ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (!instagramResult.permalink) return;
                                  window.open(instagramResult.permalink, "_blank", "noopener,noreferrer");
                                }}
                              >
                                <ExternalLink className="mr-2 h-4 w-4" />
                                View on Instagram
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={result.images.length === 0}
                                isLoading={Boolean(postingInstagramBySetId[captionKey])}
                                onClick={() =>
                                  handlePublishToInstagram({
                                    setId: captionKey,
                                    imageUrls: result.images,
                                    caption,
                                    recreatedPostId: result.recreatedPostId,
                                  })
                                }
                              >
                                <Send className="mr-2 h-4 w-4" />
                                Post to Instagram
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                          {(() => {
                            // Build flat list of asset descriptions from slide plans
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
                              const imageId = `current-${result.id}-${index}`;
                              const assetName = assetNames[index] || `Asset ${index + 1}`;

                              return (
                                <div
                                  key={`${result.id}-${index}`}
                                  className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                                >
                                  <img
                                    src={url}
                                    alt={assetName}
                                    className="aspect-square w-full object-cover"
                                  />
                                  <p className="truncate border-t border-slate-100 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500" title={assetName}>
                                    {assetName}
                                  </p>
                                  <div className="flex gap-1 border-t border-slate-200 bg-white p-1.5">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 flex-1 justify-center p-0 text-[11px]"
                                      isLoading={Boolean(downloadingImageIds[imageId])}
                                      onClick={() =>
                                        downloadSingleImage(imageId, `${result.id}-current`, url, index)
                                      }
                                    >
                                      <Download className="mr-1 h-3 w-3" />
                                      Download
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 flex-1 justify-center p-0 text-[11px]"
                                      disabled={Boolean(removeBgLoading[imageId])}
                                      onClick={() => handleRemoveBg(imageId, url, result.id)}
                                    >
                                      {removeBgLoading[imageId] ? (
                                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                      ) : (
                                        <Eraser className="mr-1 h-3 w-3" />
                                      )}
                                      {removeBgLoading[imageId] ? "Removing..." : "Remove BG"}
                                    </Button>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                        {hasCaption ? (
                          <div className="rounded-lg border border-slate-200 bg-white p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Caption</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{caption}</p>
                          </div>
                        ) : null}
                        {
                          instagramResult ? (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                              {instagramResult.permalink
                                ? "Posted to Instagram successfully."
                                : `Posted to Instagram (Media ID: ${instagramResult.mediaId}).`}
                            </div>
                          ) : null
                        }
                      </div>
                    );
                  })}
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
                  {history.map((item) => {
                    const captionKey = `history-${item.id}`;
                    const caption = item.caption || captionsBySetId[captionKey] || "";
                    const hasCaption = Boolean(caption.trim());
                    const instagramResult = instagramResultBySetId[captionKey];
                    const generatedCount = item.generated_media_urls?.length || 0;
                    const historySetType = inferHistorySetType(item);

                    return (
                      <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
                          <Badge variant="default">{setTypeLabel(historySetType)}</Badge>
                          <Badge variant="default">{item.generated_media_urls?.length || 0} images</Badge>
                          <span className="text-xs text-slate-500">Created {formatDate(item.created_at)}</span>
                          <div className="ml-auto flex flex-wrap items-center gap-2">
                            {hasCaption ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigator.clipboard.writeText(caption)}
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                Copy Caption
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                isLoading={Boolean(captionLoadingBySetId[captionKey])}
                                onClick={() =>
                                  handleGenerateCaption({
                                    setId: captionKey,
                                    script: item.script || "",
                                    recreatedPostId: item.id,
                                  })
                                }
                              >
                                <Sparkles className="mr-2 h-4 w-4" />
                                Generate Caption
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={item.status === "generating" || !item.script}
                              isLoading={Boolean(generatingHistoryBySetId[item.id])}
                              onClick={() => {
                                void handleGenerateHistoryImages(item);
                              }}
                            >
                              <Sparkles className="mr-2 h-4 w-4" />
                              {item.generated_media_urls?.length ? "Regenerate Images" : "Generate Images"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!item.generated_media_urls?.length}
                              isLoading={Boolean(downloadingSetIds[`history-${item.id}`])}
                              onClick={() =>
                                downloadImageSet(
                                  `history-${item.id}`,
                                  `recreated-${item.id}`,
                                  item.generated_media_urls || []
                                )
                              }
                            >
                              <Download className="mr-2 h-4 w-4" />
                              Download All
                            </Button>
                            {instagramResult?.permalink ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (!instagramResult.permalink) return;
                                  window.open(instagramResult.permalink, "_blank", "noopener,noreferrer");
                                }}
                              >
                                <ExternalLink className="mr-2 h-4 w-4" />
                                View on Instagram
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!item.generated_media_urls?.length}
                                isLoading={Boolean(postingInstagramBySetId[captionKey])}
                                onClick={() =>
                                  handlePublishToInstagram({
                                    setId: captionKey,
                                    imageUrls: item.generated_media_urls || [],
                                    caption,
                                    recreatedPostId: item.id,
                                  })
                                }
                              >
                                <Send className="mr-2 h-4 w-4" />
                                Post to Instagram
                              </Button>
                            )}
                          </div>
                        </div>
                        {item.status === "generating" ? (
                          <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
                            <p className="text-xs text-slate-600">
                              Generating slides... {generatedCount} image{generatedCount === 1 ? "" : "s"} ready.
                            </p>
                          </div>
                        ) : null}
                        {Array.isArray(item.slide_plans) && item.slide_plans.length > 0 && (
                          <HistorySlidePlans plans={item.slide_plans} itemId={item.id} script={item.script} />
                        )}
                        {Array.isArray(item.generated_media_urls) && item.generated_media_urls.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                            {(() => {
                              // Build flat list of asset descriptions from slide plans
                              const assetNames: string[] = [];
                              if (Array.isArray(item.slide_plans)) {
                                for (const plan of item.slide_plans) {
                                  if (plan.assetPrompts.length === 0) {
                                    assetNames.push(`Slide: ${plan.headline}`);
                                  } else {
                                    for (const asset of plan.assetPrompts) {
                                      assetNames.push(asset.description || asset.prompt.slice(0, 60));
                                    }
                                  }
                                }
                              }
                              return item.generated_media_urls.map((url, index) => {
                                const imageId = `history-${item.id}-${index}`;
                                const assetName = assetNames[index] || `Asset ${index + 1}`;

                                return (
                                  <div
                                    key={`${item.id}-${index}`}
                                    className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                                  >
                                    <img
                                      src={url}
                                      alt={assetName}
                                      className="aspect-square w-full object-cover"
                                    />
                                    <p className="truncate border-t border-slate-100 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500" title={assetName}>
                                      {assetName}
                                    </p>
                                    <div className="flex gap-1 border-t border-slate-200 bg-white p-1.5">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 flex-1 justify-center p-0 text-[11px]"
                                        isLoading={Boolean(downloadingImageIds[imageId])}
                                        onClick={() =>
                                          downloadSingleImage(imageId, `recreated-${item.id}`, url, index)
                                        }
                                      >
                                        <Download className="mr-1 h-3 w-3" />
                                        Download
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 flex-1 justify-center p-0 text-[11px]"
                                        disabled={Boolean(removeBgLoading[imageId])}
                                        onClick={() => handleRemoveBg(imageId, url, undefined, item.id)}
                                      >
                                        {removeBgLoading[imageId] ? (
                                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                        ) : (
                                          <Eraser className="mr-1 h-3 w-3" />
                                        )}
                                        {removeBgLoading[imageId] ? "Removing..." : "Remove BG"}
                                      </Button>
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">No images generated for this recreation yet.</p>
                        )}
                        {hasCaption ? (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Caption</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{caption}</p>
                          </div>
                        ) : null}
                        {instagramResult ? (
                          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                            {instagramResult.permalink
                              ? "Posted to Instagram successfully."
                              : `Posted to Instagram (Media ID: ${instagramResult.mediaId}).`}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
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
