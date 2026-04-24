"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, Copy, ExternalLink, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DEFAULT_REASONING_MODEL,
  REASONING_MODELS,
  isReasoningModel,
  type ReasoningModel,
} from "@/lib/reasoning-model";

type ImageSlideAssetPrompt = {
  prompt: string;
  description: string;
};

type ImageSlidePlan = {
  headline: string;
  supportingText: string;
  assetPrompts: ImageSlideAssetPrompt[];
};

type ScriptVersion = {
  id: string;
  label: string;
  adaptationMode: "app_context" | "variant_only";
  script: string;
  slidePlans: ImageSlidePlan[];
};

type SavedPostResponse = {
  id: string;
  title: string | null;
  original_url: string;
  media_urls: string[];
  thumbnail_url: string | null;
  post_type: string;
  platform: string;
  error?: string;
};

type RecreateScriptResponse = {
  versions?: unknown;
  isIslamic?: boolean;
  isPregnancyOrPeriodRelated?: boolean;
  canIncorporateAppContext?: boolean;
  canReframeToIslamicAppContext?: boolean;
  canRecreate?: boolean;
  relevanceReason?: string;
  relevanceConfidence?: number;
  error?: string;
};

type ParsedScriptSlide = {
  slideNumber: number;
  headline: string;
  supporting: string;
  body: string;
};

type GeneratedVersion = {
  id: string;
  label: string;
  adaptationMode: "app_context" | "variant_only";
  script: string;
  slides: ParsedScriptSlide[];
  chatGptImagePrompts: string[];
};

type RelevanceState = {
  canRecreate: boolean;
  isIslamic: boolean;
  isPregnancyOrPeriodRelated: boolean;
  canIncorporateAppContext: boolean;
  canReframeToIslamicAppContext: boolean;
  reason: string;
  confidence: number;
} | null;

function sanitizeScriptVersions(payload: unknown): ScriptVersion[] {
  if (!Array.isArray(payload)) return [];

  return payload
    .map((item): ScriptVersion | null => {
      if (typeof item !== "object" || item === null) return null;
      const row = item as Record<string, unknown>;

      const script = typeof row.script === "string" ? row.script : "";
      if (!script.trim()) return null;

      const adaptationMode =
        row.adaptationMode === "app_context" || row.adaptationMode === "variant_only"
          ? row.adaptationMode
          : /Adaptation Mode\s*:\s*app_context/i.test(script)
            ? "app_context"
            : "variant_only";

      const slidePlans: ImageSlidePlan[] = Array.isArray(row.slidePlans)
        ? row.slidePlans
          .map((plan): ImageSlidePlan | null => {
            if (typeof plan !== "object" || plan === null) return null;
            const planRow = plan as Record<string, unknown>;
            const assetPrompts = Array.isArray(planRow.assetPrompts)
              ? planRow.assetPrompts
                .map((asset): ImageSlideAssetPrompt | null => {
                  if (typeof asset !== "object" || asset === null) return null;
                  const assetRow = asset as Record<string, unknown>;
                  return {
                    prompt: typeof assetRow.prompt === "string" ? assetRow.prompt.trim() : "",
                    description:
                      typeof assetRow.description === "string" ? assetRow.description.trim() : "",
                  };
                })
                .filter((asset): asset is ImageSlideAssetPrompt => Boolean(asset && asset.prompt))
              : [];

            return {
              headline: typeof planRow.headline === "string" ? planRow.headline.trim() : "",
              supportingText:
                typeof planRow.supportingText === "string" ? planRow.supportingText.trim() : "",
              assetPrompts,
            };
          })
          .filter((plan): plan is ImageSlidePlan => Boolean(plan))
        : [];

      return {
        id: typeof row.id === "string" && row.id.trim() ? row.id : adaptationMode,
        label:
          typeof row.label === "string" && row.label.trim()
            ? row.label
            : adaptationMode === "app_context"
              ? "App Context"
              : "Original Topic",
        adaptationMode,
        script,
        slidePlans,
      };
    })
    .filter((version): version is ScriptVersion => Boolean(version));
}

function parseScriptSlides(script: string): ParsedScriptSlide[] {
  const sections = script
    .replace(/\r/g, "")
    .match(/(?:^|\n)(Slide\s+\d+[\s\S]*?)(?=\nSlide\s+\d+|$)/gi);

  if (!sections) return [];

  return sections.map((section, index) => {
    const lines = section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    let headline = "";
    let supporting = "";
    const bodyLines: string[] = [];
    let bodyMode = false;

    for (const line of lines) {
      if (/^Slide\s+\d+/i.test(line)) continue;

      const headlineMatch = line.match(/^Headline\s*:\s*(.*)$/i);
      if (headlineMatch) {
        headline = headlineMatch[1]?.trim() || "";
        bodyMode = false;
        continue;
      }

      const supportingMatch = line.match(/^Supporting\s*:\s*(.*)$/i);
      if (supportingMatch) {
        supporting = supportingMatch[1]?.trim() || "";
        bodyMode = false;
        continue;
      }

      const bodyMatch = line.match(/^Body\s*:\s*(.*)$/i);
      if (bodyMatch) {
        const firstBodyLine = bodyMatch[1]?.trim() || "";
        if (firstBodyLine) bodyLines.push(firstBodyLine);
        bodyMode = true;
        continue;
      }

      if (bodyMode) {
        bodyLines.push(line);
      }
    }

    return {
      slideNumber: index + 1,
      headline,
      supporting,
      body: bodyLines.join("\n").trim(),
    };
  });
}

