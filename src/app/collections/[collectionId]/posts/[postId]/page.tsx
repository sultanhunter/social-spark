import { AppShell } from "@/components/layout/app-shell";
import { PostDetailView } from "@/components/views/post-detail-view";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ collectionId: string; postId: string }>;
}) {
  const { collectionId, postId } = await params;

  return (
    <AppShell collectionId={collectionId}>
      <PostDetailView postId={postId} />
    </AppShell>
  );
}
