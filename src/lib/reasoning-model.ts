export const REASONING_MODELS = [
  {
    id: "gemini-3.1-pro-preview",
    label: "gemini-3.1-pro-preview",
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    label: "gemini-3.1-flash-lite-preview",
  },
] as const;

export type ReasoningModel = (typeof REASONING_MODELS)[number]["id"];

export const DEFAULT_REASONING_MODEL: ReasoningModel = "gemini-3.1-pro-preview";

export function isReasoningModel(value: unknown): value is ReasoningModel {
  if (typeof value !== "string") return false;
  return REASONING_MODELS.some((model) => model.id === value);
}
