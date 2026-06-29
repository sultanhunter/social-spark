import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    const { data: job, error } = await supabase
      .from("muslimah_carousel_jobs")
      .select("id, collection_id, status, generation_state, created_at, updated_at")
      .eq("id", jobId)
      .single();

    if (error || !job) {
      return NextResponse.json({ error: "Muslimah carousel job not found." }, { status: 404 });
    }

    const generationState =
      typeof job.generation_state === "object" && job.generation_state !== null
        ? (job.generation_state as Record<string, unknown>)
        : {};

    return NextResponse.json({
      jobId: job.id,
      collectionId: job.collection_id,
      status: job.status,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      error: typeof generationState.error === "string" ? generationState.error : null,
      events: Array.isArray(generationState.events) ? generationState.events : [],
      lastEvent:
        typeof generationState.last_event === "object" && generationState.last_event !== null
          ? generationState.last_event
          : null,
      progress:
        typeof generationState.progress === "number" && Number.isFinite(generationState.progress)
          ? generationState.progress
          : null,
      result:
        typeof generationState.result === "object" && generationState.result !== null
          ? generationState.result
          : null,
      script:
        typeof generationState.script === "object" && generationState.script !== null
          ? generationState.script
          : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch muslimah carousel job status.",
      },
      { status: 500 }
    );
  }
}
