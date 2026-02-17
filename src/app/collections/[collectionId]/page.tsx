import { AppShell } from "@/components/layout/app-shell";
import { StorageView } from "@/components/views/storage-view";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const { collectionId } = await params;

  return (
    <AppShell collectionId={collectionId}>
      <StorageView />
    </AppShell>
  );
}
