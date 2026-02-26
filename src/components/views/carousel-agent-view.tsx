"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type CarouselSlide = {
  slideNumber: number;
  role: "primary_hook" | "secondary_hook" | "insight" | "action" | "proof" | "cta";
  density: "dense" | "light";
  overlayTitle: string;
  overlayLines: string[];
  headline: string;
  bodyBullets: string[];
  voiceScript: string;
  hookPurpose: string;
  capsWords: string[];
  visualDirection: string;
  imagePrompt: string;
  altText: string;
  imageUrl?: string;
};

type CarouselPack = {
  topic: string;
  angleRationale: string;
  caption: string;
  cta: string;
  hashtags: string[];
  strategyChecklist: string[];
  spinOffAngles: string[];
  slides: CarouselSlide[];
};

type CarouselAgentResponse = {
  generationId?: string;
  model: string;
  imageModel: string;
  generatedImages: boolean;
  pack: CarouselPack;
  error?: string;
};

type CarouselHistoryEntry = {
  generationId: string;
  createdAt: string;
  model: string;
  imageModel: string;
  generatedImages: boolean;
  pack: CarouselPack;
};

type CarouselHistoryResponse = {
  generations?: CarouselHistoryEntry[];
  error?: string;
};

function truncateWords(text: string, maxWords: number): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length <= maxWords) return tokens.join(" ");
  return tokens.slice(0, maxWords).join(" ");
}

function sanitizePromptPreviewLine(value: string, maxWords: number, maxChars: number): string {
  const cleaned = value
    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return truncateWords(cleaned, maxWords).slice(0, maxChars).trim();
}

