import { NextRequest, NextResponse } from "next/server";
import { listR2Objects, type R2ObjectListItem } from "@/lib/r2";
import { supabase } from "@/lib/supabase";

type GallerySlide = R2ObjectListItem & {
  slideNumber: number | null;
  filename: string;
  downloadUrl: string;
  slideType?: string | null;
  prompt?: string | null;
};

type GalleryPost = {
  id: string;
  collectionId: string;
  postSlug: string;
  inferredBatch: number;
  source: "job" | "r2";
  jobId: string | null;
  jobStatus: string | null;
  slideCount: number;
  totalBytes: number;
  firstUploadedAt: string | null;
  lastUploadedAt: string | null;
  script: Record<string, unknown> | null;
  caption: string | null;
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

function getFilenameFromUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.pathname.split("/").pop() || "muslimah-carousel-slide.png";
  } catch {
    return "muslimah-carousel-slide.png";
  }
}

function normalizePublicUrl(value: unknown): string | null {
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
}

function extractImagesFromState(state: Record<string, unknown>): Array<Record<string, unknown>> {
  const result =
    typeof state.result === "object" && state.result !== null
      ? (state.result as Record<string, unknown>)
      : null;
  const resultImages = Array.isArray(result?.images) ? result.images : [];
  const partialImages = Array.isArray(state.partialImages) ? state.partialImages : [];
  return resultImages.length > 0 ? resultImages as Array<Record<string, unknown>> : partialImages as Array<Record<string, unknown>>;
}

function extractScriptFromState(state: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof state.script === "object" && state.script !== null) return state.script as Record<string, unknown>;
  const result =
    typeof state.result === "object" && state.result !== null
      ? (state.result as Record<string, unknown>)
      : null;
  return typeof result?.script === "object" && result.script !== null ? result.script as Record<string, unknown> : null;
}

function getCaptionFromScript(script: Record<string, unknown> | null): string | null {
  return typeof script?.caption === "string" ? script.caption : null;
}

function buildJobPosts(
  jobs: Array<Record<string, unknown>>,
  objectsByUrl: Map<string, R2ObjectListItem>,
  usedUrls: Set<string>,
  collectionId: string
): GalleryPost[] {
  return jobs.flatMap((job) => {
    const state =
      typeof job.generation_state === "object" && job.generation_state !== null
        ? (job.generation_state as Record<string, unknown>)
        : {};
    const script = extractScriptFromState(state);
    const images = extractImagesFromState(state);
    if (!images.length) return [];

    const slides: GallerySlide[] = images
      .map((image): GallerySlide | null => {
        const imageUrl = normalizePublicUrl(image.imageUrl);
        if (!imageUrl) return null;
        usedUrls.add(imageUrl);

        const filename = getFilenameFromUrl(imageUrl);
        const object = objectsByUrl.get(imageUrl);
        return {
          key: object?.key || imageUrl,
          publicUrl: imageUrl,
          size: object?.size || 0,
          lastModified: object?.lastModified || (typeof job.updated_at === "string" ? job.updated_at : null),
          slideNumber: typeof image.slideNumber === "number" ? image.slideNumber : null,
          filename,
          downloadUrl: toDownloadUrl(imageUrl, filename),
          slideType: typeof image.slideType === "string" ? image.slideType : null,
          prompt: typeof image.prompt === "string" ? image.prompt : null,
        };
      })
      .filter((slide): slide is GallerySlide => slide !== null)
      .sort((a, b) => (a.slideNumber || 999) - (b.slideNumber || 999));

    const timestamps = slides
      .map((slide) => slide.lastModified)
      .filter((value): value is string => typeof value === "string");
    const hook = typeof script?.hook === "string" ? script.hook : "muslimah carousel";
    const postSlug = hook.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "muslimah-carousel";

    return [{
      id: String(job.id),
      collectionId,
      postSlug,
      inferredBatch: 1,
      source: "job" as const,
      jobId: typeof job.id === "string" ? job.id : null,
      jobStatus: typeof job.status === "string" ? job.status : null,
      slideCount: slides.length,
      totalBytes: slides.reduce((sum, slide) => sum + slide.size, 0),
      firstUploadedAt: timestamps.length ? [...timestamps].sort()[0] : (typeof job.created_at === "string" ? job.created_at : null),
      lastUploadedAt: timestamps.length ? [...timestamps].sort()[timestamps.length - 1] : (typeof job.updated_at === "string" ? job.updated_at : null),
      script,
      caption: getCaptionFromScript(script),
      slides,
    }];
  });
}

function groupObjects(objects: R2ObjectListItem[], collectionId: string, usedUrls: Set<string>): GalleryPost[] {
  const byPostSlug = new Map<string, GallerySlide[]>();

  for (const object of objects) {
    const parsed = parseKey(object.key);
    if (!parsed || parsed.collectionId !== collectionId) continue;
    if (usedUrls.has(object.publicUrl)) continue;

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
        source: "r2",
        jobId: null,
        jobStatus: null,
        slideCount: sortedBatch.length,
        totalBytes: sortedBatch.reduce((sum, slide) => sum + slide.size, 0),
        firstUploadedAt: timestamps.length ? timestamps.sort()[0] : null,
        lastUploadedAt: timestamps.length ? timestamps.sort()[timestamps.length - 1] : null,
        script: null,
        caption: null,
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
    const objectsByUrl = new Map(objects.map((object) => [object.publicUrl, object]));
    const usedUrls = new Set<string>();
    const { data: jobs } = await supabase
      .from("muslimah_carousel_jobs")
      .select("id, collection_id, status, generation_state, created_at, updated_at")
      .eq("collection_id", collectionId)
      .order("updated_at", { ascending: false })
      .limit(100);
    const jobPosts = buildJobPosts(
      Array.isArray(jobs) ? jobs as Array<Record<string, unknown>> : [],
      objectsByUrl,
      usedUrls,
      collectionId
    );
    const r2Posts = groupObjects(objects, collectionId, usedUrls);
    const posts = [...jobPosts, ...r2Posts].sort((a, b) => {
      const timeA = a.lastUploadedAt ? Date.parse(a.lastUploadedAt) : 0;
      const timeB = b.lastUploadedAt ? Date.parse(b.lastUploadedAt) : 0;
      return timeB - timeA;
    });

    return NextResponse.json({
      collectionId,
      prefix,
      totalObjects: objects.length,
      posts,
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