function buildChatGptSlidePrompt(
  slide: ParsedScriptSlide,
  slidePlan: ImageSlidePlan | undefined,
  totalSlides: number
): string {
  const scriptContext = [slide.headline, slide.supporting, slide.body]
    .filter((line) => line.trim().length > 0)
    .join(" | ");

  const visualContext = (slidePlan?.assetPrompts || [])
    .slice(0, 2)
    .map((asset) => asset.prompt.trim())
    .filter((prompt) => prompt.length > 0)
    .join(" ");

  return [
    `Create one Instagram carousel image for slide ${slide.slideNumber} of ${totalSlides}.`,
    scriptContext
      ? `Narrative reference from slide copy: ${scriptContext}.`
      : "Narrative reference: faith-sensitive Muslimah lifestyle educational context.",
    visualContext
      ? `Visual direction: ${visualContext}`
      : "Visual direction: candid UGC-style Muslimah lifestyle setting with natural lighting and emotional clarity.",
    "4:5 portrait composition, photorealistic, social-media-native framing.",
    "No text, no typography, no logos, no app UI screenshots, no watermarks.",
  ].join(" ");
}

function buildGeneratedVersion(version: ScriptVersion): GeneratedVersion {
  const slides = parseScriptSlides(version.script);
  const sourceSlides =
    slides.length > 0
      ? slides
      : version.slidePlans.map((plan, index) => ({
          slideNumber: index + 1,
          headline: plan.headline,
          supporting: plan.supportingText,
          body: "",
        }));

  const totalSlides = sourceSlides.length > 0 ? sourceSlides.length : Math.max(version.slidePlans.length, 1);
  const chatGptImagePrompts = sourceSlides.map((slide, index) =>
    buildChatGptSlidePrompt(slide, version.slidePlans[index], totalSlides)
  );

  return {
    id: version.id,
    label: version.label,
    adaptationMode: version.adaptationMode,
    script: version.script,
    slides: sourceSlides,
    chatGptImagePrompts,
  };
}

