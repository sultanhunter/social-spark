import { NextRequest, NextResponse } from "next/server";
import { normalizePinterestPinPack } from "@/lib/pinterest-agent";
import { supabase } from "@/lib/supabase";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function tableMissing(message: string | undefined): boolean {
  const text = (message || "").toLowerCase();
  return text.includes("pinterest_agent_generations");
}

export async function GET(request: NextRequest) {
  try {
    const collectionId = asNonEmptyString(request.nextUrl.searchParams.get("collectionId"));
    if (!collectionId) {
      return NextResponse.json({ error: "Collection ID is required." }, { status: 400 });
    }

    const generationsQuery = await supabase
      .from("pinterest_agent_generations")
      .select(
        "id, topic, image_url, payload, reasoning_model, image_model, created_at"
      )
      .eq("collection_id", collectionId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (generationsQuery.error) {
      if (tableMissing(generationsQuery.error.message)) {
        return NextResponse.json({ generations: [] });
      }
      throw generationsQuery.error;
    }

    const generationRows = Array.isArray(generationsQuery.data) ? generationsQuery.data : [];

    const generations = generationRows
      .map((row) => {
        const generationId = asNonEmptyString(row.id);
        if (!generationId) return null;

        const payload = normalizePinterestPinPack(row.payload);
        if (!payload) return null;

        const imageUrl = asNonEmptyString(row.image_url) || payload.imageUrl || undefined;

        return {
          generationId,
          createdAt: asNonEmptyString(row.created_at) || new Date().toISOString(),
          model: asNonEmptyString(row.reasoning_model) || "",
          imageModel: asNonEmptyString(row.image_model) || "",
          generatedImage: Boolean(imageUrl),
          imageUrl,
          pack: {
            ...payload,
            topic: asNonEmptyString(row.topic) || payload.topic,
            imageUrl,
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return NextResponse.json({ generations });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load Pinterest generation history.",
      },
      { status: 500 }
    );
  }
}
