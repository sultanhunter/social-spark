import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as Record<string, unknown>;
        const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";

        if (!imageUrl) {
            return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
        }

        const falApiKey = process.env.FAL_KEY;
        if (!falApiKey) {
            return NextResponse.json({ error: "FAL_KEY not configured" }, { status: 500 });
        }

        // Call fal.ai BiRefNet for background removal
        const response = await fetch("https://queue.fal.run/fal-ai/birefnet", {
            method: "POST",
            headers: {
                Authorization: `Key ${falApiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                image_url: imageUrl,
                model: "General Use (Light)",
                operating_resolution: "1024x1024",
                output_format: "png",
                refine_foreground: true,
            }),
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error("[remove-bg] fal.ai error:", response.status, errBody);
            throw new Error(`Background removal failed (${response.status})`);
        }

        const result = (await response.json()) as Record<string, unknown>;

        // fal.ai returns { image: { url, width, height, ... } }
        const image = result.image as Record<string, unknown> | undefined;
        const resultUrl = typeof image?.url === "string" ? image.url : null;

        if (!resultUrl) {
            throw new Error("No image returned from background removal");
        }

        return NextResponse.json({ url: resultUrl });
    } catch (err) {
        console.error("[remove-bg] error:", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Background removal failed" },
            { status: 500 }
        );
    }
}
