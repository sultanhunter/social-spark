import { AppShell } from "@/components/layout/app-shell";
import { MuslimahCarouselView } from "@/components/views/muslimah-carousel-view";

export default async function MuslimahCarouselPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const { collectionId } = await params;

  return (
    <AppShell collectionId={collectionId}>
      <MuslimahCarouselView collectionId={collectionId} />
    </AppShell>
  );
}
