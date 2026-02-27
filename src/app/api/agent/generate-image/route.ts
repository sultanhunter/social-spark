import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { uploadToR2 } from "@/lib/r2";

interface PartWithInlineData {
    inlineData?: {
        data?: string;
        mimeType?: string;
    };
}

export async function POST(request: NextRequest) {
    try {
        const { prompt, token } = (await request.json()) as {
            prompt?: string;
            token?: string;
        };

        // Validate bot token
        const botToken = process.env.AGENT_BOT_TOKEN;
        if (!botToken || token !== botToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Validate prompt
        if (!prompt || prompt.trim().length === 0) {
            return NextResponse.json(
                { error: "Prompt is required" },
                { status: 400 }
            );
        }

        // Validate API key
        const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "Gemini API key is not configured" },
                { status: 500 }
            );
        }

        // Generate image with Gemini 3.1 Flash Image Preview model
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-3.1-flash-image-preview",
        });

        const result = await model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: `Generate a high-quality image based on this prompt:\n\n${prompt.trim()}\n\nIMPORTANT: Output ONLY the image, no text response.`,
                        },
                    ],
                },
            ],
            generationConfig: {
                // @ts-expect-error - responseModalities is supported but not yet typed in the SDK
                responseModalities: ["IMAGE", "TEXT"],
            },
        });

        const response = result.response;
        const parts = (
            (response.candidates?.[0]?.content?.parts ?? []) as unknown
        ) as Array<Record<string, unknown>>;

        const imagePart = parts.find(
            (part) => "inlineData" in part
        ) as PartWithInlineData | undefined;

        if (!imagePart?.inlineData?.data) {
            return NextResponse.json(
                { error: "No image was generated. Try a different prompt." },
                { status: 422 }
            );
        }

        // Upload to R2 and return the public URL
        const imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");
        const mimeType = imagePart.inlineData.mimeType || "image/png";
        const extension = mimeType.includes("png") ? "png" : "jpg";
        const key = `agent-generated/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

        const imageUrl = await uploadToR2(key, imageBuffer, mimeType);

        return NextResponse.json({
            success: true,
            imageUrl,
            mimeType,
        });
    } catch (error) {
        console.error("Image generation error:", error);
        const message =
            error instanceof Error ? error.message : "Image generation failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
