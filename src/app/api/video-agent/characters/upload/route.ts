import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/r2";

export const runtime = "nodejs";

function safeExtFromMime(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "jpg";
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const collectionId = String(formData.get("collectionId") || "").trim();
    const file = formData.get("image");

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "image file is required." }, { status: 400 });
    }

    const mimeType = (file.type || "").toLowerCase();
    if (!mimeType.startsWith("image/")) {
      return NextResponse.json({ error: "Only image files are allowed." }, { status: 400 });
    }

    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: "Image is too large. Max size is 10MB." },
        { status: 400 }
      );
    }

    const extension = safeExtFromMime(mimeType);
    const key = `collections/${collectionId}/characters/uploads/${Date.now()}-${randomUUID()}.${extension}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const imageUrl = await uploadToR2(key, buffer, mimeType || "image/jpeg");

    return NextResponse.json({ imageUrl });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to upload character image." },
      { status: 500 }
    );
  }
}
