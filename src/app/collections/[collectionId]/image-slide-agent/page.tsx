import { AppShell } from "@/components/layout/app-shell";
import { ImageSlideAgentView } from "@/components/views/image-slide-agent-view";

export default async function ImageSlideAgentPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const { collectionId } = await params;

  return (
    <AppShell collectionId={collectionId}>
      <ImageSlideAgentView collectionId={collectionId} />
    </AppShell>
  );
}
