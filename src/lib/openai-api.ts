import { promises as fs } from "node:fs";
import path from "node:path";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface OpenAIResponseFormat {
  type: "json_schema";
  name: string;
  strict: boolean;
  schema: JsonValue;
}

interface OpenAIOutputContent {
  type?: string;
  text?: string;
}

interface OpenAIOutputItem {
  type?: string;
  content?: OpenAIOutputContent[];
}

interface OpenAIResponsePayload {
  output_text?: string;
  output?: OpenAIOutputItem[];
  error?: { message?: string };
}

interface OpenAIImagePayload {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
}

function requireOpenAIKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }
  return apiKey;
}

async function openAIRequest<T>(endpoint: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${OPENAI_BASE_URL}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireOpenAIKey()}`,
      ...init.headers,
    },
  });

  const payload = (await response.json()) as T & { error?: { message?: string } };

  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `OpenAI request failed with status ${response.status}.`);
  }

  return payload;
}

function extractOutputText(payload: OpenAIResponsePayload): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const text = payload.output
    ?.flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" || typeof content.text === "string")
    .map((content) => content.text || "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }

  return text;
}

export async function createStructuredOpenAIResponse<T>({
  model,
  system,
  user,
  format,
  reasoningEffort = "medium",
}: {
  model: string;
  system: string;
  user: string;
  format: OpenAIResponseFormat;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
}): Promise<T> {
  const payload = await openAIRequest<OpenAIResponsePayload>("/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: system }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: user }],
        },
      ],
      reasoning: { effort: reasoningEffort },
      store: false,
      text: {
        verbosity: "low",
        format,
      },
    }),
  });

  return JSON.parse(extractOutputText(payload)) as T;
}

function inferMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

async function appendImageFile(form: FormData, filePath: string): Promise<void> {
  const buffer = await fs.readFile(filePath);
  const blob = new Blob([buffer], { type: inferMimeType(filePath) });
  form.append("image[]", blob, path.basename(filePath));
}

export async function createOpenAIImage({
  model,
  prompt,
  size,
  quality,
  referenceImagePaths = [],
}: {
  model: string;
  prompt: string;
  size: string;
  quality: "low" | "medium" | "high" | "auto";
  referenceImagePaths?: string[];
}): Promise<Buffer> {
  const cleanReferences = referenceImagePaths
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0);

  if (cleanReferences.length === 0) {
    const payload = await openAIRequest<OpenAIImagePayload>("/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        size,
        quality,
        output_format: "png",
        n: 1,
      }),
    });

    const base64 = payload.data?.[0]?.b64_json;
    if (!base64) throw new Error("OpenAI image generation returned no image bytes.");
    return Buffer.from(base64, "base64");
  }

  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", quality);
  form.append("output_format", "png");
  form.append("n", "1");

  for (const filePath of cleanReferences) {
    await appendImageFile(form, filePath);
  }

  const payload = await openAIRequest<OpenAIImagePayload>("/images/edits", {
    method: "POST",
    body: form,
  });

  const base64 = payload.data?.[0]?.b64_json;
  if (!base64) throw new Error("OpenAI image edit returned no image bytes.");
  return Buffer.from(base64, "base64");
}
