"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  ListChecks,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/store/app-store";
import {
  DEFAULT_REASONING_MODEL,
  REASONING_MODELS,
  isReasoningModel,
} from "@/lib/reasoning-model";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  IMAGE_GENERATION_MODELS,
  isImageGenerationModel,
} from "@/lib/image-generation-model";

type PinterestPinSection = {
  heading: string;
  points: string[];
  visualHint: string;
};

type PinterestPinScript = {
  targetAudience: string;
  objective: string;
  headline: string;
  supportingLine: string;
  valueProps: string[];
  sections: PinterestPinSection[];
  cta: string;
  footerNote: string;
};

type PinterestPinPack = {
  topic: string;
  angleRationale: string;
  styleTheme: string;
  styleDirection: string;
  script: PinterestPinScript;
  imagePrompt: string;
  altText: string;
  imageUrl?: string;
};

type PinterestAgentResponse = {
  generationId?: string;
  model: string;
  imageModel: string;
  generatedImage: boolean;
  imageUrl?: string | null;
  pack: PinterestPinPack;
  error?: string;
};

type PinterestHistoryEntry = {
  generationId: string;
  createdAt: string;
  model: string;
  imageModel: string;
  generatedImage: boolean;
  imageUrl?: string;
  pack: PinterestPinPack;
};

type PinterestHistoryResponse = {
  generations?: PinterestHistoryEntry[];
  error?: string;
};

