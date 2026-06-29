import { NextRequest, NextResponse } from "next/server";
import { listR2Objects, type R2ObjectListItem } from "@/lib/r2";

type GallerySlide = R2ObjectListItem & {
  slideNumber: number | null;
  filename: string;
  downloadUrl: string;
};

type GalleryPost = {
  id: string;
  collectionId: string;
  postSlug: string;
  inferredBatch: number;
  slideCount: number;
  totalBytes: number;
  firstUploadedAt: string | null;
  lastUploadedAt: string | null;
  slides: GallerySlide[];
};

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseSlideNumber(key: string): number | null {
  const match = key.match(/(?:^|-)slide-(\d+)\.(?:png|jpe?g|webp)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseKey(key: string) {
  const parts = key.split("/").filter(Boolean);
  if (parts.length < 4 || parts[0] !== "muslimah-health-carousels") return null;
  const filename = parts[parts.length - 1] || "";
  const postSlug = parts.slice(2, -1).join("/") || "unknown-post";

  return {
    collectionId: parts[1],
    postSlug,
    filename,
    slideNumber: parseSlideNumber(filename),
  };
}

function byUploadTimeThenSlide(a: GallerySlide, b: GallerySlide): number {
  const timeA = a.lastModified ? Date.parse(a.lastModified) : 0;
  const timeB = b.lastModified ? Date.parse(b.lastModified) : 0;
  if (timeA !== timeB) return timeA - timeB;
  return (a.slideNumber || 999) - (b.slideNumber || 999);
}

function splitIntoBatches(slides: GallerySlide[]): GallerySlide[][] {
  const batches: GallerySlide[][] = [];
  let current: GallerySlide[] = [];
  const seenSlides = new Set<number>();

  for (const slide of [...slides].sort(byUploadTimeThenSlide)) {
    const slideNumber = slide.slideNumber;
    const shouldStartNewBatch =
      current.length > 0 &&
      ((typeof slideNumber === "number" && seenSlides.has(slideNumber)) ||
        current.length >= 10 ||
        slideNumber === 1);

    if (shouldStartNewBatch) {
      batches.push(current);
      current = [];
      seenSlides.clear();
    }

    current.push(slide);
    if (typeof slideNumber === "number") seenSlides.add(slideNumber);
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function toDownloadUrl(publicUrl: string, filename: string): string {
  return `/api/media/download?url=${encodeURIComponent(publicUrl)}&filename=${encodeURIComponent(filename)}`;
}

function groupObjects(objects: R2ObjectListItem[], collectionId: string): GalleryPost[] {
  const byPostSlug = new Map<string, GallerySlide[]>();

  for (const object of objects) {
    const parsed = parseKey(object.key);
    if (!parsed || parsed.collectionId !== collectionId) continue;

    const slide: GallerySlide = {
      ...object,
      slideNumber: parsed.slideNumber,
      filename: parsed.filename,
      downloadUrl: toDownloadUrl(object.publicUrl, parsed.filename),
    };
    const slides = byPostSlug.get(parsed.postSlug) || [];
    slides.push(slide);
    byPostSlug.set(parsed.postSlug, slides);
  }

  const posts: GalleryPost[] = [];
  for (const [postSlug, slides] of byPostSlug.entries()) {
    const batches = splitIntoBatches(slides);
    batches.forEach((batch, index) => {
      const sortedBatch = [...batch].sort((a, b) => (a.slideNumber || 999) - (b.slideNumber || 999));
      const timestamps = sortedBatch
        .map((slide) => slide.lastModified)
        .filter((value): value is string => typeof value === "string");
      posts.push({
        id: `${collectionId}/${postSlug}/${index + 1}`,
        collectionId,
        postSlug,
        inferredBatch: index + 1,
        slideCount: sortedBatch.length,
        totalBytes: sortedBatch.reduce((sum, slide) => sum + slide.size, 0),
        firstUploadedAt: timestamps.length ? timestamps.sort()[0] : null,
        lastUploadedAt: timestamps.length ? timestamps.sort()[timestamps.length - 1] : null,
        slides: sortedBatch,
      });
    });
  }

  return posts.sort((a, b) => {
    const timeA = a.lastUploadedAt ? Date.parse(a.lastUploadedAt) : 0;
    const timeB = b.lastUploadedAt ? Date.parse(b.lastUploadedAt) : 0;
    return timeB - timeA;
  });
}

export async function GET(request: NextRequest) {
  try {
    const collectionId = asNonEmptyString(request.nextUrl.searchParams.get("collectionId"));
    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }

    const max = Number(request.nextUrl.searchParams.get("max") || 500);
    const maxKeys = Number.isFinite(max) ? Math.min(Math.max(Math.round(max), 1), 1000) : 500;
    const prefix = `muslimah-health-carousels/${collectionId}/`;
    const objects = await listR2Objects(prefix, maxKeys);

    return NextResponse.json({
      collectionId,
      prefix,
      totalObjects: objects.length,
      posts: groupObjects(objects, collectionId),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load muslimah carousel R2 gallery.",
      },
      { status: 500 }
    );
  }
}
