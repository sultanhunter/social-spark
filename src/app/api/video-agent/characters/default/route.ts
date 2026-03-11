import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  return row.code === "42P01";
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const message = typeof row.message === "string" ? row.message.toLowerCase() : "";
  const details = typeof row.details === "string" ? row.details.toLowerCase() : "";
  return `${message} ${details}`.includes("column") && `${message} ${details}`.includes(columnName.toLowerCase());
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asText(body.collectionId);
    const characterId = asText(body.characterId);

    if (!collectionId || !characterId) {
      return NextResponse.json(
        { error: "collectionId and characterId are required." },
        { status: 400 }
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from("video_ugc_characters")
      .select("id")
      .eq("id", characterId)
      .eq("collection_id", collectionId)
      .single();

    if (existingError || !existing) {
      return NextResponse.json({ error: "Character not found." }, { status: 404 });
    }

    const now = new Date().toISOString();

    const { error: resetError } = await supabase
      .from("video_ugc_characters")
      .update({ is_default: false, updated_at: now })
      .eq("collection_id", collectionId);

    if (resetError) {
      if (isMissingColumnError(resetError, "is_default")) {
        return NextResponse.json(
          {
            error:
              "UGC characters table needs latest migration (missing is_default). Run supabase-migration.sql and try again.",
          },
          { status: 500 }
        );
      }

      if (isMissingTableError(resetError)) {
        return NextResponse.json(
          {
            error:
              "UGC characters table is missing. Run the video-agent SQL migration first (see supabase-migration.sql).",
          },
          { status: 500 }
        );
      }
      throw resetError;
    }

    const { data: updated, error: updateError } = await supabase
      .from("video_ugc_characters")
      .update({ is_default: true, updated_at: now })
      .eq("id", characterId)
      .eq("collection_id", collectionId)
      .select("*")
      .single();

    if (updateError) {
      if (isMissingColumnError(updateError, "is_default")) {
        return NextResponse.json(
          {
            error:
              "UGC characters table needs latest migration (missing is_default). Run supabase-migration.sql and try again.",
          },
          { status: 500 }
        );
      }

      if (isMissingTableError(updateError)) {
        return NextResponse.json(
          {
            error:
              "UGC characters table is missing. Run the video-agent SQL migration first (see supabase-migration.sql).",
          },
          { status: 500 }
        );
      }
      throw updateError;
    }

    return NextResponse.json({ character: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to set default UGC character." },
      { status: 500 }
    );
  }
}