export function PinterestAgentView({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const { activeCollection } = useAppStore();

  const [focus, setFocus] = useState("");
  const [reasoningModel, setReasoningModel] = useState(DEFAULT_REASONING_MODEL);
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_GENERATION_MODEL);
  const [result, setResult] = useState<PinterestAgentResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [history, setHistory] = useState<PinterestHistoryEntry[]>([]);
  const [selectedGenerationId, setSelectedGenerationId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedGenerationIdRef = useRef<string | null>(null);

  const applySelectedEntry = useCallback((entry: PinterestHistoryEntry, announce = false) => {
    selectedGenerationIdRef.current = entry.generationId;
    setSelectedGenerationId(entry.generationId);

    if (isReasoningModel(entry.model)) {
      setReasoningModel(entry.model);
    }
    if (isImageGenerationModel(entry.imageModel)) {
      setImageModel(entry.imageModel);
    }

    setResult({
      generationId: entry.generationId,
      model: entry.model,
      imageModel: entry.imageModel,
      generatedImage: entry.generatedImage,
      imageUrl: entry.imageUrl,
      pack: {
        ...entry.pack,
        imageUrl: entry.imageUrl || entry.pack.imageUrl,
      },
    });

    if (announce) {
      setSuccess(`Loaded saved pin blueprint (${entry.generationId.slice(0, 8)}).`);
    }
  }, []);

  const geminiImageModels = useMemo(
    () => IMAGE_GENERATION_MODELS.filter((model) => model.id.startsWith("gemini-")),
    []
  );

  const loadHistory = useCallback(async (hydrateLatest: boolean = true) => {
    setIsLoadingHistory(true);

    try {
      const response = await fetch(`/api/pinterest-agent/history?collectionId=${encodeURIComponent(collectionId)}`, {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json()) as PinterestHistoryResponse;

      if (!response.ok) {
        throw new Error(data.error || "Failed to load saved Pinterest pin generations.");
      }

      const generations = Array.isArray(data.generations) ? data.generations : [];
      setHistory(generations);

      const preferredGenerationId = selectedGenerationIdRef.current;
      if (preferredGenerationId) {
        const selectedEntry = generations.find((entry) => entry.generationId === preferredGenerationId);
        if (selectedEntry) {
          applySelectedEntry(selectedEntry);
          return;
        }
      }

      if (hydrateLatest && generations.length > 0) {
        applySelectedEntry(generations[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Pinterest history.");
    } finally {
      setIsLoadingHistory(false);
    }
  }, [applySelectedEntry, collectionId]);

  useEffect(() => {
    void loadHistory(true);
  }, [loadHistory]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/pinterest-agent/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          focus: focus.trim(),
          reasoningModel,
          imageGenerationModel: imageModel,
        }),
      });

      const data = (await response.json()) as PinterestAgentResponse;

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate Pinterest blueprint.");
      }

      if (isReasoningModel(data.model)) {
        setReasoningModel(data.model);
      }

      if (isImageGenerationModel(data.imageModel)) {
        setImageModel(data.imageModel);
      }

      const nextGenerationId = data.generationId || `${Date.now()}`;
      selectedGenerationIdRef.current = nextGenerationId;
      setSelectedGenerationId(nextGenerationId);
      setResult({
        ...data,
        generationId: nextGenerationId,
      });

      setHistory((prev) => {
        const nextEntry: PinterestHistoryEntry = {
          generationId: nextGenerationId,
          createdAt: new Date().toISOString(),
          model: data.model,
          imageModel: data.imageModel,
          generatedImage: data.generatedImage,
          imageUrl: (data.imageUrl as string) || data.pack.imageUrl,
          pack: {
            ...data.pack,
            imageUrl: (data.imageUrl as string) || data.pack.imageUrl,
          },
        };
        const existing = prev.filter((entry) => entry.generationId !== nextEntry.generationId);
        return [nextEntry, ...existing].slice(0, 100);
      });

      setSuccess(
        `Generated script + detailed image prompt${data.generationId ? ` (${data.generationId.slice(0, 8)})` : ""}.`
      );

      void loadHistory(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pinterest generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!result?.generationId) {
      setError("This blueprint has no saved generation ID yet. Generate a pin blueprint first.");
      return;
    }

    setIsGeneratingImage(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/pinterest-agent/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          generationId: result.generationId,
          imageGenerationModel: imageModel,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        generationId?: string;
        imageUrl?: string;
        imageModel?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate Pinterest pin image.");
      }

      if (isImageGenerationModel(data.imageModel)) {
        setImageModel(data.imageModel);
      }

      const nextGenerationId = data.generationId || result.generationId;
      const imageUrl = typeof data.imageUrl === "string" ? data.imageUrl : "";

      selectedGenerationIdRef.current = nextGenerationId;
      setSelectedGenerationId(nextGenerationId);

      setResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          generationId: nextGenerationId,
          generatedImage: Boolean(imageUrl),
          imageUrl: imageUrl || prev.imageUrl,
          pack: {
            ...prev.pack,
            imageUrl: imageUrl || prev.pack.imageUrl,
          },
        };
      });

      setHistory((prev) =>
        prev.map((entry) => {
          if (entry.generationId !== nextGenerationId) return entry;

          return {
            ...entry,
            imageModel: isImageGenerationModel(data.imageModel) ? data.imageModel : entry.imageModel,
            generatedImage: Boolean(imageUrl),
            imageUrl: imageUrl || entry.imageUrl,
            pack: {
              ...entry.pack,
              imageUrl: imageUrl || entry.pack.imageUrl,
            },
          };
        })
      );

      setSuccess("Generated Pinterest pin image.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to render Pinterest pin image.");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const scriptPreview = useMemo(() => {
    if (!result?.pack) return "";
    const sectionLines = result.pack.script.sections
      .map((section, index) => {
        const points = section.points.map((point) => `- ${point}`).join("\n");
        return `${index + 1}. ${section.heading}\n${points}`;
      })
      .join("\n\n");

    return [
      `Topic: ${result.pack.topic}`,
      `Headline: ${result.pack.script.headline}`,
      `Supporting line: ${result.pack.script.supportingLine}`,
      `Objective: ${result.pack.script.objective}`,
      "",
      "Sections:",
      sectionLines,
      "",
      `CTA: ${result.pack.script.cta}`,
    ].join("\n");
  }, [result]);

  const imageUrl = result?.pack.imageUrl || result?.imageUrl || "";

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
              <CardTitle className="text-base">Pinterest Agent</CardTitle>
              <CardDescription>
                Script-first Pinterest infographic agent. It decides the pin script first, then builds a detailed image prompt.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <StatusRow label="1. Pin script decided" done={Boolean(result?.pack.script.headline)} />
              <StatusRow label="2. Detailed prompt generated" done={Boolean(result?.pack.imagePrompt)} />
              <StatusRow label="3. Pin image rendered" done={Boolean(imageUrl)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>
                <span className="font-medium text-slate-800">App:</span>{" "}
                {activeCollection?.app_name || "SocialSpark App"}
              </p>
              <p>
                This workflow is optimized for high-clarity, save-worthy infographic pins with strong on-image structure.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saved Pin Blueprints</CardTitle>
              <CardDescription>Latest generated Pinterest plans for this collection</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              {isLoadingHistory ? (
                <p>Loading saved blueprints...</p>
              ) : history.length === 0 ? (
                <p>No saved pin blueprints yet.</p>
              ) : (
                history.map((entry) => (
                  <button
                    key={entry.generationId}
                    type="button"
                    onClick={() => {
                      applySelectedEntry(entry, true);
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                      selectedGenerationId === entry.generationId
                        ? "border-rose-300 bg-rose-50 text-rose-700"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <p className={`font-semibold ${selectedGenerationId === entry.generationId ? "text-rose-800" : "text-slate-800"}`}>
                      {entry.pack.topic || "Untitled pin"}
                    </p>
                    <p className={`mt-0.5 ${selectedGenerationId === entry.generationId ? "text-rose-600" : "text-slate-500"}`}>
                      {entry.generatedImage ? "image rendered" : "prompt only"}
                    </p>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Generate Pinterest Pin Blueprint</CardTitle>
              <CardDescription>
                The agent first writes the infographic script (content blocks), then outputs a detailed generation prompt.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-800">Focus (optional)</label>
                <textarea
                  value={focus}
                  onChange={(event) => setFocus(event.target.value)}
                  rows={3}
                  placeholder="Optional direction, e.g. productivity checklist, onboarding tips, launch explainer"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-800">Reasoning Model</label>
                  <select
                    value={reasoningModel}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (isReasoningModel(value)) setReasoningModel(value);
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

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-800">Image Model</label>
                  <select
                    value={imageModel}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (isImageGenerationModel(value)) setImageModel(value);
                    }}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                  >
                    {geminiImageModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button variant="primary" onClick={handleGenerate} isLoading={isGenerating}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {isGenerating ? "Building pin blueprint..." : "Generate Pin Blueprint"}
                </Button>

                {scriptPreview ? (
                  <Button variant="outline" onClick={() => navigator.clipboard.writeText(scriptPreview)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Script
                  </Button>
                ) : null}
              </div>

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

          {result ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Pin Strategy</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-700">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Topic</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">{result.pack.topic}</p>
                    <p className="mt-1 text-sm text-slate-600">{result.pack.angleRationale}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="default">{result.pack.styleTheme}</Badge>
                      <Badge variant="default">{result.pack.script.targetAudience}</Badge>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <MetaCard label="Headline" value={result.pack.script.headline} />
                    <MetaCard label="Supporting Line" value={result.pack.script.supportingLine} />
                  </div>

                  <InfoBlock title="Value Props" items={result.pack.script.valueProps} />

                  <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sections</p>
                    {result.pack.script.sections.map((section, index) => (
                      <div key={`${section.heading}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-sm font-semibold text-slate-800">{index + 1}. {section.heading}</p>
                        <ul className="mt-1 space-y-1 text-sm text-slate-700">
                          {section.points.map((point, pointIndex) => (
                            <li key={`${section.heading}-${pointIndex}`}>• {point}</li>
                          ))}
                        </ul>
                        <p className="mt-1 text-xs text-slate-500">Visual hint: {section.visualHint}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <MetaCard label="CTA" value={result.pack.script.cta} />
                    <MetaCard label="Footer Note" value={result.pack.script.footerNote} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Detailed Image Prompt</CardTitle>
                  <CardDescription>
                    This prompt is generated after the script is finalized.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <MetaCard label="Style Direction" value={result.pack.styleDirection} />
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Image Prompt</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{result.pack.imagePrompt}</p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button variant="outline" onClick={() => navigator.clipboard.writeText(result.pack.imagePrompt)}>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy Prompt
                    </Button>

                    <Button variant="primary" onClick={handleGenerateImage} isLoading={isGeneratingImage}>
                      <Sparkles className="mr-2 h-4 w-4" />
                      {imageUrl ? "Regenerate Pin Image" : "Generate Pin Image"}
                    </Button>
                  </div>

                  {imageUrl ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <div
                        className="h-[460px] w-full rounded-md bg-cover bg-center"
                        style={{ backgroundImage: `url(${imageUrl})` }}
                        role="img"
                        aria-label={result.pack.altText}
                      />
                      <a
                        href={imageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-500"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open generated image
                      </a>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      <div className="mb-2 flex items-center gap-2">
                        <ImageIcon className="h-4 w-4" />
                        No pin image rendered yet.
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
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

function InfoBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">No items available.</p>
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

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{value}</p>
    </div>
  );
}
