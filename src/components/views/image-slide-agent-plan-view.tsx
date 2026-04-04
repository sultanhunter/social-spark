"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  IMAGE_GENERATION_MODELS,
  isImageGenerationModel,
  type ImageGenerationModel,
} from "@/lib/image-generation-model";

type ImageSlideDesignAssetPrompt = {
  prompt: string;
  description: string;
};

type ImageSlideDesignPlan = {
  headline: string;
  supportingText: string;
  figmaInstructions: string[];
  assetPrompts: ImageSlideDesignAssetPrompt[];
};

type GeneratedImageAssetEntry = {
  slideIndex: number;
  assetIndex: number;
  imageUrl: string;
  prompt: string;
  description: string;
  imageModel: string;
  generatedAt: string;
};

type ImageSlidePlanDetail = {
  id: string;
  planNumber: number;
  campaignType: string;
  topicBrief?: string;
  slideCount: number;
  reasoningModel?: string;
  characterId?: string;
  characterName?: string;
  script: string;
  slidePlans: ImageSlideDesignPlan[];
  generatedAssets: GeneratedImageAssetEntry[];
  createdAt: string;
  updatedAt: string;
};

type ImageSlidePlanDetailResponse = {
  plan?: ImageSlidePlanDetail;
  error?: string;
};

type GenerateAssetResponse = {
  imageUrl?: string;
  imageGenerationModel?: string;
  generatedAssets?: GeneratedImageAssetEntry[];
  error?: string;
};

function assetKey(slideIndex: number, assetIndex: number): string {
  return `${slideIndex}-${assetIndex}`;
}

