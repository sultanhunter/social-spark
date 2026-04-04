"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, FileText, Sparkles, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/store/app-store";
import {
  DEFAULT_REASONING_MODEL,
  REASONING_MODELS,
  isReasoningModel,
  type ReasoningModel,
} from "@/lib/reasoning-model";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  IMAGE_GENERATION_MODELS,
  isImageGenerationModel,
  type ImageGenerationModel,
} from "@/lib/image-generation-model";

type ImageSlideCampaignType = "widget_shock_hook_ugc";

type ImageSlideCampaignOption = {
  id: ImageSlideCampaignType;
  label: string;
  description: string;
};

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

type ImageSlideSavedPlanSummary = {
  id: string;
  planNumber: number;
  campaignType: string;
  topicBrief?: string;
  slideCount: number;
  reasoningModel?: string;
  characterId?: string;
  characterName?: string;
  scriptPreview?: string;
  slidePlanCount?: number | null;
  createdAt: string;
  updatedAt: string;
};

type ImageSlideMetaResponse = {
  campaigns?: ImageSlideCampaignOption[];
  savedPlans?: ImageSlideSavedPlanSummary[];
  warning?: string;
  error?: string;
};

type ImageSlideAgentResponse = {
  campaignType?: string;
  script?: string;
  slidePlans?: ImageSlideDesignPlan[];
  meta?: {
    topicBrief?: string;
    reasoningModel?: string;
    slideCount?: number;
    characterId?: string;
    characterName?: string;
  };
  saved?: {
    id?: string;
    planNumber?: number;
    createdAt?: string;
  };
  error?: string;
};

type UgcCharacter = {
  id: string;
  characterName: string;
  personaSummary: string;
  characterType?: "ugc" | "animated";
  isDefault?: boolean;
};

type CharacterResponse = {
  characters?: UgcCharacter[];
  character?: UgcCharacter | null;
  error?: string;
};

