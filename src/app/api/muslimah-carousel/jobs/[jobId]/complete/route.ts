import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function normalizeEvent(body: Record<string, unknown>, status: "generating" | "completed" | "failed") {
  const rawEvent =
    typeof body.event === "object" && body.event !== null
      ? (body.event as Record<string, unknown>)
      : {};
  const now = new Date().toISOString();
  const level = rawEvent.level === "error" || rawEvent.level === "warning" ? rawEvent.level : "info";
  const defaultStage =
    status === "completed" ? "completed" : status === "failed" ? "failed" : "progress";
  const defaultMessage =
    status === "completed"
      ? "Carousel generation completed."
      : status === "failed"
        ? asNonEmptyString(body.error) || "Render worker failed."
        : "Render worker progress update.";

  return {
    id: asNonEmptyString(rawEvent.id) || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: asNonEmptyString(rawEvent.at) || now,
    stage: asNonEmptyString(rawEvent.stage) || defaultStage,
    message: asNonEmptyString(rawEvent.message) || defaultMessage,
    level,
    slideNumber: asFiniteNumber(rawEvent.slideNumber),
    progress: asFiniteNumber(rawEvent.progress),
    elapsedMs: asFiniteNumber(rawEvent.elapsedMs),
    details:
      typeof rawEvent.details === "object" && rawEvent.details !== null
        ? rawEvent.details
        : null,
  };
}

function appendEvent(previousState: Record<string, unknown>, event: ReturnType<typeof normalizeEvent>) {
  const previousEvents = Array.isArray(previousState.events) ? previousState.events : [];
  return [...previousEvents, event].slice(-200);
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
    const status =
      body.status === "generating"
        ? "generating"
        : body.status === "completed"
          ? "completed"
          : body.status === "failed"
            ? "failed"
            : null;

    if (!status) {
      return NextResponse.json({ error: "Callback status must be generating, completed, or failed." }, { status: 400 });
    }

    const { data: existingJob, error: fetchError } = await supabase
      .from("muslimah_carousel_jobs")
      .select("status, generation_state")
      .eq("id", jobId)
      .single();

    if (fetchError || !existingJob) {
      return NextResponse.json({ error: "Muslimah carousel job not found." }, { status: 404 });
    }

    const previousState =
      typeof existingJob.generation_state === "object" && existingJob.generation_state !== null
        ? (existingJob.generation_state as Record<string, unknown>)
        : {};
    const event = normalizeEvent(body, status);
    const events = appendEvent(previousState, event);

    if (existingJob.status === "completed" && status === "generating") {
      return NextResponse.json({ jobId, status: "completed", ignored: true, event });
    }

    const nextState =
      status === "completed"
        ? {
            ...previousState,
            kind: "muslimah_carousel",
            status,
            events,
            last_event: event,
            progress: event.progress,
            result:
              typeof body.result === "object" && body.result !== null
                ? body.result
                : null,
            completed_at: new Date().toISOString(),
          }
        : status === "generating"
          ? {
              ...previousState,
              kind: "muslimah_carousel",
              status,
              events,
              last_event: event,
              progress: event.progress,
            }
        : {
            ...previousState,
            kind: "muslimah_carousel",
            status,
            events,
            last_event: event,
            progress: event.progress,
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

    return NextResponse.json({ jobId, status, event });
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