export function ImageSlideAgentPlanView({
  collectionId,
  planId,
}: {
  collectionId: string;
  planId: string;
}) {
  const router = useRouter();

  const [plan, setPlan] = useState<ImageSlidePlanDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingByAssetKey, setIsGeneratingByAssetKey] = useState<Record<string, boolean>>({});
  const [imageGenerationModel, setImageGenerationModel] = useState<ImageGenerationModel>(DEFAULT_IMAGE_GENERATION_MODEL);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const generatedAssetMap = useMemo(() => {
    const map = new Map<string, GeneratedImageAssetEntry>();
    for (const asset of plan?.generatedAssets || []) {
      map.set(assetKey(asset.slideIndex, asset.assetIndex), asset);
    }
    return map;
  }, [plan]);

  const loadPlan = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/image-slide-agent?collectionId=${encodeURIComponent(collectionId)}&planId=${encodeURIComponent(planId)}`,
        { method: "GET", cache: "no-store" }
      );
      const data = (await response.json()) as ImageSlidePlanDetailResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to load image-slide plan details.");
      }
      if (!data.plan) {
        throw new Error("Image-slide plan was not returned.");
      }
      setPlan(data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load image-slide plan details.");
    } finally {
      setIsLoading(false);
    }
  }, [collectionId, planId]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  const handleGenerateAsset = useCallback(async (slideIndex: number, assetIndex: number) => {
    const key = assetKey(slideIndex, assetIndex);
    setIsGeneratingByAssetKey((prev) => ({ ...prev, [key]: true }));
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/image-slide-agent/generate-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          planId,
          slideIndex,
          assetIndex,
          imageGenerationModel,
        }),
      });

      const data = (await response.json()) as GenerateAssetResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate image asset.");
      }

      if (isImageGenerationModel(data.imageGenerationModel)) {
        setImageGenerationModel(data.imageGenerationModel);
      }

      setPlan((current) => {
        if (!current) return current;
        return {
          ...current,
          generatedAssets: Array.isArray(data.generatedAssets) ? data.generatedAssets : current.generatedAssets,
        };
      });
      setSuccess(`Generated image for slide ${slideIndex + 1}, asset ${assetIndex + 1}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate image asset.");
    } finally {
      setIsGeneratingByAssetKey((prev) => ({ ...prev, [key]: false }));
    }
  }, [collectionId, planId, imageGenerationModel]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/collections/${collectionId}/image-slide-agent`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Image Slides Agent
          </Button>
          <Button variant="outline" size="sm" onClick={() => void loadPlan()} isLoading={isLoading}>
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Image Slide Plan Details</CardTitle>
            <CardDescription>Open one saved plan, review script and generate individual image assets.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {plan ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="default">Plan {plan.planNumber}</Badge>
                  <Badge variant="default">{plan.campaignType.replace(/_/g, " ")}</Badge>
                  <Badge variant="default">{plan.slideCount} slides</Badge>
                  {plan.characterName ? <Badge variant="default">{plan.characterName}</Badge> : null}
                </div>
                <p className="text-xs text-slate-500">Created: {new Date(plan.createdAt).toLocaleString()}</p>
                {plan.topicBrief ? (
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{plan.topicBrief}</p>
                ) : null}
                <div className="max-w-xs space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Image Model</label>
                  <select
                    value={imageGenerationModel}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (isImageGenerationModel(value)) setImageGenerationModel(value);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                  >
                    {IMAGE_GENERATION_MODELS.map((model) => (
                      <option key={model.id} value={model.id}>{model.label}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-600">{isLoading ? "Loading plan..." : "No plan loaded yet."}</p>
            )}

            {error ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            {success ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p> : null}
          </CardContent>
        </Card>

        {plan ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Script</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{plan.script}</pre>
            </CardContent>
          </Card>
        ) : null}

        {plan?.slidePlans?.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Slides + Asset Generation</CardTitle>
              <CardDescription>Generate each image asset directly from its prompt.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {plan.slidePlans.map((slide, slideIndex) => (
                <div key={`detail-slide-${slideIndex}`} className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-sm font-semibold text-slate-800">Slide {slideIndex + 1}</p>
                  {slide.headline ? <p className="mt-1 text-sm text-slate-700"><span className="font-semibold text-slate-500">Headline:</span> {slide.headline}</p> : null}
                  {slide.supportingText ? <p className="mt-0.5 text-sm text-slate-700"><span className="font-semibold text-slate-500">Supporting:</span> {slide.supportingText}</p> : null}

                  {slide.figmaInstructions.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Figma Instructions</p>
                      <ol className="mt-1 list-inside list-decimal space-y-0.5">
                        {slide.figmaInstructions.map((step, index) => (
                          <li key={`detail-step-${slideIndex}-${index}`} className="text-sm text-slate-600">{step}</li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  {slide.assetPrompts.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Asset Prompts</p>
                      {slide.assetPrompts.map((asset, assetIndex) => {
                        const key = assetKey(slideIndex, assetIndex);
                        const generated = generatedAssetMap.get(key) || null;
                        return (
                          <div key={`detail-asset-${slideIndex}-${assetIndex}`} className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2">
                            <p className="text-xs font-semibold text-slate-700">{asset.description || `Asset ${assetIndex + 1}`}</p>
                            <p className="mt-0.5 text-xs text-slate-600">{asset.prompt}</p>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                isLoading={Boolean(isGeneratingByAssetKey[key])}
                                onClick={() => void handleGenerateAsset(slideIndex, assetIndex)}
                              >
                                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                                {generated ? "Regenerate" : "Generate Image"}
                              </Button>

                              {generated ? (
                                <>
                                  <Badge variant="default">{generated.imageModel}</Badge>
                                  <a
                                    href={generated.imageUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-500"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Open image
                                  </a>
                                </>
                              ) : null}
                            </div>

                            {generated ? (
                              <div className="mt-2 rounded border border-slate-200 bg-white p-2">
                                <div
                                  className="h-44 w-full rounded bg-cover bg-center"
                                  style={{ backgroundImage: `url(${generated.imageUrl})` }}
                                  role="img"
                                  aria-label={asset.description || `Slide ${slideIndex + 1} asset ${assetIndex + 1}`}
                                />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
