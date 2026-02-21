export const REASONING_MODELS = [
  {
    id: "gemini-3-pro-preview",
    label: "gemini-3-pro-preview",
  },
  {
    id: "gemini-3-flash-preview",
    label: "gemini-3-flash-preview",
  },
] as const;

export type ReasoningModel = (typeof REASONING_MODELS)[number]["id"];

export const DEFAULT_REASONING_MODEL: ReasoningModel = "gemini-3-pro-preview";

export function isReasoningModel(value: unknown): value is ReasoningModel {
  if (typeof value !== "string") return false;
  return REASONING_MODELS.some((model) => model.id === value);
}
