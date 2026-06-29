import { NextRequest, NextResponse } from "next/server";
import {
  generateMuslimahCarouselScript,
  MUSLIMAH_IMAGE_MODEL,
  MUSLIMAH_IMAGE_QUALITY,
  MUSLIMAH_IMAGE_SIZE,
  MUSLIMAH_SCRIPT_MODEL,
  type MuslimahCarouselScript,
} from "@/lib/muslimah-carousel-agent";
import { supabase } from "@/lib/supabase";

export const maxDuration = 300;

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function asScript(value: unknown): MuslimahCarouselScript | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (row.brand !== "muslimah.health" || !Array.isArray(row.slides)) return null;
  return value as MuslimahCarouselScript;
}

async function markJobFailed(jobId: string, error: string) {
  const failedAt = new Date().toISOString();
  await supabase
    .from("muslimah_carousel_jobs")
    .update({
      status: "failed",
      generation_state: {
        kind: "muslimah_carousel",
        status: "failed",
        error,
        failed_at: failedAt,
        events: [
          {
            id: `${Date.now()}-failed`,
            at: failedAt,
            stage: "failed",
            message: error,
            level: "error",
            progress: null,
            slideNumber: null,
            elapsedMs: null,
            details: null,
          },
        ],
      },
      updated_at: failedAt,
    })
    .eq("id", jobId);
}

function deriveMuslimahWorkerUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.pathname = "/api/muslimah-carousel/worker";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function resolveWorkerUrl(): string | null {
  const explicit = asNonEmptyString(process.env.MUSLIMAH_CAROUSEL_WORKER_URL);
  if (explicit) return explicit;

  const extractorUrl =
    asNonEmptyString(process.env.SOCIAL_EXTRACTOR_API_URL) ||
    asNonEmptyString(process.env.EXTRACTOR_API_URL);
  if (extractorUrl) return deriveMuslimahWorkerUrl(extractorUrl);

  const blogWorkerUrl = asNonEmptyString(process.env.BLOG_AGENT_WORKER_URL);
  if (blogWorkerUrl) return deriveMuslimahWorkerUrl(blogWorkerUrl);

  return null;
}

function resolveWorkerToken(): string | null {
  return (
    asNonEmptyString(process.env.MUSLIMAH_CAROUSEL_WORKER_TOKEN) ||
    asNonEmptyString(process.env.SOCIAL_EXTRACTOR_API_TOKEN) ||
    asNonEmptyString(process.env.EXTRACTOR_API_TOKEN) ||
    asNonEmptyString(process.env.BLOG_AGENT_WORKER_TOKEN)
  );
}

function resolveCallbackToken(): string | null {
  return (
    asNonEmptyString(process.env.MUSLIMAH_CAROUSEL_CALLBACK_TOKEN) ||
    asNonEmptyString(process.env.SOCIAL_EXTRACTOR_API_TOKEN) ||
    asNonEmptyString(process.env.EXTRACTOR_API_TOKEN)
  );
}

