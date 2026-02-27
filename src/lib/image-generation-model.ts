export const IMAGE_GENERATION_MODELS = [
  {
    id: "gemini-3.1-flash-image-preview",
    label: "gemini-3.1-flash-image-preview (Nano Banana 2)",
  },
  {
    id: "gemini-3-pro-image-preview",
    label: "gemini-3-pro-image-preview (Nano Banana Pro)",
  },
  {
    id: "imagen-4.0-ultra-generate-001",
    label: "imagen-4.0-ultra-generate-001",
  },
  {
    id: "imagen-4.0-generate-001",
    label: "imagen-4.0-generate-001",
  },
  {
    id: "imagen-4.0-fast-generate-001",
    label: "imagen-4.0-fast-generate-001",
  },
] as const;

export type ImageGenerationModel = (typeof IMAGE_GENERATION_MODELS)[number]["id"];

export const DEFAULT_IMAGE_GENERATION_MODEL: ImageGenerationModel = "gemini-3-pro-image-preview";

export function isImageGenerationModel(value: unknown): value is ImageGenerationModel {
  if (typeof value !== "string") return false;
  return IMAGE_GENERATION_MODELS.some((model) => model.id === value);
}
