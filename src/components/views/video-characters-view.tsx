"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Sparkles, Star } from "lucide-react";
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
import {
  IMAGE_GENERATION_MODELS,
  type ImageGenerationModel,
  isImageGenerationModel,
} from "@/lib/image-generation-model";

type UgcCharacter = {
  id: string;
  characterName: string;
  personaSummary: string;
  visualStyle: string;
  wardrobeNotes: string | null;
  voiceTone: string | null;
  promptTemplate: string;
  referenceImageUrl: string | null;
  imageModel: string | null;
  isDefault?: boolean;
  updatedAt: string;
};

type CharactersResponse = {
  characters?: UgcCharacter[];
  character?: UgcCharacter | null;
  error?: string;
};

export function VideoCharactersView({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const [characters, setCharacters] = useState<UgcCharacter[]>([]);
  const [reasoningModel, setReasoningModel] = useState<ReasoningModel>(DEFAULT_REASONING_MODEL);
  const [imageModel, setImageModel] = useState<ImageGenerationModel>("gemini-3-pro-image-preview");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [defaultingId, setDefaultingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadCharacters = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/video-agent/characters?collectionId=${encodeURIComponent(collectionId)}`,
        { method: "GET", cache: "no-store" }
      );

      const data = (await response.json()) as CharactersResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to load characters.");
      }

      const list = Array.isArray(data.characters)
        ? data.characters
        : data.character
          ? [data.character]
          : [];

      setCharacters(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load characters.");
    } finally {
      setIsLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    void loadCharacters();
  }, [loadCharacters]);

  const handleCreate = async () => {
    setIsCreating(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/video-agent/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          reasoningModel,
          imageGenerationModel: imageModel,
          setAsDefault: true,
        }),
      });

      const data = (await response.json()) as CharactersResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to create character.");
      }

      setSuccess("Character created and set as default.");
      await loadCharacters();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create character.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSetDefault = async (characterId: string) => {
    setDefaultingId(characterId);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/video-agent/characters/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId, characterId }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to set default character.");
      }

      setSuccess("Default character updated.");
      await loadCharacters();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set default character.");
    } finally {
      setDefaultingId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/collections/${collectionId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to collection
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Character Studio</CardTitle>
            <CardDescription>
              Create reusable UGC AI creators. Video Agent will let you pick one whenever format type is UGC.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reasoning model</p>
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
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Image model</p>
                <select
                  value={imageModel}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (isImageGenerationModel(value)) setImageModel(value);
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                >
                  {IMAGE_GENERATION_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Button variant="primary" onClick={handleCreate} isLoading={isCreating}>
              <Sparkles className="mr-2 h-4 w-4" />
              Create Character
            </Button>

            {error ? <p className="text-sm text-rose-700">{error}</p> : null}
            {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saved Characters</CardTitle>
            <CardDescription>{isLoading ? "Loading..." : `${characters.length} characters`}</CardDescription>
          </CardHeader>
          <CardContent>
            {characters.length === 0 ? (
              <p className="text-sm text-slate-500">No characters yet. Create your first one above.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {characters.map((character) => (
                  <div key={character.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">{character.characterName}</p>
                      {character.isDefault ? <Badge variant="success">Default</Badge> : <Badge variant="default">Saved</Badge>}
                    </div>
                    {character.referenceImageUrl ? (
                      <img
                        src={character.referenceImageUrl}
                        alt={character.characterName}
                        className="mt-2 h-36 w-full rounded-md object-cover"
                      />
                    ) : null}
                    <p className="mt-2 text-xs text-slate-600">{character.personaSummary}</p>
                    <p className="mt-1 text-[11px] text-slate-500">Image model: {character.imageModel || "N/A"}</p>
                    <p className="mt-1 text-[11px] text-slate-500">Voice: {character.voiceTone || "N/A"}</p>
                    {!character.isDefault ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => handleSetDefault(character.id)}
                        disabled={defaultingId === character.id}
                      >
                        {defaultingId === character.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Setting...
                          </>
                        ) : (
                          <>
                            <Star className="mr-2 h-4 w-4" />
                            Set as Default
                          </>
                        )}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
