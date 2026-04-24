import { AppShell } from "@/components/layout/app-shell";
import { GptSlideAgentView } from "@/components/views/gpt-slide-agent-view";

export default async function GptSlideAgentPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const { collectionId } = await params;

  return (
    <AppShell collectionId={collectionId}>
      <GptSlideAgentView collectionId={collectionId} />
    </AppShell>
  );
}
