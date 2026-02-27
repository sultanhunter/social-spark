import { AppShell } from "@/components/layout/app-shell";
import { PinterestAgentView } from "@/components/views/pinterest-agent-view";

export default async function PinterestAgentPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const { collectionId } = await params;

  return (
    <AppShell collectionId={collectionId}>
      <PinterestAgentView collectionId={collectionId} />
    </AppShell>
  );
}
