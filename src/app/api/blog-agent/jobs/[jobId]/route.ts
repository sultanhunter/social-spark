import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    const { data: job, error } = await supabase
      .from("recreated_posts")
      .select("id, status, generation_state, created_at, updated_at")
      .eq("id", jobId)
      .single();

    if (error || !job) {
      return NextResponse.json({ error: "Generation job not found." }, { status: 404 });
    }

    const generationState =
      typeof job.generation_state === "object" && job.generation_state !== null
        ? (job.generation_state as Record<string, unknown>)
        : {};

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      error: typeof generationState.error === "string" ? generationState.error : null,
      result:
        typeof generationState.result === "object" && generationState.result !== null
          ? generationState.result
          : null,
      topic:
        typeof generationState.topic === "string"
          ? generationState.topic
          : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch generation job status.",
      },
      { status: 500 }
    );
  }
}
