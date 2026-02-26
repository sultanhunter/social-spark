import { NextRequest, NextResponse } from "next/server";
import { BLOG_REASONING_MODEL } from "@/lib/blog-agent";
import { isReasoningModel } from "@/lib/reasoning-model";
import { hasBlogApiKey, listBlogPosts } from "@/lib/muslimah-blog-api";
import { supabase } from "@/lib/supabase";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeTopicHint(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

function pushUniqueTopic(target: string[], value: string) {
  const clean = normalizeTopicHint(value);
  if (!clean) return;
  const normalized = clean.toLowerCase();
  if (target.some((existing) => existing.toLowerCase() === normalized)) return;
  target.push(clean);
}

async function collectRecentTopicHints(collectionId: string): Promise<string[]> {
  const topicHints: string[] = [];

  try {
    const publishedResult = await listBlogPosts({
      status: "published",
      limit: 50,
      authMode: "optional",
    });

    for (const post of publishedResult.posts) {
      if (typeof post.title === "string") {
        pushUniqueTopic(topicHints, post.title);
      }
    }

    if (hasBlogApiKey()) {
      try {
        const draftResult = await listBlogPosts({
          status: "draft",
          limit: 50,
          authMode: "required",
        });

        for (const post of draftResult.posts) {
          if (typeof post.title === "string") {
            pushUniqueTopic(topicHints, post.title);
          }
        }
      } catch {
      }
    }
  } catch {
  }

  try {
    const { data: jobs } = await supabase
      .from("blog_generation_jobs")
      .select("generation_state")
      .eq("collection_id", collectionId)
      .order("created_at", { ascending: false })
      .limit(24);

    if (Array.isArray(jobs)) {
      for (const job of jobs) {
        const generationState =
          typeof job.generation_state === "object" && job.generation_state !== null
            ? (job.generation_state as Record<string, unknown>)
            : null;

        const topicFromState = asNonEmptyString(generationState?.topic);
        if (topicFromState) {
          pushUniqueTopic(topicHints, topicFromState);
        }

        const result =
          generationState && typeof generationState.result === "object" && generationState.result !== null
            ? (generationState.result as Record<string, unknown>)
            : null;
        const topicPlan =
          result && typeof result.topicPlan === "object" && result.topicPlan !== null
            ? (result.topicPlan as Record<string, unknown>)
            : null;
        const selectedTopic = asNonEmptyString(topicPlan?.selectedTopic);

        if (selectedTopic) {
          pushUniqueTopic(topicHints, selectedTopic);
        }
      }
    }
  } catch {
  }

  return topicHints.slice(0, 18);
}

async function markJobFailed(jobId: string, error: string) {
  await supabase
    .from("blog_generation_jobs")
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
    const focus = asNonEmptyString(body.focus) || "";

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

    const recentTopics = await collectRecentTopicHints(collectionId);
    const ramadanHeavyHistory = recentTopics.filter((topic) => /\bramadan\b/i.test(topic)).length >= 2;
    const effectiveFocus =
      focus ||
      (ramadanHeavyHistory
        ? "Choose a non-Ramadan topic with high current demand for Muslim women (period health, pregnancy, worship routines, mindset, or lifestyle implementation)."
        : "");
    const topicDiversityBrief = recentTopics.length > 0
      ? `Avoid repeating these recent topics: ${recentTopics.join(" | ")}`
      : "Prefer a fresh topic angle with non-repetitive search intent.";

    const { data: job, error: insertError } = await supabase
      .from("blog_generation_jobs")
      .insert({
        collection_id: collectionId,
        status: "generating",
        generation_state: {
          kind: "blog_agent",
          status: "generating",
          reasoningModel,
          focus: effectiveFocus,
          recentTopics,
          topicDiversityBrief,
          created_at: new Date().toISOString(),
        },
      })
      .select("id, status, created_at")
      .single();

    if (insertError || !job?.id) {
      if (insertError?.message?.toLowerCase().includes("blog_generation_jobs")) {
        throw new Error(
          "Missing blog_generation_jobs table. Create it in Supabase before using blog generation."
        );
      }
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
          focus: effectiveFocus,
          recentTopics,
          topicDiversityBrief,
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
