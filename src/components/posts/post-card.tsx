"use client";

import { motion } from "framer-motion";
import { Play, Image as ImageIcon, ExternalLink, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { SavedPost } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface PostCardProps {
  post: SavedPost;
  index: number;
  collectionId: string;
}

export function PostCard({ post, index, collectionId }: PostCardProps) {
  const router = useRouter();
  const previewUrl = post.thumbnail_url || post.media_urls?.[0] || null;

  const platformVariant = {
    instagram: "instagram",
    tiktok: "tiktok",
    threads: "threads",
    youtube: "youtube",
    twitter: "twitter",
    unknown: "default",
  } as const;

  const openDetails = () => {
    router.push(`/collections/${collectionId}/posts/${post.id}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      onClick={openDetails}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="relative aspect-square overflow-hidden bg-slate-100">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={post.title || "Post thumbnail"}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-100">
            {post.post_type === "short_video" ? (
              <Play className="h-10 w-10 text-slate-400" />
            ) : (
              <ImageIcon className="h-10 w-10 text-slate-400" />
            )}
          </div>
        )}

        <div className="absolute left-3 top-3">
          <Badge variant={post.post_type === "image_slides" ? "slides" : "video"}>
            {post.post_type === "image_slides" ? "Slides" : "Video"}
          </Badge>
        </div>

        <div className="absolute right-3 top-3">
          <Badge variant={platformVariant[post.platform]}>
            {post.platform.charAt(0).toUpperCase() + post.platform.slice(1)}
          </Badge>
        </div>

        <div className="absolute inset-x-3 bottom-3 flex translate-y-2 gap-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <button
            onClick={(event) => {
              event.stopPropagation();
              openDetails();
            }}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            <ArrowRight className="w-4 h-4" />
            Open Details
          </button>
          <a
            href={post.original_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="rounded-xl border border-white/40 bg-white/90 p-2.5 text-slate-700 transition hover:bg-white"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      <div className="p-4">
        <h3 className="mb-1 truncate text-sm font-semibold text-slate-900">
          {post.title || "Untitled Post"}
        </h3>
        <p className="text-xs text-slate-500">{formatDate(post.created_at)}</p>
      </div>
    </motion.div>
  );
}
