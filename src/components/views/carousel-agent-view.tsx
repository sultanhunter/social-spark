"use client";

import { useMemo, useState } from "react";
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

export function CarouselAgentView({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const { activeCollection } = useAppStore();

  const [focus, setFocus] = useState("");
  const [reasoningModel, setReasoningModel] = useState(DEFAULT_REASONING_MODEL);
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_GENERATION_MODEL);
  const [generateImages, setGenerateImages] = useState(true);
  const [result, setResult] = useState<CarouselAgentResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const geminiImageModels = useMemo(
    () => IMAGE_GENERATION_MODELS.filter((model) => model.id.startsWith("gemini-")),
    []
  );

  const handleGenerate = async () => {
    setIsGenerating(true);
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
          generateImages,
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
      setSuccess(
        data.generatedImages
          ? `Generated ${data.pack.slides.length} slides and saved pack${data.generationId ? ` (${data.generationId.slice(0, 8)})` : ""}.`
          : `Generated ${data.pack.slides.length} slides and saved strategy${data.generationId ? ` (${data.generationId.slice(0, 8)})` : ""}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Carousel generation failed.");
    } finally {
      setIsGenerating(false);
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
              <StatusRow label="3. Slide visuals rendered" done={Boolean(result?.generatedImages)} />
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

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={generateImages}
                  onChange={(event) => setGenerateImages(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-rose-500 focus:ring-rose-400"
                />
                Render images now (can take longer)
              </label>

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
                English-only safeguard is enforced. Text is intentionally short per slide so in-image typography stays readable and less glitchy.
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
                        <MetaCard label="Image Prompt" value={slide.imagePrompt} />
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
                        </div>
                      ) : (
                        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                          <ImageIcon className="h-4 w-4" />
                          No rendered image (prompts only mode).
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
