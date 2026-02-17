"use client";

import { useState } from "react";
import { Link, Instagram, Youtube, Twitter, Plus, X, Image } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractPlatform } from "@/lib/utils";

export function AddPostModal() {
  const { isAddPostOpen, setAddPostOpen, activeCollection, addPost } =
    useAppStore();
  const [url, setUrl] = useState("");
  const [postType, setPostType] = useState<"image_slides" | "short_video">("image_slides");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const addImageUrl = () => {
    if (newImageUrl.trim() && !imageUrls.includes(newImageUrl.trim())) {
      setImageUrls([...imageUrls, newImageUrl.trim()]);
      setNewImageUrl("");
    }
  };

  const removeImageUrl = (index: number) => {
    setImageUrls(imageUrls.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!url.trim()) {
      setError("Please enter a valid URL");
      return;
    }
    if (!activeCollection) {
      setError("Please select a collection first");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/posts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          collectionId: activeCollection.id,
          postType,
          title: title.trim() || null,
          description: description.trim() || null,
          imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save post");
      }

      const savedPost = await response.json();
      addPost(savedPost);
      resetForm();
      setAddPostOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setUrl("");
    setTitle("");
    setDescription("");
    setImageUrls([]);
    setNewImageUrl("");
    setError("");
  };

  const platform = url ? extractPlatform(url) : null;

  return (
    <Dialog open={isAddPostOpen} onOpenChange={(open) => {
      setAddPostOpen(open);
      if (!open) resetForm();
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save a Post</DialogTitle>
          <DialogDescription>
            Paste a link from any social media platform to save and analyze the post.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-5">
          {/* URL Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
              Post URL
            </label>
            <Input
              placeholder="https://instagram.com/p/..."
              icon={<Link className="w-4 h-4" />}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError("");
              }}
            />
            {platform && platform !== "unknown" && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <PlatformIcon platform={platform} />
                <span>Detected: {platform.charAt(0).toUpperCase() + platform.slice(1)}</span>
              </div>
            )}
          </div>

          {/* Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
              Title <span className="text-zinc-500">(optional)</span>
            </label>
            <Input
              placeholder="Give this post a name..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
              Description <span className="text-zinc-500">(optional)</span>
            </label>
            <Input
              placeholder="Describe what makes this post interesting..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Manual Image URLs */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
              <Image className="w-4 h-4" />
              Image URLs <span className="text-zinc-500">(for Instagram/TikTok slides)</span>
            </label>
            <p className="text-xs text-zinc-500">
              Instagram blocks auto-download. Right-click images → Copy image address and paste here.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="https://..."
                value={newImageUrl}
                onChange={(e) => setNewImageUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addImageUrl())}
              />
              <Button variant="secondary" onClick={addImageUrl} className="shrink-0">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {imageUrls.length > 0 && (
              <div className="space-y-2 mt-2">
                {imageUrls.map((imgUrl, index) => (
                  <div key={index} className="flex items-center gap-2 bg-zinc-800/50 rounded-lg px-3 py-2">
                    <span className="text-xs text-zinc-400 truncate flex-1">
                      {index + 1}. {imgUrl.substring(0, 50)}...
                    </span>
                    <button
                      onClick={() => removeImageUrl(index)}
                      className="text-zinc-500 hover:text-red-400"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Post Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
              Post Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              <TypeOption
                label="Image Slides"
                description="Carousel or static images"
                isActive={postType === "image_slides"}
                onClick={() => setPostType("image_slides")}
              />
              <TypeOption
                label="Short Video"
                description="Reels, TikTok, Shorts"
                isActive={postType === "short_video"}
                onClick={() => setPostType("short_video")}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
              {error}
            </p>
          )}

          {/* Submit */}
          <Button
            variant="primary"
            className="w-full"
            onClick={handleSubmit}
            isLoading={isLoading}
          >
            {isLoading ? "Downloading & Saving..." : "Save Post"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TypeOption({
  label,
  description,
  isActive,
  onClick,
}: {
  label: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-xl border text-left transition-all ${
        isActive
          ? "border-blue-500/50 bg-blue-500/10 shadow-lg shadow-blue-500/5"
          : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
      }`}
    >
      <p className={`text-sm font-medium ${isActive ? "text-blue-400" : "text-zinc-300"}`}>
        {label}
      </p>
      <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
    </button>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  switch (platform) {
    case "instagram":
      return <Instagram className="w-3.5 h-3.5 text-pink-400" />;
    case "youtube":
      return <Youtube className="w-3.5 h-3.5 text-red-400" />;
    case "twitter":
      return <Twitter className="w-3.5 h-3.5 text-blue-400" />;
    default:
      return null;
  }
}
