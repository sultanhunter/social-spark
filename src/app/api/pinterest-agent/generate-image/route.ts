import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_PINTEREST_IMAGE_MODEL,
  generatePinterestPinImage,
  normalizePinterestPinPack,
} from "@/lib/pinterest-agent";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isImageGenerationModel,
} from "@/lib/image-generation-model";
import { supabase } from "@/lib/supabase";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asNonEmptyString(body.collectionId);
    const generationId = asNonEmptyString(body.generationId);
    const imageModel = isImageGenerationModel(body.imageGenerationModel)
      ? body.imageGenerationModel
      : DEFAULT_PINTEREST_IMAGE_MODEL || DEFAULT_IMAGE_GENERATION_MODEL;

    if (!collectionId || !generationId) {
      return NextResponse.json(
        { error: "Collection ID and generation ID are required." },
        { status: 400 }
      );
    }

    const generationQuery = await supabase
      .from("pinterest_agent_generations")
      .select("id, topic, payload")
      .eq("id", generationId)
      .eq("collection_id", collectionId)
      .single();

    if (generationQuery.error || !generationQuery.data) {
      return NextResponse.json({ error: "Saved Pinterest generation not found." }, { status: 404 });
    }

    const generationRow = generationQuery.data as Record<string, unknown>;
    const normalizedPack = normalizePinterestPinPack(generationRow.payload);

    if (!normalizedPack) {
      return NextResponse.json(
        { error: "Saved Pinterest generation payload is invalid." },
        { status: 400 }
      );
    }

    const imageUrl = await generatePinterestPinImage({
      pack: normalizedPack,
      collectionId,
      generationId,
      imageModel,
    });

    const nextPayload = {
      ...normalizedPack,
      imageUrl,
    };

    const { error: updateError } = await supabase
      .from("pinterest_agent_generations")
      .update({
        image_url: imageUrl,
        image_model: imageModel,
        payload: nextPayload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", generationId)
      .eq("collection_id", collectionId);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      generationId,
      imageModel,
      imageUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate Pinterest pin image.",
      },
      { status: 500 }
    );
  }
}
