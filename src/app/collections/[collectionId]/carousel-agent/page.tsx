import { AppShell } from "@/components/layout/app-shell";
import { CarouselAgentView } from "@/components/views/carousel-agent-view";

export default async function CarouselAgentPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const { collectionId } = await params;

  return (
    <AppShell collectionId={collectionId}>
      <CarouselAgentView collectionId={collectionId} />
    </AppShell>
  );
}