export function ImageSlideAgentView({ collectionId }: { collectionId: string }) {
  const router = useRouter();

  const [instagramUrl, setInstagramUrl] = useState("");
  const [reasoningModel, setReasoningModel] = useState<ReasoningModel>(DEFAULT_REASONING_MODEL);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savedPost, setSavedPost] = useState<SavedPostResponse | null>(null);
  const [relevance, setRelevance] = useState<RelevanceState>(null);
  const [versions, setVersions] = useState<GeneratedVersion[]>([]);

  const hasResult = useMemo(() => versions.length > 0, [versions]);

  const copyText = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setSuccess("Copied to clipboard.");
    } catch {
      setError("Failed to copy to clipboard.");
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    const cleanedUrl = instagramUrl.trim();
    if (!cleanedUrl) {
      setError("Please paste an Instagram post URL.");
      return;
    }

    if (!/instagram\.com/i.test(cleanedUrl)) {
      setError("This agent currently supports Instagram links only.");
      return;
    }

    setIsGenerating(true);
    setError("");
    setSuccess("");
    setStatusMessage("Saving Instagram post...");
    setSavedPost(null);
    setVersions([]);
    setRelevance(null);

    try {
      const saveResponse = await fetch("/api/posts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: cleanedUrl,
          collectionId,
          postType: "image_slides",
        }),
      });

      const saveData = (await saveResponse.json()) as SavedPostResponse;
      if (!saveResponse.ok) {
        throw new Error(saveData.error || "Failed to save Instagram post.");
      }

      const referenceImageUrls = Array.isArray(saveData.media_urls)
        ? saveData.media_urls
        : saveData.thumbnail_url
          ? [saveData.thumbnail_url]
          : [];

      if (referenceImageUrls.length === 0) {
        throw new Error("No images were extracted from the saved post.");
      }

      setSavedPost(saveData);
      setStatusMessage("Classifying niche and generating scripts...");

      const scriptResponse = await fetch("/api/recreate/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: saveData.id,
          collectionId,
          referenceImageUrls,
          includeHookStrategy: false,
          visualVariantPreference: "ugc_real",
          reasoningModel,
        }),
      });

      const scriptData = (await scriptResponse.json()) as RecreateScriptResponse;
      if (!scriptResponse.ok) {
        throw new Error(scriptData.error || "Failed to classify and generate scripts.");
      }

      setRelevance({
        canRecreate: Boolean(scriptData.canRecreate),
        isIslamic: Boolean(scriptData.isIslamic),
        isPregnancyOrPeriodRelated: Boolean(scriptData.isPregnancyOrPeriodRelated),
        canIncorporateAppContext: Boolean(scriptData.canIncorporateAppContext),
        canReframeToIslamicAppContext: Boolean(scriptData.canReframeToIslamicAppContext),
        reason: typeof scriptData.relevanceReason === "string" ? scriptData.relevanceReason : "",
        confidence: typeof scriptData.relevanceConfidence === "number" ? scriptData.relevanceConfidence : 0,
      });

      const sanitizedVersions = sanitizeScriptVersions(scriptData.versions);
      if (!Boolean(scriptData.canRecreate) || sanitizedVersions.length === 0) {
        throw new Error(
          scriptData.relevanceReason ||
            "This post is not eligible for recreation in the current niche rules."
        );
      }

      const generatedVersions = sanitizedVersions.map((version) => buildGeneratedVersion(version));
      setVersions(generatedVersions);
      setSuccess(
        `Done. Generated ${generatedVersions.length} script version${generatedVersions.length > 1 ? "s" : ""} with per-slide ChatGPT image prompts.`
      );
      setStatusMessage("Generation complete.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run image slide agent flow.");
      setStatusMessage("");
    } finally {
      setIsGenerating(false);
    }
  }, [instagramUrl, collectionId, reasoningModel]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/collections/${collectionId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to collection
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Image Slides Agent</CardTitle>
            <CardDescription>
              Paste an Instagram post link. The agent runs save -&gt; classify -&gt; script generation,
              then returns ChatGPT-ready image prompts for every slide.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Instagram Post URL</label>
                <input
                  type="url"
                  value={instagramUrl}
                  onChange={(event) => setInstagramUrl(event.target.value)}
                  placeholder="https://www.instagram.com/p/..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reasoning model</label>
                <select
                  value={reasoningModel}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (isReasoningModel(value)) setReasoningModel(value);
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                >
                  {REASONING_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void handleGenerate()} isLoading={isGenerating}>
                <Sparkles className="mr-2 h-4 w-4" />
                {isGenerating ? "Running Flow..." : "Save + Classify + Generate"}
              </Button>

              {savedPost ? (
                <Button
                  variant="outline"
                  onClick={() => router.push(`/collections/${collectionId}/posts/${savedPost.id}`)}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open Saved Post
                </Button>
              ) : null}
            </div>

            {statusMessage ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{statusMessage}</p>
            ) : null}

            {error ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            {success ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p> : null}

            {savedPost ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <p className="font-semibold text-slate-800">Saved Post</p>
                <p className="mt-0.5">{savedPost.title || savedPost.original_url}</p>
                <p className="mt-0.5 text-slate-500">
                  {savedPost.platform} · {savedPost.post_type} · {savedPost.media_urls?.length || 0} extracted image(s)
                </p>
              </div>
            ) : null}

            {relevance ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <p className="font-semibold text-slate-800">Classification</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge variant="default">isIslamic: {String(relevance.isIslamic)}</Badge>
                  <Badge variant="default">period/pregnancy: {String(relevance.isPregnancyOrPeriodRelated)}</Badge>
                  <Badge variant="default">canRecreate: {String(relevance.canRecreate)}</Badge>
                </div>
                {relevance.reason ? (
                  <p className="mt-1.5 text-slate-600">
                    {relevance.reason}
                    {relevance.confidence > 0 ? ` (${Math.round(relevance.confidence * 100)}% confidence)` : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {hasResult
          ? versions.map((version) => (
            <Card key={version.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{version.label}</CardTitle>
                    <CardDescription>
                      {version.adaptationMode === "app_context" ? "app_context" : "variant_only"} · {version.slides.length} slides
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => void copyText(version.script)}>
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Copy Script
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void copyText(
                          version.chatGptImagePrompts
                            .map((prompt, index) => `Slide ${index + 1}\n${prompt}`)
                            .join("\n\n")
                        )
                      }
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Copy All Prompts
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Script</p>
                  <pre className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{version.script}</pre>
                </div>

                {version.slides.map((slide, index) => (
                  <div key={`${version.id}-slide-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-sm font-semibold text-slate-800">Slide {slide.slideNumber}</p>
                    {slide.headline ? (
                      <p className="mt-1 text-sm text-slate-700">
                        <span className="font-semibold text-slate-500">Headline:</span> {slide.headline}
                      </p>
                    ) : null}
                    {slide.supporting ? (
                      <p className="mt-0.5 text-sm text-slate-700">
                        <span className="font-semibold text-slate-500">Supporting:</span> {slide.supporting}
                      </p>
                    ) : null}
                    {slide.body ? (
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">
                        <span className="font-semibold text-slate-500">Body:</span> {slide.body}
                      </p>
                    ) : null}

                    <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ChatGPT Image Prompt</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void copyText(version.chatGptImagePrompts[index] || "")}
                        >
                          <Copy className="mr-1.5 h-3.5 w-3.5" />
                          Copy
                        </Button>
                      </div>
                      <p className="mt-1 text-xs text-slate-700">{version.chatGptImagePrompts[index] || "Prompt unavailable."}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))
          : null}
      </div>
    </div>
  );
}
