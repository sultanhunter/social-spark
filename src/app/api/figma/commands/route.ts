import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { DEFAULT_REASONING_MODEL } from "@/lib/reasoning-model";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as Record<string, unknown>;
        const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
        const slideWidth = typeof body.slideWidth === "number" ? body.slideWidth : 1080;
        const slideHeight = typeof body.slideHeight === "number" ? body.slideHeight : 1080;

        if (!instructions) {
            return NextResponse.json({ error: "Instructions are required" }, { status: 400, headers: corsHeaders });
        }

        const prompt = `You are an expert Figma plugin developer. Convert the following step-by-step Figma design instructions into executable Figma Plugin API JavaScript code.

INSTRUCTIONS:
${instructions}

REQUIREMENTS:
- Output a single async JavaScript function body that uses the Figma Plugin API.
- Use modern JavaScript (const, let, arrow functions, async/await are all fine).
- Do NOT use nullish coalescing (??) or optional chaining (?.) — those are the only syntax features not supported.
- Start by creating the main frame: const frame = figma.createFrame(); frame.resize(${slideWidth}, ${slideHeight}); etc.
- All child elements should be appended to the frame or nested parents using parent.appendChild(child).
- For text nodes, ALWAYS load fonts first: await figma.loadFontAsync({ family: "Inter", style: "Regular" })
- For any image/photo assets mentioned, create a rectangle placeholder with a light fill and name it descriptively (e.g. node.name = "Image: Background photo").
- Use exact positions, sizes, colors, fonts, and spacings from the instructions.
- Colors must be in 0-1 range (e.g. #F36F97 = { r: 0.953, g: 0.435, b: 0.592 }).
- End with: figma.currentPage.appendChild(frame); figma.viewport.scrollAndZoomIntoView([frame]);
- Output ONLY the raw JavaScript code. No markdown, no backticks, no explanation.
- The code will be executed inside an async function, so you can use await directly.`;

        const model = genAI.getGenerativeModel({ model: DEFAULT_REASONING_MODEL });
        const result = await model.generateContent(prompt);
        let code = result.response.text().trim();

        // Strip markdown code fences if present
        if (code.startsWith("```")) {
            code = code.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
        }

        return NextResponse.json({ code }, { headers: corsHeaders });
    } catch (err) {
        console.error("[figma/commands] error:", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to generate Figma commands" },
            { status: 500, headers: corsHeaders }
        );
    }
}
