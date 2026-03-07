import { AppShell } from "@/components/layout/app-shell";
import { VideoAgentView } from "@/components/views/video-agent-view";

export default async function VideoAgentPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const { collectionId } = await params;

  return (
    <AppShell collectionId={collectionId}>
      <VideoAgentView collectionId={collectionId} />
    </AppShell>
  );
}
