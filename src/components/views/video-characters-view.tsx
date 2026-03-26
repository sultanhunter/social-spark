"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Sparkles, Star, Trash2, Upload } from "lucide-react";
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
  characterType?: "ugc" | "animated";
  isDefault?: boolean;
  updatedAt: string;
};

type CharactersResponse = {
  characters?: UgcCharacter[];
  character?: UgcCharacter | null;
  error?: string;
};

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_TRANSPORT_BYTES = 3.8 * 1024 * 1024;

function toJpegName(filename: string): string {
  const cleaned = filename.trim();
  if (!cleaned) return `character-${Date.now()}.jpg`;
  const dotIndex = cleaned.lastIndexOf(".");
  if (dotIndex <= 0) return `${cleaned}.jpg`;
  return `${cleaned.slice(0, dotIndex)}.jpg`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image for upload."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to process uploaded image."));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to compress image for upload."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

async function compressImageForUpload(file: File, targetBytes: number): Promise<File> {
  if (file.size <= targetBytes) return file;

  const src = await readFileAsDataUrl(file);
  const image = await loadImage(src);

  const maxDimension = 2048;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  let width = Math.max(1, Math.round(image.width * scale));
  let height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to initialize image compression context.");
  }

  let quality = 0.9;
  let bestBlob: Blob | null = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, quality);
    bestBlob = blob;

    if (blob.size <= targetBytes) {
      return new File([blob], toJpegName(file.name), { type: "image/jpeg" });
    }

    quality = Math.max(0.45, quality - 0.1);

    if (attempt >= 3) {
      width = Math.max(720, Math.round(width * 0.88));
      height = Math.max(720, Math.round(height * 0.88));
    }
  }

  if (bestBlob && bestBlob.size <= targetBytes) {
    return new File([bestBlob], toJpegName(file.name), { type: "image/jpeg" });
  }

  throw new Error("Could not compress image enough for upload. Try a smaller image.");
}

