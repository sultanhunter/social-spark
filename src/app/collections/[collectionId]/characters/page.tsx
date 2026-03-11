import { AppShell } from "@/components/layout/app-shell";
import { VideoCharactersView } from "@/components/views/video-characters-view";

export default async function CharactersPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const { collectionId } = await params;

  return (
    <AppShell collectionId={collectionId}>
      <VideoCharactersView collectionId={collectionId} />
    </AppShell>
  );
}
