"use client";

import { Menu, Search, Bell, ChevronRight, Plus, Link2, Sparkles } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/modal";
import { DEFAULT_REASONING_MODEL } from "@/lib/reasoning-model";

export function Header() {
  const pathname = usePathname();
  const { toggleSidebar, activeCollection, posts } = useAppStore();
  const [isAddVideoOpen, setIsAddVideoOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoNotes, setVideoNotes] = useState("");
  const [isSubmittingVideo, setIsSubmittingVideo] = useState(false);
  const [videoError, setVideoError] = useState("");

  const routeContext = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    const isVideoAgentRoute = parts[0] === "collections" && parts[2] === "video-agent";
    const collectionId = isVideoAgentRoute ? parts[1] : null;
    return { isVideoAgentRoute, collectionId };
  }, [pathname]);

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

  const resetVideoModal = () => {
    setVideoUrl("");
    setVideoNotes("");
    setVideoError("");
  };

  const handleAddVideo = async () => {
    if (!routeContext.collectionId) {
      setVideoError("No collection selected.");
      return;
    }

    if (!videoUrl.trim()) {
      setVideoError("Paste a valid video URL.");
      return;
    }

    setIsSubmittingVideo(true);
    setVideoError("");

    try {
      const response = await fetch("/api/video-agent/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId: routeContext.collectionId,
          url: videoUrl.trim(),
          userNotes: videoNotes.trim() || null,
          reasoningModel: DEFAULT_REASONING_MODEL,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to add video.");
      }

      window.dispatchEvent(
        new CustomEvent("video-agent:source-added", {
          detail: {
            formatId: data?.format?.id || null,
            videoId: data?.video?.id || null,
          },
        })
      );

      setIsAddVideoOpen(false);
      resetVideoModal();
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : "Failed to add video.");
    } finally {
      setIsSubmittingVideo(false);
    }
  };

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
          {routeContext.isVideoAgentRoute ? (
            <Button variant="primary" size="sm" onClick={() => setIsAddVideoOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Video
            </Button>
          ) : null}

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

      <Dialog
        open={isAddVideoOpen}
        onOpenChange={(open) => {
          setIsAddVideoOpen(open);
          if (!open) resetVideoModal();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Source Video</DialogTitle>
            <DialogDescription>
              Paste a social URL to analyze and auto-group into a matching format.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 p-6 pt-4">
            <Input
              icon={<Link2 className="h-4 w-4" />}
              placeholder="https://..."
              value={videoUrl}
              onChange={(event) => {
                setVideoUrl(event.target.value);
                setVideoError("");
              }}
            />

            <textarea
              value={videoNotes}
              onChange={(event) => setVideoNotes(event.target.value)}
              rows={3}
              placeholder="Optional notes..."
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
            />

            {videoError ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {videoError}
              </p>
            ) : null}

            <Button variant="primary" className="w-full" onClick={handleAddVideo} isLoading={isSubmittingVideo}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              {isSubmittingVideo ? "Analyzing..." : "Analyze & Add"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
