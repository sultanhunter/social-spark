"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookMarked,
  GalleryVerticalEnd,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  Plus,
  Sparkles,
  Video,
  Pin,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { PostCard } from "@/components/posts/post-card";
import { useRouter } from "next/navigation";

export function StorageView() {
  const { activeCollection, posts, postFilter, setPostFilter, setAddPostOpen } = useAppStore();
  const [isLogoDownloading, setIsLogoDownloading] = useState(false);
  const router = useRouter();

  if (!activeCollection) {
    return <EmptyState />;
  }

  const parseFileExtension = (url: string): string => {
    try {
      const parsed = new URL(url);
      const filename = parsed.pathname.split("/").pop() || "";
      const ext = filename.includes(".") ? filename.split(".").pop() || "" : "";
      if (/^[a-zA-Z0-9]{2,5}$/.test(ext)) return ext.toLowerCase();
    } catch {
      // Ignore URL parse failures
    }

    return "png";
  };

  const toFileSlug = (value: string): string =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

  const handleDownloadLogo = async () => {
    if (!activeCollection.logo || isLogoDownloading) return;

    setIsLogoDownloading(true);

    try {
      const ext = parseFileExtension(activeCollection.logo);
      const baseName = toFileSlug(activeCollection.name || "collection") || "collection";
      const filename = `${baseName}-logo.${ext}`;
      const proxyUrl = `/api/media/download?url=${encodeURIComponent(activeCollection.logo)}&filename=${encodeURIComponent(filename)}`;

      const response = await fetch(proxyUrl);
      if (!response.ok) {
        throw new Error("Failed to download logo");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error("Failed to download logo:", err);
    } finally {
      setIsLogoDownloading(false);
    }
  };

  const filteredPosts = postFilter === "all" ? posts : posts.filter((post) => post.post_type === postFilter);
  const slidesCount = posts.filter((post) => post.post_type === "image_slides").length;
  const videosCount = posts.filter((post) => post.post_type === "short_video").length;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 md:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              {activeCollection.logo ? (
                <button
                  type="button"
                  onClick={handleDownloadLogo}
                  disabled={isLogoDownloading}
                  aria-label="Download collection logo"
                  title="Download logo"
                  className={`group relative h-14 w-14 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${
                    isLogoDownloading ? "opacity-70" : "hover:border-rose-300"
                  }`}
                >
                  <img
                    src={activeCollection.logo}
                    alt={`${activeCollection.name} logo`}
                    className="h-full w-full object-cover"
                  />
                  <span
                    className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-900/40 text-[10px] font-semibold uppercase tracking-wide text-white transition-opacity ${
                      isLogoDownloading ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    {isLogoDownloading ? "Downloading..." : "Download"}
                  </span>
                </button>
              ) : null}
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{activeCollection.name}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {activeCollection.app_name} · {posts.length} saved posts
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => router.push(`/collections/${activeCollection.id}/carousel-agent`)}
              >
                <GalleryVerticalEnd className="mr-2 h-4 w-4" />
                Carousel Agent
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push(`/collections/${activeCollection.id}/blog-agent`)}
              >
                <BookMarked className="mr-2 h-4 w-4" />
                Blog Agent
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push(`/collections/${activeCollection.id}/pinterest-agent`)}
              >
                <Pin className="mr-2 h-4 w-4" />
                Pinterest Agent
              </Button>
              <Button variant="primary" onClick={() => setAddPostOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Save Post
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <FilterButton label="All" count={posts.length} isActive={postFilter === "all"} onClick={() => setPostFilter("all")} icon={<LayoutGrid className="h-4 w-4" />} />
            <FilterButton label="Slides" count={slidesCount} isActive={postFilter === "image_slides"} onClick={() => setPostFilter("image_slides")} icon={<ImageIcon className="h-4 w-4" />} />
            <FilterButton label="Videos" count={videosCount} isActive={postFilter === "short_video"} onClick={() => setPostFilter("short_video")} icon={<Video className="h-4 w-4" />} />
          </div>
        </motion.div>

        {filteredPosts.length === 0 ? (
          <NoPostsState onAddPost={() => setAddPostOpen(true)} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredPosts.map((post, index) => (
              <PostCard key={post.id} post={post} index={index} collectionId={activeCollection.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterButton({
  label,
  count,
  isActive,
  onClick,
  icon,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
        isActive ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{count}</span>
    </button>
  );
}

function EmptyState() {
  const { setAddCollectionOpen } = useAppStore();

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
          <Sparkles className="h-7 w-7" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome to SocialSpark</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Create a collection for your app, save standout social posts, and turn them into reusable recreation workflows.
        </p>
        <Button variant="primary" size="lg" className="mt-6" onClick={() => setAddCollectionOpen(true)}>
          Create Your First Collection
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function NoPostsState({ onAddPost }: { onAddPost: () => void }) {
  return (
    <CardBlock>
      <FolderOpen className="mx-auto mb-3 h-8 w-8 text-slate-400" />
      <h3 className="text-lg font-semibold text-slate-900">No posts saved yet</h3>
      <p className="mt-1 text-sm text-slate-600">Add links from Instagram, TikTok, YouTube, or X to build your recreation queue.</p>
      <Button variant="outline" className="mt-5" onClick={onAddPost}>
        <Plus className="mr-2 h-4 w-4" />
        Save First Post
      </Button>
    </CardBlock>
  );
}

function CardBlock({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">{children}</div>;
}
