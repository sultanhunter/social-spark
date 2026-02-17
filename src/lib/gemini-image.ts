// Google Gemini Imagen 3 integration for image generation

import { GoogleGenerativeAI } from "@google/generative-ai";
import { uploadToR2, generateMediaKey } from "./r2";

interface PartWithInlineData {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

export async function generateImage(
  prompt: string,
  collectionId?: string,
  postId?: string,
  index?: number
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "imagen-3.0-generate-001" });

  const result = await model.generateContent([
    {
      text: prompt,
    },
  ]);

  const response = result.response;
  
  // Extract image data from response
  const parts = ((response.candidates?.[0]?.content?.parts ?? []) as unknown) as Array<
    Record<string, unknown>
  >;
  const imagePart = parts.find((part) => "inlineData" in part) as
    | PartWithInlineData
    | undefined;

  if (!imagePart?.inlineData?.data) {
    throw new Error("No image generated");
  }

  // Get base64 image data
  const base64Image = imagePart.inlineData.data;
  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const extension = mimeType.split("/")[1] || "png";

  // If collectionId and postId are provided, upload to R2
  if (collectionId && postId) {
    const filename = `generated-${index !== undefined ? index + 1 : Date.now()}.${extension}`;
    const key = generateMediaKey(collectionId, postId, filename);
    
    // Convert base64 to buffer
    const buffer = Buffer.from(base64Image, "base64");
    
    // Upload to R2
    const r2Url = await uploadToR2(key, buffer, mimeType);
    return r2Url;
  }
  
  // Otherwise return as data URL
  return `data:${mimeType};base64,${base64Image}`;
}

export async function generateSlideImages(
  prompts: string[],
  collectionId?: string,
  postId?: string
): Promise<string[]> {
  const results = await Promise.all(
    prompts.map((prompt, index) => 
      generateImage(prompt, collectionId, postId, index)
    )
  );
  return results;
}
