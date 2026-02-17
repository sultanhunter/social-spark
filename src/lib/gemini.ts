import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

export async function generatePostScript(
  originalPost: {
    title: string | null;
    description: string | null;
    platform: string;
    postType: string;
  },
  appContext: string,
  appName: string
): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

  const prompt = `You are a social media content strategist. Your task is to recreate an existing social media post format for a different app.

ORIGINAL POST DETAILS:
- Platform: ${originalPost.platform}
- Type: ${originalPost.postType === "image_slides" ? "Image Carousel/Slides" : "Short-form Video"}
- Title: ${originalPost.title || "N/A"}
- Description: ${originalPost.description || "N/A"}

APP TO CREATE CONTENT FOR:
- App Name: ${appName}
- App Context: ${appContext}

TASK:
Create a script/content plan that:
1. Captures the VIBE and FORMAT of the original post
2. Adapts the messaging for ${appName}
3. Highlights ${appName}'s unique features and benefits
4. Maintains the engaging style of the original

${originalPost.postType === "image_slides" ? `
For IMAGE SLIDES, provide:
- Number of slides (typically 5-10)
- For each slide:
  - Headline text
  - Supporting text (if any)
  - Visual description/suggestion
  - Any icons or graphics to include
` : `
For SHORT-FORM VIDEO, provide:
- Hook (first 3 seconds)
- Main content beats
- Call to action
- Suggested captions/text overlays
- Music/sound suggestions
`}

Make the content feel authentic, not salesy. Match the energy of the original while making it uniquely about ${appName}.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

export async function generateImagePrompts(
  script: string,
  appName: string,
  slideCount: number
): Promise<string[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

  const prompt = `Based on this content script for ${appName}, generate ${slideCount} detailed image generation prompts for a professional social media carousel.

SCRIPT:
${script}

For each slide, create a prompt that:
1. Describes the visual style (modern, minimal, tech-forward)
2. Specifies colors and mood
3. Includes text overlay positioning
4. Maintains brand consistency across all slides

Return ONLY a JSON array of strings, each being an image generation prompt. No markdown, just the JSON array.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("Failed to parse image prompts");
  }
}