export function ImageSlideAgentView({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const { activeCollection } = useAppStore();

  const [reasoningModel, setReasoningModel] = useState<ReasoningModel>(DEFAULT_REASONING_MODEL);
  const [imageGenerationModel, setImageGenerationModel] = useState<ImageGenerationModel>(DEFAULT_IMAGE_GENERATION_MODEL);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [latestGeneratedPlanId, setLatestGeneratedPlanId] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<ImageSlideCampaignOption[]>([]);
  const [savedPlans, setSavedPlans] = useState<ImageSlideSavedPlanSummary[]>([]);
  const [ugcCharacters, setUgcCharacters] = useState<UgcCharacter[]>([]);

  const [campaignType, setCampaignType] = useState<ImageSlideCampaignType>("widget_shock_hook_ugc");
  const [characterId, setCharacterId] = useState<string>("auto");
  const [slideCount, setSlideCount] = useState<number>(6);
  const [topicBrief, setTopicBrief] = useState("");

  const [script, setScript] = useState("");
  const [slidePlans, setSlidePlans] = useState<ImageSlideDesignPlan[]>([]);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedUgcCharacter = useMemo(
    () => ugcCharacters.find((character) => character.id === characterId) || null,
    [ugcCharacters, characterId]
  );

  const loadMeta = useCallback(async () => {
    setIsLoadingMeta(true);
    try {
      const response = await fetch(
        `/api/image-slide-agent?collectionId=${encodeURIComponent(collectionId)}&limit=30`,
        { method: "GET", cache: "no-store" }
      );
      const data = (await response.json()) as ImageSlideMetaResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to load image-slide metadata.");
      }

      const nextCampaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
      const nextSavedPlans = Array.isArray(data.savedPlans) ? data.savedPlans : [];
      setCampaigns(nextCampaigns);
      setSavedPlans(nextSavedPlans);

      setCampaignType((current) => {
        if (nextCampaigns.some((item) => item.id === current)) return current;
        return nextCampaigns[0]?.id || "widget_shock_hook_ugc";
      });

      if (data.warning) {
        setError(data.warning);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load image-slide metadata.");
    } finally {
      setIsLoadingMeta(false);
    }
  }, [collectionId]);

  const loadCharacters = useCallback(async () => {
    setIsLoadingCharacters(true);
    try {
      const response = await fetch(
        `/api/video-agent/characters?collectionId=${encodeURIComponent(collectionId)}`,
        { method: "GET", cache: "no-store" }
      );
      const data = (await response.json()) as CharacterResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to load characters.");
      }

      const characters = Array.isArray(data.characters)
        ? data.characters
        : data.character
          ? [data.character]
          : [];
      const ugcOnly = characters.filter((character) => (character.characterType || "ugc") === "ugc");
      setUgcCharacters(ugcOnly);

      setCharacterId((current) => {
        if (current !== "auto" && ugcOnly.some((item) => item.id === current)) return current;
        const defaultCharacter = ugcOnly.find((item) => item.isDefault) || null;
        return defaultCharacter?.id || "auto";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load characters.");
    } finally {
      setIsLoadingCharacters(false);
    }
  }, [collectionId]);

  useEffect(() => {
    void loadMeta();
    void loadCharacters();
  }, [loadMeta, loadCharacters]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/image-slide-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          campaignType,
          characterId: characterId === "auto" ? null : characterId,
          slideCount,
          topicBrief: topicBrief.trim(),
          reasoningModel,
        }),
      });

      const data = (await response.json()) as ImageSlideAgentResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate image-slide plan.");
      }

      if (!data.script || !Array.isArray(data.slidePlans)) {
        throw new Error("Image-slide agent response is incomplete.");
      }

      setScript(data.script);
      setSlidePlans(data.slidePlans);
      setLatestGeneratedPlanId(typeof data.saved?.id === "string" ? data.saved.id : null);
      setSuccess(
        data.saved?.planNumber
          ? `Generated and saved as plan ${data.saved.planNumber}.`
          : "Image-slide plan generated."
      );
      await loadMeta();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate image-slide plan.");
    } finally {
      setIsGenerating(false);
    }
  }, [collectionId, campaignType, characterId, slideCount, topicBrief, reasoningModel, loadMeta]);

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
              UGC TikTok slide scripts + Figma recreation plan. Campaign-first flow for shocked reaction halal alternative positioning.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Campaign</label>
                <select
                  value={campaignType}
                  onChange={(event) => setCampaignType(event.target.value as ImageSlideCampaignType)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                >
                  {(campaigns.length > 0
                    ? campaigns
                    : [{ id: "widget_shock_hook_ugc", label: "UGC Shock Hook (Halal Flo Alternative)", description: "" }]
                  ).map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Character</label>
                <select
                  value={characterId}
                  disabled={isLoadingCharacters}
                  onChange={(event) => setCharacterId(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                >
                  <option value="auto">Auto/default UGC character</option>
                  {ugcCharacters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.characterName}{character.isDefault ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Slides</label>
                <input
                  type="number"
                  min={5}
                  max={6}
                  value={slideCount}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    setSlideCount(Math.max(5, Math.min(6, Math.round(value))));
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reasoning Model</label>
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

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Topic Focus (optional)</label>
              <textarea
                value={topicBrief}
                onChange={(event) => setTopicBrief(event.target.value)}
                rows={3}
                placeholder="Optional angle or constraints for this campaign."
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
              />
            </div>

            {selectedUgcCharacter ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <p className="font-semibold text-slate-700">{selectedUgcCharacter.characterName}</p>
                <p className="mt-0.5">{selectedUgcCharacter.personaSummary}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void handleGenerate()} isLoading={isGenerating}>
                <Sparkles className="mr-2 h-4 w-4" />
                {isGenerating ? "Generating..." : "Generate Script + Figma Plan"}
              </Button>
              <Button variant="outline" onClick={() => void loadMeta()} isLoading={isLoadingMeta}>
                Refresh Saved Plans
              </Button>
              {script ? (
                <Button variant="outline" onClick={() => void navigator.clipboard.writeText(script)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Script
                </Button>
              ) : null}
              {latestGeneratedPlanId ? (
                <Button
                  variant="outline"
                  onClick={() => router.push(`/collections/${collectionId}/image-slide-agent/${latestGeneratedPlanId}`)}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Open Latest Plan
                </Button>
              ) : null}
            </div>

            <div className="max-w-xs space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Image Model (for plan detail asset generation)</label>
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

            {error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
            ) : null}
            {success ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p>
            ) : null}
            {activeCollection?.app_name ? (
              <p className="text-xs text-slate-500">App context source: {activeCollection.app_name}</p>
            ) : null}
          </CardContent>
        </Card>

        {savedPlans.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saved Plans</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {savedPlans.slice(0, 10).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => router.push(`/collections/${collectionId}/image-slide-agent/${item.id}`)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-rose-300 hover:bg-rose-50/40"
                >
                  <p className="text-sm font-semibold text-slate-800">{`Plan ${item.planNumber} - ${item.campaignType.replace(/_/g, " ")}`}</p>
                  <p className="text-xs text-slate-500">{`${item.slideCount} slides${item.characterName ? ` | ${item.characterName}` : ""} | ${new Date(item.createdAt).toLocaleString()}`}</p>
                  {item.scriptPreview ? <p className="mt-1 text-xs text-slate-600">{item.scriptPreview}</p> : null}
                </button>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {script ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Generated Script</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{script}</pre>
            </CardContent>
          </Card>
        ) : null}

        {slidePlans.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Figma Recreation Plan</CardTitle>
              <CardDescription>Per-slide build steps and visual asset prompts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {slidePlans.map((plan, index) => (
                <div key={`slide-plan-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <Badge variant="default">Slide {index + 1}</Badge>
                    <Badge variant="default"><FileText className="mr-1 h-3 w-3" />Figma</Badge>
                    <Badge variant="default"><Users className="mr-1 h-3 w-3" />UGC vibe</Badge>
                  </div>

                  {plan.headline ? <p className="text-sm text-slate-700"><span className="font-semibold text-slate-500">Headline:</span> {plan.headline}</p> : null}
                  {plan.supportingText ? <p className="mt-0.5 text-sm text-slate-700"><span className="font-semibold text-slate-500">Supporting:</span> {plan.supportingText}</p> : null}

                  {plan.figmaInstructions.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Figma Instructions</p>
                      <ol className="mt-1 list-inside list-decimal space-y-0.5">
                        {plan.figmaInstructions.map((step, stepIndex) => (
                          <li key={`step-${index}-${stepIndex}`} className="text-sm text-slate-600">{step}</li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  {plan.assetPrompts.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Asset Prompts</p>
                      <div className="mt-1 space-y-1">
                        {plan.assetPrompts.map((asset, assetIndex) => (
                          <div key={`asset-${index}-${assetIndex}`} className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                            <p className="text-xs font-semibold text-slate-700">{asset.description || `Asset ${assetIndex + 1}`}</p>
                            <p className="text-xs text-slate-600">{asset.prompt}</p>
                          </div>
                        ))}
                      </div>
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
