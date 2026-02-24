import { AppShell } from "@/components/layout/app-shell";
import { BlogAgentView } from "@/components/views/blog-agent-view";

export default async function BlogAgentPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const { collectionId } = await params;

  return (
    <AppShell collectionId={collectionId}>
      <BlogAgentView collectionId={collectionId} />
    </AppShell>
  );
}