function deriveBodyLinesFromVoiceScriptPreview(
  voiceScript: string,
  { maxLines = 2, maxWordsPerLine = 11 }: { maxLines?: number; maxWordsPerLine?: number } = {}
): string[] {
  const normalized = voiceScript
    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[•|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return [];

  const sentenceChunks = normalized
    .split(/[.!?;:]+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  const source = sentenceChunks.length > 0 ? sentenceChunks : [normalized];
  const lines: string[] = [];

  for (const chunk of source) {
    const line = sanitizePromptPreviewLine(chunk, maxWordsPerLine, 56);
    if (!line) continue;
    lines.push(line);
    if (lines.length >= maxLines) break;
  }

  return lines;
}

function buildInImageTextSpecPreview(slide: CarouselSlide): { title: string; bodyLines: string[] } {
  const title =
    sanitizePromptPreviewLine(slide.overlayTitle || slide.headline || `Slide ${slide.slideNumber}`, 7, 46) ||
    `Slide ${slide.slideNumber}`;

  const voiceDerived = deriveBodyLinesFromVoiceScriptPreview(slide.voiceScript, {
    maxLines: 2,
    maxWordsPerLine: 11,
  });

  const fallback = [...slide.bodyBullets, ...slide.overlayLines]
    .map((line) => sanitizePromptPreviewLine(line, 11, 56))
    .filter((line) => line.length > 0)
    .slice(0, 2);

  return {
    title,
    bodyLines: (voiceDerived.length > 0 ? voiceDerived : fallback).slice(0, 2),
  };
}

function buildImagePromptPreview(slide: CarouselSlide, topic: string, totalSlides: number): string {
  const textSpec = buildInImageTextSpecPreview(slide);
  const bodyLines = textSpec.bodyLines.length > 0 ? textSpec.bodyLines : ["Simple practical steps"];

  return `Create a fully finished Instagram carousel slide image (${slide.slideNumber}/${totalSlides}) for Muslimah Pro.

TOPIC: ${topic}
ROLE: ${slide.role}
DENSITY: ${slide.density}

EXACT TEXT TO RENDER (ENGLISH ONLY):
- TITLE: ${textSpec.title}
${bodyLines.map((line, index) => `- BODY ${index + 1}: ${line}`).join("\n")}

TEXT BOX SPEC (MANDATORY):
- Place ALL text inside one rounded text panel in the top portion of the image.
- Text panel bounds: top 8% to bottom 40% of image height.
- Keep at least 8% left/right margins and 6% top margin.

TEXT QUALITY + LAYOUT RULES:
- Text must be sharp, legible, and correctly spelled.
- Keep full title + body lines visible; no clipping, no crop, no overlap with subject.

Slide direction:
${slide.visualDirection}

Additional guidance:
${slide.imagePrompt}`;
}

export function CarouselAgentView({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const { activeCollection } = useAppStore();

  const [focus, setFocus] = useState("");
  const [reasoningModel, setReasoningModel] = useState(DEFAULT_REASONING_MODEL);
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_GENERATION_MODEL);
  const [result, setResult] = useState<CarouselAgentResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingSlideByNumber, setGeneratingSlideByNumber] = useState<Record<number, boolean>>({});
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [history, setHistory] = useState<CarouselHistoryEntry[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const geminiImageModels = useMemo(
    () => IMAGE_GENERATION_MODELS.filter((model) => model.id.startsWith("gemini-")),
    []
  );

  const loadHistory = useCallback(async (hydrateLatest: boolean = true) => {
    setIsLoadingHistory(true);

    try {
      const response = await fetch(`/api/carousel-agent/history?collectionId=${encodeURIComponent(collectionId)}`, {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json()) as CarouselHistoryResponse;

      if (!response.ok) {
        throw new Error(data.error || "Failed to load saved carousel packs.");
      }

      const generations = Array.isArray(data.generations) ? data.generations : [];
      setHistory(generations);

      if (hydrateLatest && generations.length > 0) {
        const latest = generations[0];
        if (isReasoningModel(latest.model)) {
          setReasoningModel(latest.model);
        }
        if (isImageGenerationModel(latest.imageModel)) {
          setImageModel(latest.imageModel);
        }
        setResult({
          generationId: latest.generationId,
          model: latest.model,
          imageModel: latest.imageModel,
          generatedImages: latest.generatedImages,
          pack: latest.pack,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load saved carousel packs.");
    } finally {
      setIsLoadingHistory(false);
    }
  }, [collectionId]);

  useEffect(() => {
    void loadHistory(true);
  }, [loadHistory]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGeneratingSlideByNumber({});
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/carousel-agent/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          focus: focus.trim(),
          reasoningModel,
          imageGenerationModel: imageModel,
        }),
      });

      const data = (await response.json()) as CarouselAgentResponse;

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate carousel pack.");
      }

      if (isReasoningModel(data.model)) {
        setReasoningModel(data.model);
      }

      if (isImageGenerationModel(data.imageModel)) {
        setImageModel(data.imageModel);
      }

      setResult(data);
      setHistory((prev) => {
        const nextEntry: CarouselHistoryEntry = {
          generationId: data.generationId || `${Date.now()}`,
          createdAt: new Date().toISOString(),
          model: data.model,
          imageModel: data.imageModel,
          generatedImages: data.generatedImages,
          pack: data.pack,
        };
        const existing = prev.filter((entry) => entry.generationId !== nextEntry.generationId);
        return [nextEntry, ...existing].slice(0, 12);
      });
      setSuccess(
        `Generated ${data.pack.slides.length} slide prompts and saved pack${data.generationId ? ` (${data.generationId.slice(0, 8)})` : ""}.`
      );

      void loadHistory(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Carousel generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateSlideImage = async (slideNumber: number) => {
    if (!result?.generationId) {
      setError("This pack has no saved generation ID yet. Regenerate the pack first.");
      return;
    }

    setGeneratingSlideByNumber((prev) => ({ ...prev, [slideNumber]: true }));
    setError("");

    try {
      const response = await fetch("/api/carousel-agent/generate-slide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          generationId: result.generationId,
          slideNumber,
          imageGenerationModel: imageModel,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        generationId?: string;
        slideNumber?: number;
        imageUrl?: string;
        imageModel?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `Failed to generate image for slide ${slideNumber}.`);
      }

      if (isImageGenerationModel(data.imageModel)) {
        setImageModel(data.imageModel);
      }

      const nextImageUrl = typeof data.imageUrl === "string" ? data.imageUrl : "";
      const nextGenerationId = data.generationId || result.generationId;

      setResult((prev) => {
        if (!prev) return prev;

        const slides = prev.pack.slides.map((slide) =>
          slide.slideNumber === slideNumber ? { ...slide, imageUrl: nextImageUrl || slide.imageUrl } : slide
        );

        return {
          ...prev,
          generationId: nextGenerationId,
          generatedImages: slides.some((slide) => Boolean(slide.imageUrl)),
          pack: {
            ...prev.pack,
            slides,
          },
        };
      });

      setHistory((prev) =>
        prev.map((entry) => {
          if (entry.generationId !== nextGenerationId) return entry;

          const slides = entry.pack.slides.map((slide) =>
            slide.slideNumber === slideNumber ? { ...slide, imageUrl: nextImageUrl || slide.imageUrl } : slide
          );

          return {
            ...entry,
            generatedImages: slides.some((slide) => Boolean(slide.imageUrl)),
            imageModel: isImageGenerationModel(data.imageModel) ? data.imageModel : entry.imageModel,
            pack: {
              ...entry.pack,
              slides,
            },
          };
        })
      );

      setSuccess(`Generated image for slide ${slideNumber}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to generate image for slide ${slideNumber}.`);
    } finally {
      setGeneratingSlideByNumber((prev) => ({ ...prev, [slideNumber]: false }));
    }
  };

  const fullScript = useMemo(() => {
    if (!result?.pack?.slides?.length) return "";

    return result.pack.slides
      .map((slide) => {
        const bullets = slide.bodyBullets.length > 0
          ? slide.bodyBullets.map((bullet) => `- ${bullet}`).join("\n")
          : "";
        return `Slide ${slide.slideNumber}: ${slide.headline}\n${bullets}\n${slide.voiceScript}`.trim();
      })
      .join("\n\n");
  }, [result]);

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
              <CardTitle className="text-base">Carousel Agent</CardTitle>
              <CardDescription>
                Hook-first carousel generator for Muslimah Pro. Includes script + image prompts with English-only text rules.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
                <StatusRow label="1. Trend angle selected" done={Boolean(result?.pack.topic)} />
                <StatusRow label="2. Script + prompts generated" done={Boolean(result?.pack.slides.length)} />
                <StatusRow
                  label="3. Slide visuals rendered"
                  done={Boolean(result?.pack.slides.some((slide) => Boolean(slide.imageUrl)))}
                />
              </CardContent>
            </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>
                <span className="font-medium text-slate-800">App:</span>{" "}
                {activeCollection?.app_name || "Muslimah Pro"}
              </p>
              <p>
                The agent prioritizes Islam + women + period/pregnancy/lifestyle angles and applies a high-retention hook strategy.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saved Carousel Packs</CardTitle>
              <CardDescription>Latest generated packs for this collection</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              {isLoadingHistory ? (
                <p>Loading saved packs...</p>
              ) : history.length === 0 ? (
                <p>No saved carousel packs yet.</p>
              ) : (
                history.slice(0, 5).map((entry) => (
                  <button
                    key={entry.generationId}
                    type="button"
                    onClick={() => {
                      setResult({
                        generationId: entry.generationId,
                        model: entry.model,
                        imageModel: entry.imageModel,
                        generatedImages: entry.generatedImages,
                        pack: entry.pack,
                      });
                      setSuccess(`Loaded saved pack (${entry.generationId.slice(0, 8)}).`);
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 transition hover:border-slate-300"
                  >
                    <p className="font-semibold text-slate-800">{entry.pack.topic || "Untitled topic"}</p>
                    <p className="mt-0.5 text-slate-500">
                      {entry.pack.slides.length} slides • {entry.generatedImages ? "images rendered" : "prompts only"}
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
              <CardTitle className="text-lg">Generate Carousel Pack</CardTitle>
              <CardDescription>
                Generates topic angle + concise on-image text in a fixed hyperrealistic carousel style.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-800">Focus (optional)</label>
                <textarea
                  value={focus}
                  onChange={(event) => setFocus(event.target.value)}
                  rows={3}
                  placeholder="Optional direction, e.g. Ramadan period care, first-trimester fatigue, worship planning"
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
                  {isGenerating ? "Building carousel pack..." : "Generate Carousel Pack"}
                </Button>

                {fullScript ? (
                  <Button variant="outline" onClick={() => navigator.clipboard.writeText(fullScript)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Full Script
                  </Button>
                ) : null}
              </div>

              <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                First generate the full strategy + prompts, then render each slide image individually for tighter quality control.
              </p>

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
                  <CardTitle className="text-base">Strategy Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-700">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Topic</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">{result.pack.topic}</p>
                    <p className="mt-1 text-sm text-slate-600">{result.pack.angleRationale}</p>
                  </div>

                  <InfoBlock title="Checklist" items={result.pack.strategyChecklist} />
                  <InfoBlock title="Spin-Off Angles" items={result.pack.spinOffAngles} />

                  <div className="grid gap-3 md:grid-cols-2">
                    <MetaCard label="Caption" value={result.pack.caption} />
                    <MetaCard label="CTA" value={result.pack.cta} />
                  </div>

                  {result.pack.hashtags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {result.pack.hashtags.map((tag) => (
                        <Badge key={tag} variant="default">#{tag.replace(/^#/, "")}</Badge>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Slides</CardTitle>
                  <CardDescription>
                    Script + detailed image prompts for every carousel slide.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {result.pack.slides.map((slide) => (
                    <div key={slide.slideNumber} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="default">Slide {slide.slideNumber}</Badge>
                        <Badge variant={slide.role.includes("hook") ? "success" : "default"}>{slide.role}</Badge>
                        <Badge variant="default">{slide.density}</Badge>
                        {slide.capsWords.length > 0 ? (
                          <Badge variant="default">CAPS: {slide.capsWords.join(", ")}</Badge>
                        ) : null}
                      </div>

                      <h3 className="text-base font-semibold text-slate-900">{slide.overlayTitle || slide.headline}</h3>

                      {slide.overlayLines.length > 0 ? (
                        <ul className="mt-2 space-y-1 text-sm text-slate-700">
                          {slide.overlayLines.map((line, index) => (
                            <li key={index}>• {line}</li>
                          ))}
                        </ul>
                      ) : null}

                      {slide.bodyBullets.length > 0 ? (
                        <ul className="mt-2 space-y-1 text-sm text-slate-700">
                          {slide.bodyBullets.map((bullet, index) => (
                            <li key={index}>• {bullet}</li>
                          ))}
                        </ul>
                      ) : null}

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <MetaCard label="Voice Script" value={slide.voiceScript} />
                        <MetaCard
                          label="Image Prompt"
                          value={buildImagePromptPreview(slide, result.pack.topic, result.pack.slides.length)}
                        />
                      </div>

                      <p className="mt-2 text-xs text-slate-500">Hook purpose: {slide.hookPurpose}</p>
                      <p className="mt-1 text-xs text-slate-500">Visual direction: {slide.visualDirection}</p>

                      {slide.imageUrl ? (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <div
                            className="h-52 w-full rounded-md bg-cover bg-center"
                            style={{ backgroundImage: `url(${slide.imageUrl})` }}
                            role="img"
                            aria-label={slide.altText}
                          />
                          <a
                            href={slide.imageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-500"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open image
                          </a>
                          <div className="mt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              isLoading={Boolean(generatingSlideByNumber[slide.slideNumber])}
                              onClick={() => {
                                void handleGenerateSlideImage(slide.slideNumber);
                              }}
                            >
                              <Sparkles className="mr-2 h-3.5 w-3.5" />
                              Regenerate this slide image
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                          <div className="mb-2 flex items-center gap-2">
                            <ImageIcon className="h-4 w-4" />
                            No image rendered yet for this slide.
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            isLoading={Boolean(generatingSlideByNumber[slide.slideNumber])}
                            onClick={() => {
                              void handleGenerateSlideImage(slide.slideNumber);
                            }}
                          >
                            <Sparkles className="mr-2 h-3.5 w-3.5" />
                            Generate this slide image
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
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