export function VideoCharactersView({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const [characters, setCharacters] = useState<UgcCharacter[]>([]);
  const [reasoningModel, setReasoningModel] = useState<ReasoningModel>(DEFAULT_REASONING_MODEL);
  const [imageModel, setImageModel] = useState<ImageGenerationModel>("gemini-3-pro-image-preview");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isUploadingCreate, setIsUploadingCreate] = useState(false);
  const [defaultingId, setDefaultingId] = useState<string | null>(null);
  const [deletingCharacterId, setDeletingCharacterId] = useState<string | null>(null);
  const [uploadedCharacterFile, setUploadedCharacterFile] = useState<File | null>(null);
  const [uploadedCharacterPreview, setUploadedCharacterPreview] = useState<string | null>(null);
  const [characterNameInput, setCharacterNameInput] = useState("");
  const [characterTypeInput, setCharacterTypeInput] = useState<"ugc" | "animated">("ugc");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const parseApiResponse = useCallback(async (response: Response) => {
    const text = await response.text();
    if (!text) {
      return { data: null as Record<string, unknown> | null, text: "" };
    }

    try {
      return { data: JSON.parse(text) as Record<string, unknown>, text };
    } catch {
      return { data: null as Record<string, unknown> | null, text };
    }
  }, []);

  const loadCharacters = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/video-agent/characters?collectionId=${encodeURIComponent(collectionId)}&includeAngles=false`,
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

  useEffect(() => {
    return () => {
      if (uploadedCharacterPreview) {
        URL.revokeObjectURL(uploadedCharacterPreview);
      }
    };
  }, [uploadedCharacterPreview]);

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
          characterType: characterTypeInput,
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

  const handleCreateFromUpload = async () => {
    if (!uploadedCharacterFile) {
      setError("Please select an image first.");
      return;
    }

    if (uploadedCharacterFile.size > MAX_UPLOAD_SIZE_BYTES) {
      setError("Image is too large. Please use an image under 10MB.");
      return;
    }

    setIsUploadingCreate(true);
    setError("");
    setSuccess("");

    try {
      const fileForUpload = await compressImageForUpload(uploadedCharacterFile, MAX_UPLOAD_TRANSPORT_BYTES);

      const formData = new FormData();
      formData.append("collectionId", collectionId);
      formData.append("image", fileForUpload);

      const uploadResponse = await fetch("/api/video-agent/characters/upload", {
        method: "POST",
        body: formData,
      });

      const uploadParsed = await parseApiResponse(uploadResponse);
      const uploadImageUrl =
        uploadParsed.data && typeof uploadParsed.data.imageUrl === "string"
          ? uploadParsed.data.imageUrl
          : null;

      if (!uploadResponse.ok || !uploadImageUrl) {
        const rawMessage =
          (uploadParsed.data && typeof uploadParsed.data.error === "string"
            ? uploadParsed.data.error
            : uploadParsed.text) || `Upload failed (${uploadResponse.status}).`;

        if (
          uploadResponse.status === 413 ||
          /request entity too large/i.test(rawMessage) ||
          /payload too large/i.test(rawMessage)
        ) {
          throw new Error("Upload gateway rejected the file size. Try a smaller image (current transport cap is ~4MB).");
        }

        throw new Error(rawMessage);
      }

      const createResponse = await fetch("/api/video-agent/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          reasoningModel,
          imageGenerationModel: imageModel,
          characterType: characterTypeInput,
          setAsDefault: true,
          referenceImageUrl: uploadImageUrl,
          characterName: characterNameInput.trim() || undefined,
        }),
      });

      const createParsed = await parseApiResponse(createResponse);
      if (!createResponse.ok) {
        const createError =
          (createParsed.data && typeof createParsed.data.error === "string"
            ? createParsed.data.error
            : createParsed.text) || "Failed to create character from uploaded image.";
        throw new Error(createError);
      }

      setUploadedCharacterFile(null);
      setUploadedCharacterPreview(null);
      setCharacterNameInput("");
      setSuccess("Character created from uploaded image and set as default.");
      await loadCharacters();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create character from uploaded image.");
    } finally {
      setIsUploadingCreate(false);
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

  const handleDeleteCharacter = async (characterId: string) => {
    const target = characters.find((item) => item.id === characterId) || null;
    const confirmed = window.confirm(
      `Delete character${target?.characterName ? ` \"${target.characterName}\"` : ""}? This removes saved angles too.`
    );
    if (!confirmed) return;

    setDeletingCharacterId(characterId);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/video-agent/characters", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId, characterId }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to delete character.");
      }

      setSuccess("Character deleted.");
      await loadCharacters();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete character.");
    } finally {
      setDeletingCharacterId(null);
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
                <p className="text-[11px] text-slate-500">
                  For most photoreal faces, start with `imagen-4.0-ultra-generate-001`.
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Character name (optional)</p>
                <input
                  type="text"
                  value={characterNameInput}
                  onChange={(event) => setCharacterNameInput(event.target.value)}
                  placeholder="e.g. Ayesha Lifestyle"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Upload reference image</p>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;

                    if (uploadedCharacterPreview) {
                      URL.revokeObjectURL(uploadedCharacterPreview);
                    }

                    if (file && file.size > MAX_UPLOAD_SIZE_BYTES) {
                      setUploadedCharacterFile(null);
                      setUploadedCharacterPreview(null);
                      setError("Image is too large. Please use an image under 10MB.");
                      return;
                    }

                    setUploadedCharacterFile(file);
                    setUploadedCharacterPreview(file ? URL.createObjectURL(file) : null);
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-2 file:py-1 file:text-xs file:font-medium file:text-rose-700"
                />
                <p className="text-[11px] text-slate-500">
                  You can pick files up to 10MB. Large images are auto-compressed for upload.
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Character type</p>
                <select
                  value={characterTypeInput}
                  onChange={(event) => setCharacterTypeInput(event.target.value === "animated" ? "animated" : "ugc")}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                >
                  <option value="ugc">UGC (photoreal live-action)</option>
                  <option value="animated">Animated (CGI style)</option>
                </select>
              </div>
            </div>

            {uploadedCharacterPreview ? (
              <img src={uploadedCharacterPreview} alt="Uploaded character preview" className="h-36 w-28 rounded-lg border border-slate-200 object-cover" />
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={handleCreate} isLoading={isCreating}>
                <Sparkles className="mr-2 h-4 w-4" />
                Create AI Character
              </Button>
              <Button
                variant="outline"
                onClick={handleCreateFromUpload}
                isLoading={isUploadingCreate}
                disabled={!uploadedCharacterFile}
              >
                <Upload className="mr-2 h-4 w-4" />
                Create from Uploaded Image
              </Button>
            </div>

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
                      <div className="flex items-center gap-1.5">
                        <Badge variant="default">{character.characterType || "ugc"}</Badge>
                        {character.isDefault ? <Badge variant="success">Default</Badge> : <Badge variant="default">Saved</Badge>}
                      </div>
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

                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => void handleDeleteCharacter(character.id)}
                      disabled={deletingCharacterId === character.id}
                    >
                      {deletingCharacterId === character.id ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Character
                        </>
                      )}
                    </Button>

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
