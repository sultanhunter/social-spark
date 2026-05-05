import { GoogleGenAI, type GenerateContentConfig } from "@google/genai";

function createAIClient(): GoogleGenAI {
  const vertexProject = process.env.GOOGLE_VERTEX_AI_PROJECT;
  const vertexLocation = process.env.GOOGLE_VERTEX_AI_LOCATION;

  if (vertexProject && vertexLocation) {
    const credsJson = process.env.GOOGLE_VERTEX_AI_CREDENTIALS_JSON;
    if (credsJson) {
      let credentials: Record<string, unknown>;
      try {
        credentials = JSON.parse(credsJson);
      } catch {
        throw new Error("GOOGLE_VERTEX_AI_CREDENTIALS_JSON is not valid JSON.");
      }
      return new GoogleGenAI({
        enterprise: true,
        project: vertexProject,
        location: vertexLocation,
        googleAuthOptions: { credentials },
      });
    }
    return new GoogleGenAI({
      enterprise: true,
      project: vertexProject,
      location: vertexLocation,
    });
  }

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Neither GOOGLE_VERTEX_AI_PROJECT/GOOGLE_VERTEX_AI_LOCATION nor GOOGLE_GEMINI_API_KEY is configured."
    );
  }

  return new GoogleGenAI({ apiKey });
}

export const ai = createAIClient();

export type { GenerateContentConfig };

export function requireAI(): GoogleGenAI {
  return ai;
}
