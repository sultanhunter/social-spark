"use client";

import { useState } from "react";
import { FolderPlus } from "lucide-react";
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

export function AddCollectionModal() {
  const { isAddCollectionOpen, setAddCollectionOpen, addCollection, setActiveCollection } =
    useAppStore();
  const [name, setName] = useState("");
  const [appName, setAppName] = useState("");
  const [appDescription, setAppDescription] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!name.trim() || !appName.trim() || !appDescription.trim()) {
      setError("Collection name, app name, and app description are required");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          appName: appName.trim(),
          appDescription: appDescription.trim(),
          description: description.trim() || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create collection");
      }

      const collection = await response.json();
      addCollection(collection);
      setActiveCollection(collection);
      resetForm();
      setAddCollectionOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setName("");
    setAppName("");
    setAppDescription("");
    setDescription("");
    setError("");
  };

  return (
    <Dialog
      open={isAddCollectionOpen}
      onOpenChange={(open) => {
        setAddCollectionOpen(open);
        if (!open) resetForm();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Collection</DialogTitle>
          <DialogDescription>
            Create a collection for one of your apps. All saved posts and
            recreated content will be organized here.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
              Collection Name
            </label>
            <Input
              placeholder="e.g., Product Launch Campaign"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
              App Name
            </label>
            <Input
              placeholder="e.g., My SaaS App"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
            />
            <p className="text-xs text-zinc-500">
              The app you want to create content for
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
              App Description
            </label>
            <Input
              placeholder="Describe what your app does, key features, target audience..."
              value={appDescription}
              onChange={(e) => setAppDescription(e.target.value)}
            />
            <p className="text-xs text-zinc-500">
              Help AI understand your app context for better content recreation
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
              Description <span className="text-zinc-500">(optional)</span>
            </label>
            <Input
              placeholder="What is this collection for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
              {error}
            </p>
          )}

          <Button
            variant="primary"
            className="w-full"
            onClick={handleSubmit}
            isLoading={isLoading}
          >
            <FolderPlus className="w-4 h-4 mr-2" />
            {isLoading ? "Creating..." : "Create Collection"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