function resolveCallbackBaseUrl(request: NextRequest): string {
  const explicit =
    asNonEmptyString(process.env.MUSLIMAH_CAROUSEL_CALLBACK_BASE_URL) ||
    asNonEmptyString(process.env.NEXT_PUBLIC_APP_URL);

  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelUrl = asNonEmptyString(process.env.VERCEL_URL);
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}`;
  }

  return request.nextUrl.origin.replace(/\/+$/, "");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const collectionId = asNonEmptyString(body.collectionId) || "muslimah-health";
    const scriptModel = asNonEmptyString(body.scriptModel) || MUSLIMAH_SCRIPT_MODEL;
    const imageModel = asNonEmptyString(body.imageModel) || MUSLIMAH_IMAGE_MODEL;
    const generateImages = asBoolean(body.generateImages, true);
    const publish = asBoolean(body.publish, false);
    const script = asScript(body.script);
    const focus = asNonEmptyString(body.focus) || "";
    const previousHookBackground = asNonEmptyString(body.previousHookBackground) || undefined;
    const previousFeatures = asStringArray(body.previousFeatures);
    const referenceImagePaths = asStringArray(body.referenceImagePaths);

    if (!generateImages) {
      const previewScript = script || await generateMuslimahCarouselScript({
        scriptModel,
        focus: focus || undefined,
        previousHookBackground,
        previousFeatures,
      });

      return NextResponse.json({
        scriptModel,
        imageModel,
        imageQuality: MUSLIMAH_IMAGE_QUALITY,
        imageSize: MUSLIMAH_IMAGE_SIZE,
        generatedImages: false,
        published: false,
        script: previewScript,
      });
    }

    const createdAt = new Date().toISOString();
    const { data: job, error: insertError } = await supabase
      .from("muslimah_carousel_jobs")
      .insert({
        collection_id: collectionId,
        status: "generating",
        generation_state: {
          kind: "muslimah_carousel",
          status: "generating",
          scriptModel,
          imageModel,
          imageQuality: MUSLIMAH_IMAGE_QUALITY,
          imageSize: MUSLIMAH_IMAGE_SIZE,
          focus,
          previousHookBackground,
          previousFeatures,
          referenceImagePaths,
          publish,
          script: script || null,
          progress: 2,
          events: [
            {
              id: `${Date.now()}-queued`,
              at: createdAt,
              stage: "queued",
              message: "Job created in Vercel and queued for the Render worker.",
              level: "info",
              progress: 1,
              slideNumber: null,
              elapsedMs: null,
              details: {
                scriptModel,
                imageModel,
                publish,
              },
            },
            {
              id: `${Date.now()}-delegating`,
              at: createdAt,
              stage: "delegating_to_render",
              message: "Sending the job to the Render worker.",
              level: "info",
              progress: 2,
              slideNumber: null,
              elapsedMs: null,
              details: null,
            },
          ],
          created_at: createdAt,
        },
      })
      .select("id, status, created_at")
      .single();

    if (insertError || !job?.id) {
      if (insertError?.message?.toLowerCase().includes("muslimah_carousel_jobs")) {
        throw new Error(
          "Missing muslimah_carousel_jobs table. Create it in Supabase before using muslimah carousel generation."
        );
      }
      throw new Error(insertError?.message || "Failed to create muslimah carousel job.");
    }

    const workerUrl = resolveWorkerUrl();
    if (!workerUrl) {
      await markJobFailed(job.id, "Missing SOCIAL_EXTRACTOR_API_URL, EXTRACTOR_API_URL, or MUSLIMAH_CAROUSEL_WORKER_URL environment variable.");
      return NextResponse.json(
        { error: "Missing SOCIAL_EXTRACTOR_API_URL, EXTRACTOR_API_URL, or MUSLIMAH_CAROUSEL_WORKER_URL environment variable.", jobId: job.id },
        { status: 500 }
      );
    }

    const workerToken = resolveWorkerToken();
    const callbackToken = resolveCallbackToken();

    if (!callbackToken) {
      await markJobFailed(job.id, "Missing MUSLIMAH_CAROUSEL_CALLBACK_TOKEN or SOCIAL_EXTRACTOR_API_TOKEN environment variable.");
      return NextResponse.json(
        { error: "Missing MUSLIMAH_CAROUSEL_CALLBACK_TOKEN or SOCIAL_EXTRACTOR_API_TOKEN environment variable.", jobId: job.id },
        { status: 500 }
      );
    }

    const callbackUrl = `${resolveCallbackBaseUrl(request)}/api/muslimah-carousel/jobs/${encodeURIComponent(job.id)}/complete`;

    try {
      const delegateResponse = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
        },
        body: JSON.stringify({
          jobId: job.id,
          collectionId,
          scriptModel,
          imageModel,
          focus,
          previousHookBackground,
          previousFeatures,
          referenceImagePaths,
          publish,
          script,
          callbackUrl,
          callbackToken,
        }),
      });

      if (!delegateResponse.ok) {
        const payload = (await delegateResponse.json().catch(() => ({}))) as { error?: string };
        const message = payload.error || `Worker delegation failed with status ${delegateResponse.status}`;
        await markJobFailed(job.id, message);
        return NextResponse.json({ error: message, jobId: job.id }, { status: 502 });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? `Failed to delegate muslimah carousel generation: ${error.message}`
          : "Failed to delegate muslimah carousel generation.";
      await markJobFailed(job.id, message);
      return NextResponse.json({ error: message, jobId: job.id }, { status: 502 });
    }

    return NextResponse.json(
      {
        jobId: job.id,
        status: "generating",
        generatedImages: false,
        published: false,
        script: script || null,
        message: "muslimah.health carousel image generation has started on the worker.",
      },
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate muslimah.health carousel.",
      },
      { status: 500 }
    );
  }
}
