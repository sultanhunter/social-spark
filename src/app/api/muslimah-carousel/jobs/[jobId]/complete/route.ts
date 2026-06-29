import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveCallbackToken(): string | null {
  return (
    asNonEmptyString(process.env.MUSLIMAH_CAROUSEL_CALLBACK_TOKEN) ||
    asNonEmptyString(process.env.SOCIAL_EXTRACTOR_API_TOKEN) ||
    asNonEmptyString(process.env.EXTRACTOR_API_TOKEN)
  );
}

function isAuthorized(request: NextRequest): boolean {
  const expectedToken = resolveCallbackToken();
  if (!expectedToken) return false;

  const header = request.headers.get("authorization") || "";
  const providedToken = header.replace(/^Bearer\s+/i, "").trim();
  return providedToken === expectedToken;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized callback." }, { status: 401 });
    }

    const { jobId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const status = body.status === "completed" ? "completed" : body.status === "failed" ? "failed" : null;

    if (!status) {
      return NextResponse.json({ error: "Callback status must be completed or failed." }, { status: 400 });
    }

    const { data: existingJob, error: fetchError } = await supabase
      .from("muslimah_carousel_jobs")
      .select("generation_state")
      .eq("id", jobId)
      .single();

    if (fetchError || !existingJob) {
      return NextResponse.json({ error: "Muslimah carousel job not found." }, { status: 404 });
    }

    const previousState =
      typeof existingJob.generation_state === "object" && existingJob.generation_state !== null
        ? (existingJob.generation_state as Record<string, unknown>)
        : {};

    const nextState =
      status === "completed"
        ? {
            ...previousState,
            kind: "muslimah_carousel",
            status,
            result:
              typeof body.result === "object" && body.result !== null
                ? body.result
                : null,
            completed_at: new Date().toISOString(),
          }
        : {
            ...previousState,
            kind: "muslimah_carousel",
            status,
            error: asNonEmptyString(body.error) || "Render worker failed.",
            failed_at: new Date().toISOString(),
          };

    const { error: updateError } = await supabase
      .from("muslimah_carousel_jobs")
      .update({
        status,
        generation_state: nextState,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    if (updateError) throw updateError;

    return NextResponse.json({ jobId, status });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to complete muslimah carousel job.",
      },
      { status: 500 }
    );
  }
}
