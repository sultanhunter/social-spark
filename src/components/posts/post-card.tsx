"use client";

import { motion } from "framer-motion";
import { Play, Image, MoreVertical, ExternalLink, Sparkles } from "lucide-react";
import { SavedPost } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

interface PostCardProps {
  post: SavedPost;
  index: number;
}

export function PostCard({ post, index }: PostCardProps) {
  const { setSelectedPost, setCurrentStep } = useAppStore();
  const previewUrl = post.thumbnail_url || post.media_urls?.[0] || null;

  const platformVariant = {
    instagram: "instagram",
    tiktok: "tiktok",
    youtube: "youtube",
    twitter: "twitter",
    unknown: "default",
  } as const;

  const handleRecreate = () => {
    setSelectedPost(post);
    setCurrentStep("recreation");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="group relative bg-zinc-900/50 rounded-2xl border border-zinc-800/50 overflow-hidden hover:border-zinc-700/50 transition-all duration-300 hover:shadow-xl hover:shadow-zinc-900/50"
    >
      {/* Thumbnail */}
      <div className="relative aspect-square bg-zinc-800 overflow-hidden">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={post.title || "Post thumbnail"}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
            {post.post_type === "short_video" ? (
              <Play className="w-12 h-12 text-zinc-600" />
            ) : (
              <Image className="w-12 h-12 text-zinc-600" />
            )}
          </div>
        )}

        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Type Badge */}
        <div className="absolute top-3 left-3">
          <Badge variant={post.post_type === "image_slides" ? "slides" : "video"}>
            {post.post_type === "image_slides" ? "Slides" : "Video"}
          </Badge>
        </div>

        {/* Platform Badge */}
        <div className="absolute top-3 right-3">
          <Badge variant={platformVariant[post.platform]}>
            {post.platform.charAt(0).toUpperCase() + post.platform.slice(1)}
          </Badge>
        </div>

        {/* Hover Actions */}
        <div className="absolute bottom-3 left-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
          <button
            onClick={handleRecreate}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-violet-600 text-white text-sm font-medium rounded-xl hover:from-blue-400 hover:to-violet-500 transition-all shadow-lg shadow-blue-500/25"
          >
            <Sparkles className="w-4 h-4" />
            Recreate
          </button>
          <a
            href={post.original_url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2.5 bg-zinc-800/80 backdrop-blur-sm text-white rounded-xl hover:bg-zinc-700 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="text-sm font-medium text-white truncate mb-1">
          {post.title || "Untitled Post"}
        </h3>
        <p className="text-xs text-zinc-500">{formatDate(post.created_at)}</p>
      </div>

      {/* Menu Button */}
      <button className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/40 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60 hidden">
        <MoreVertical className="w-4 h-4" />
      </button>
    </motion.div>
  );
}
