import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const STALE_GENERATION_THRESHOLD_MS = 6 * 60 * 1000;

type RecreatedHistoryRow = {
  id: string;
  status: string;
  updated_at: string;
  generated_media_urls?: unknown;
  generation_state?: unknown;
  slide_plans?: unknown;
};

function normalizeMediaUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function expectedAssetCount(slidePlans: unknown): number {
  if (!Array.isArray(slidePlans)) return 0;

  let count = 0;

  for (const rawPlan of slidePlans) {
    const plan = asRecord(rawPlan);
    if (!plan) continue;

    const prompts = Array.isArray(plan.assetPrompts) ? plan.assetPrompts : [];
    count += prompts.length > 0 ? prompts.length : 1;
  }

  return count;
}

function isStaleGeneratingStatus(updatedAt: string): boolean {
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return true;
  return Date.now() - updatedMs > STALE_GENERATION_THRESHOLD_MS;
}

async function reconcileStaleGeneratingRows({
  rows,
  collectionId,
  postId,
  includeGenerationState,
}: {
  rows: RecreatedHistoryRow[];
  collectionId: string;
  postId: string;
  includeGenerationState: boolean;
}): Promise<boolean> {
  const staleRows = rows.filter((row) => row.status === "generating" && isStaleGeneratingStatus(row.updated_at));
  if (staleRows.length === 0) return false;

  let didUpdateAnyRow = false;

  for (const row of staleRows) {
    const generatedCount = normalizeMediaUrls(row.generated_media_urls).length;
    const expectedCount = expectedAssetCount(row.slide_plans);

    const isComplete = expectedCount > 0 ? generatedCount >= expectedCount : generatedCount > 0;
    const nextStatus: "completed" | "failed" = isComplete ? "completed" : "failed";

    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      updated_at: new Date().toISOString(),
    };

    if (includeGenerationState) {
      const previousState = asRecord(row.generation_state) || {};
      updatePayload.generation_state = {
        ...previousState,
        stage: nextStatus,
        staleGenerationRecovered: true,
        completedSlides: generatedCount,
        totalSlides: expectedCount > 0 ? expectedCount : previousState.totalSlides,
        error:
          nextStatus === "failed"
            ? `Generation timed out before finishing. ${generatedCount}/${expectedCount || "?"} assets were generated.`
            : null,
      };
    }

    const { error } = await supabase
      .from("recreated_posts")
      .update(updatePayload)
      .eq("id", row.id)
      .eq("collection_id", collectionId)
      .eq("original_post_id", postId);

    if (error) {
      console.error("[recreate/history] failed to reconcile stale generation status", {
        recreatedPostId: row.id,
        error: error.message,
      });
      continue;
    }

    didUpdateAnyRow = true;
  }

  return didUpdateAnyRow;
}

async function fetchHistoryRows(
  collectionId: string,
  postId: string,
  includeGenerationState: boolean
) {
  if (includeGenerationState) {
    return supabase
      .from("recreated_posts")
      .select("id,script,generated_media_urls,caption,status,generation_state,slide_plans,created_at,updated_at")
      .eq("collection_id", collectionId)
      .eq("original_post_id", postId)
      .order("created_at", { ascending: false });
  }

  return supabase
    .from("recreated_posts")
    .select("id,script,generated_media_urls,caption,status,slide_plans,created_at,updated_at")
    .eq("collection_id", collectionId)
    .eq("original_post_id", postId)
    .order("created_at", { ascending: false });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; postId: string }> }
) {
  try {
    const { collectionId, postId } = await params;

    const primaryQuery = await fetchHistoryRows(collectionId, postId, true);

    if (!primaryQuery.error) {
      const primaryRows = Array.isArray(primaryQuery.data)
        ? (primaryQuery.data as RecreatedHistoryRow[])
        : [];

      const didReconcile = await reconcileStaleGeneratingRows({
        rows: primaryRows,
        collectionId,
        postId,
        includeGenerationState: true,
      });

      if (!didReconcile) {
        return NextResponse.json(primaryQuery.data);
      }

      const refreshedPrimary = await fetchHistoryRows(collectionId, postId, true);
      if (refreshedPrimary.error) throw refreshedPrimary.error;
      return NextResponse.json(refreshedPrimary.data);
    }

    if (!/generation_state/i.test(primaryQuery.error.message || "")) {
      throw primaryQuery.error;
    }

    const fallbackQuery = await fetchHistoryRows(collectionId, postId, false);

    if (fallbackQuery.error) throw fallbackQuery.error;

    const fallbackRows = Array.isArray(fallbackQuery.data)
      ? (fallbackQuery.data as RecreatedHistoryRow[])
      : [];

    const didReconcile = await reconcileStaleGeneratingRows({
      rows: fallbackRows,
      collectionId,
      postId,
      includeGenerationState: false,
    });

    if (!didReconcile) {
      return NextResponse.json(fallbackQuery.data);
    }

    const refreshedFallback = await fetchHistoryRows(collectionId, postId, false);
    if (refreshedFallback.error) throw refreshedFallback.error;
    return NextResponse.json(refreshedFallback.data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch recreation history" },
      { status: 500 }
    );
  }
}
