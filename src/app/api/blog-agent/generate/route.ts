import { NextRequest, NextResponse } from "next/server";
import { BLOG_REASONING_MODEL } from "@/lib/blog-agent";
import { isReasoningModel } from "@/lib/reasoning-model";
import { supabase } from "@/lib/supabase";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function markJobFailed(jobId: string, error: string) {
  await supabase
    .from("recreated_posts")
    .update({
      status: "failed",
      generation_state: {
        kind: "blog_agent",
        status: "failed",
        error,
        failed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const collectionId = asNonEmptyString(body.collectionId);
    const reasoningModel = isReasoningModel(body.reasoningModel)
      ? body.reasoningModel
      : BLOG_REASONING_MODEL;

    if (!collectionId) {
      return NextResponse.json({ error: "Collection ID is required." }, { status: 400 });
    }

    const { data: collection, error: collectionError } = await supabase
      .from("collections")
      .select("id")
      .eq("id", collectionId)
      .single();

    if (collectionError || !collection) {
      return NextResponse.json({ error: "Collection not found." }, { status: 404 });
    }

    const { data: job, error: insertError } = await supabase
      .from("recreated_posts")
      .insert({
        original_post_id: null,
        collection_id: collectionId,
        script: "BLOG_AGENT_JOB",
        generated_media_urls: [],
        status: "generating",
        generation_state: {
          kind: "blog_agent",
          status: "generating",
          reasoningModel,
          created_at: new Date().toISOString(),
        },
      })
      .select("id, status, created_at")
      .single();

    if (insertError || !job?.id) {
      throw new Error(insertError?.message || "Failed to create generation job.");
    }

    const workerUrl = asNonEmptyString(process.env.BLOG_AGENT_WORKER_URL);
    if (!workerUrl) {
      await markJobFailed(job.id, "Missing BLOG_AGENT_WORKER_URL environment variable.");
      return NextResponse.json(
        { error: "Missing BLOG_AGENT_WORKER_URL environment variable." },
        { status: 500 }
      );
    }

    const workerToken = asNonEmptyString(process.env.BLOG_AGENT_WORKER_TOKEN);

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
          reasoningModel,
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
        error instanceof Error ? `Failed to delegate generation: ${error.message}` : "Failed to delegate generation.";
      await markJobFailed(job.id, message);
      return NextResponse.json({ error: message, jobId: job.id }, { status: 502 });
    }

    return NextResponse.json(
      {
        jobId: job.id,
        status: "generating",
        message: "Blog generation has started in the background.",
      },
      { status: 202 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to start blog generation job.",
      },
      { status: 500 }
    );
  }
}
