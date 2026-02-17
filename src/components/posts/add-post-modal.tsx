"use client";

import { useState } from "react";
import { Link, Instagram, Youtube, Twitter, Plus, X, Image as ImageIcon } from "lucide-react";
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
            <label className="text-sm font-medium text-slate-700">
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
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <PlatformIcon platform={platform} />
                <span>Detected: {platform.charAt(0).toUpperCase() + platform.slice(1)}</span>
              </div>
            )}
          </div>

          {/* Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">
              Title <span className="text-slate-400">(optional)</span>
            </label>
            <Input
              placeholder="Give this post a name..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">
              Description <span className="text-slate-400">(optional)</span>
            </label>
            <Input
              placeholder="Describe what makes this post interesting..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Manual Image URLs */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <ImageIcon className="w-4 h-4" />
              Image URLs <span className="text-slate-400">(for Instagram/TikTok slides)</span>
            </label>
            <p className="text-xs text-slate-500">
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
                  <div key={index} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <span className="flex-1 truncate text-xs text-slate-600">
                      {index + 1}. {imgUrl.substring(0, 50)}...
                    </span>
                    <button
                      onClick={() => removeImageUrl(index)}
                      className="text-slate-400 hover:text-rose-600"
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
            <label className="text-sm font-medium text-slate-700">
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
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
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
          ? "border-rose-300 bg-rose-50"
          : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <p className={`text-sm font-medium ${isActive ? "text-rose-700" : "text-slate-700"}`}>
        {label}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{description}</p>
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
