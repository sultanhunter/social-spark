"use client";

import { motion } from "framer-motion";
import {
  Plus,
  Image,
  Video,
  LayoutGrid,
  Filter,
  SlidersHorizontal,
  FolderOpen,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { PostCard } from "@/components/posts/post-card";
import { Badge } from "@/components/ui/badge";

export function StorageView() {
  const { activeCollection, posts, postFilter, setPostFilter, setAddPostOpen } =
    useAppStore();

  const filteredPosts =
    postFilter === "all"
      ? posts
      : posts.filter((p) => p.post_type === postFilter);

  const slidesCount = posts.filter((p) => p.post_type === "image_slides").length;
  const videoCount = posts.filter((p) => p.post_type === "short_video").length;

  if (!activeCollection) {
    return <EmptyState />;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Collection Header */}
      <div className="px-8 pt-8 pb-6">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start justify-between"
        >
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-white tracking-tight">
                {activeCollection.name}
              </h2>
              {activeCollection.github_repo && (
                <Badge variant="success">Repo Connected</Badge>
              )}
            </div>
            <p className="text-sm text-zinc-400">
              {activeCollection.app_name} &middot; {posts.length} posts saved
            </p>
          </div>
          <Button variant="primary" onClick={() => setAddPostOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Save Post
          </Button>
        </motion.div>

        {/* Stats Bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex items-center gap-3 mt-6"
        >
          <div className="flex items-center gap-4 bg-zinc-900/50 rounded-xl p-1 border border-zinc-800/50">
            <FilterButton
              icon={<LayoutGrid className="w-4 h-4" />}
              label="All"
              count={posts.length}
              isActive={postFilter === "all"}
              onClick={() => setPostFilter("all")}
            />
            <FilterButton
              icon={<Image className="w-4 h-4" />}
              label="Slides"
              count={slidesCount}
              isActive={postFilter === "image_slides"}
              onClick={() => setPostFilter("image_slides")}
            />
            <FilterButton
              icon={<Video className="w-4 h-4" />}
              label="Videos"
              count={videoCount}
              isActive={postFilter === "short_video"}
              onClick={() => setPostFilter("short_video")}
            />
          </div>
        </motion.div>
      </div>

      {/* Posts Grid */}
      <div className="px-8 pb-8">
        {filteredPosts.length === 0 ? (
          <NoPostsState onAddPost={() => setAddPostOpen(true)} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredPosts.map((post, index) => (
              <PostCard key={post.id} post={post} index={index} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterButton({
  icon,
  label,
  count,
  isActive,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
        isActive
          ? "bg-zinc-800 text-white shadow-sm"
          : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {icon}
      {label}
      <span
        className={`text-xs px-1.5 py-0.5 rounded-md ${
          isActive ? "bg-zinc-700 text-zinc-200" : "bg-zinc-800/50 text-zinc-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function EmptyState() {
  const { setAddCollectionOpen } = useAppStore();

  return (
    <div className="flex-1 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center max-w-md"
      >
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 border border-blue-500/10 flex items-center justify-center mx-auto mb-6">
          <Sparkles className="w-10 h-10 text-blue-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-3">
          Welcome to SocialSpark
        </h2>
        <p className="text-zinc-400 mb-8 leading-relaxed">
          Start by creating a collection for your app. Save social media posts
          you love, then recreate them with AI for your own brand.
        </p>
        <Button variant="primary" size="lg" onClick={() => setAddCollectionOpen(true)}>
          Create Your First Collection
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </motion.div>
    </div>
  );
}

function NoPostsState({ onAddPost }: { onAddPost: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-center py-20"
    >
      <div className="w-16 h-16 rounded-2xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center mx-auto mb-4">
        <FolderOpen className="w-8 h-8 text-zinc-600" />
      </div>
      <h3 className="text-lg font-medium text-white mb-2">No posts yet</h3>
      <p className="text-sm text-zinc-500 mb-6">
        Save posts from social media to start building your content library
      </p>
      <Button variant="secondary" onClick={onAddPost}>
        <Plus className="w-4 h-4 mr-2" />
        Save your first post
      </Button>
    </motion.div>
  );
}
