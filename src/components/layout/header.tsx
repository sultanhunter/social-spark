"use client";

import { Menu, Search, Bell, ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { Input } from "@/components/ui/input";
import { useMemo } from "react";
import { usePathname } from "next/navigation";

export function Header() {
  const pathname = usePathname();
  const { toggleSidebar, activeCollection, posts } = useAppStore();

  const locationLabel = useMemo(() => {
    const pathParts = pathname.split("/").filter(Boolean);
    const collectionId = pathParts[0] === "collections" ? pathParts[1] : null;
    const postId = pathParts[2] === "posts" ? pathParts[3] : null;

    if (!collectionId) return "No collection selected";

    const collectionName = activeCollection?.name || "Collection";
    if (!postId) return collectionName;

    const postTitle = posts.find((post) => post.id === postId)?.title || "Post details";
    return `${collectionName} / ${postTitle}`;
  }, [activeCollection, pathname, posts]);

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
      <div className="flex h-full items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex items-center gap-4">
          <button
            onClick={toggleSidebar}
            className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 sm:flex">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Workspace</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            <span className="max-w-[320px] truncate text-sm font-medium text-slate-700">{locationLabel}</span>
          </div>
        </div>

        <div className="flex-1 max-w-md">
          <Input
            placeholder="Search posts..."
            icon={<Search className="w-4 h-4" />}
            className="bg-white"
          />
        </div>

        <div className="flex items-center gap-2">
          {activeCollection ? (
            <span className="hidden rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 md:inline-flex">
              {activeCollection.app_name}
            </span>
          ) : null}
          <button className="relative rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
            <Bell className="w-5 h-5" />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500" />
          </button>
          <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-medium text-white">
            U
          </div>
        </div>
      </div>
    </header>
  );
}
