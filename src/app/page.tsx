import { AppShell } from "@/components/layout/app-shell";
import { StorageView } from "@/components/views/storage-view";

export default function Home() {
  return (
    <AppShell>
      <StorageView />
    </AppShell>
  );
}
