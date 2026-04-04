import { AppShell } from "@/components/layout/app-shell";
import { ImageSlideAgentPlanView } from "@/components/views/image-slide-agent-plan-view";

export default async function ImageSlideAgentPlanPage({
  params,
}: {
  params: Promise<{ collectionId: string; planId: string }>;
}) {
  const { collectionId, planId } = await params;

  return (
    <AppShell collectionId={collectionId}>
      <ImageSlideAgentPlanView collectionId={collectionId} planId={planId} />
    </AppShell>
  );
}
