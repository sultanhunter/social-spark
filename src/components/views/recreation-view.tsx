"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  Image,
  Video,
  Github,
  Brain,
  Wand2,
  ArrowLeft,
  FileText,
  Check,
  Loader2,
  Download,
  RefreshCw,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type RecreationStep = "select" | "script" | "generate" | "complete";
type Service = "banana_pro" | "video_placeholder";

export function RecreationView() {
  const { selectedPost, activeCollection, setSelectedPost, setCurrentStep, setConnectRepoOpen, posts } =
    useAppStore();
  const [recreationStep, setRecreationStep] = useState<RecreationStep>("select");
  const [selectedService, setSelectedService] = useState<Service>("banana_pro");
  const [script, setScript] = useState("");
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [error, setError] = useState("");

  // If no post selected, show post selection grid
  if (!selectedPost) {
    return (
      <PostSelectionView />
    );
  }

  const handleGenerateScript = async () => {
    if (!activeCollection) return;

    setIsGeneratingScript(true);
    setError("");

    try {
      const response = await fetch("/api/recreate/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: selectedPost.id,
          collectionId: activeCollection.id,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate script");
      }

      const data = await response.json();
      setScript(data.script);
      setRecreationStep("script");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Script generation failed");
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleGenerateImages = async () => {
    if (!activeCollection) return;

    setIsGeneratingImages(true);
    setError("");

    try {
      const response = await fetch("/api/recreate/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script,
          collectionId: activeCollection.id,
          postId: selectedPost.id,
          appName: activeCollection.app_name,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate images");
      }

      const data = await response.json();
      setGeneratedImages(data.images);
      setRecreationStep("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image generation failed");
    } finally {
      setIsGeneratingImages(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Back button */}
        <button
          onClick={() => {
            setSelectedPost(null);
            setRecreationStep("select");
            setScript("");
            setGeneratedImages([]);
          }}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-6 text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to post selection
        </button>

        {/* Progress Steps */}
        <div className="flex items-center gap-2 mb-8">
          <ProgressStep
            step={1}
            label="Select Post"
            isActive={recreationStep === "select"}
            isComplete={recreationStep !== "select"}
          />
          <ChevronRight className="w-4 h-4 text-zinc-600" />
          <ProgressStep
            step={2}
            label="Generate Script"
            isActive={recreationStep === "script"}
            isComplete={recreationStep === "generate" || recreationStep === "complete"}
          />
          <ChevronRight className="w-4 h-4 text-zinc-600" />
          <ProgressStep
            step={3}
            label="Create Content"
            isActive={recreationStep === "generate"}
            isComplete={recreationStep === "complete"}
          />
          <ChevronRight className="w-4 h-4 text-zinc-600" />
          <ProgressStep
            step={4}
            label="Complete"
            isActive={recreationStep === "complete"}
            isComplete={false}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Original Post */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Original Post</CardTitle>
                <CardDescription>Reference for recreation</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="aspect-square rounded-xl bg-zinc-800 overflow-hidden mb-4">
                  {selectedPost.thumbnail_url ? (
                    <img
                      src={selectedPost.thumbnail_url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600">
                      {selectedPost.post_type === "image_slides" ? (
                        <Image className="w-12 h-12" />
                      ) : (
                        <Video className="w-12 h-12" />
                      )}
                    </div>
                  )}
                </div>
                <h3 className="font-medium text-white text-sm mb-1">
                  {selectedPost.title || "Untitled Post"}
                </h3>
                <div className="flex gap-2 mt-2">
                  <Badge variant={selectedPost.post_type === "image_slides" ? "slides" : "video"}>
                    {selectedPost.post_type === "image_slides" ? "Slides" : "Video"}
                  </Badge>
                  <Badge>{selectedPost.platform}</Badge>
                </div>
              </CardContent>
            </Card>

            {/* App Context */}
            {activeCollection?.app_context ? (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Brain className="w-4 h-4 text-blue-400" />
                    App Context
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-zinc-400 line-clamp-6 leading-relaxed">
                    {activeCollection.app_context}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="mt-4 border-dashed border-zinc-700">
                <CardContent className="p-4 text-center">
                  <Github className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500 mb-3">
                    Connect your GitHub repo for AI-powered context
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConnectRepoOpen(true)}
                  >
                    <Github className="w-3 h-3 mr-1" />
                    Connect
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: Recreation Flow */}
          <div className="lg:col-span-2 space-y-6">
            {/* Service Selection */}
            {selectedPost.post_type === "image_slides" && recreationStep === "select" && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Choose Generation Service</CardTitle>
                    <CardDescription>
                      Select an AI service to recreate this post
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ServiceOption
                      name="Fal AI - Banana Pro"
                      description="High-quality image generation optimized for social media slides"
                      isActive={selectedService === "banana_pro"}
                      isAvailable={true}
                      onClick={() => setSelectedService("banana_pro")}
                    />
                    <ServiceOption
                      name="Video Generation"
                      description="Coming soon - Short-form video recreation"
                      isActive={false}
                      isAvailable={false}
                      onClick={() => {}}
                    />

                    {error && (
                      <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {error}
                      </div>
                    )}

                    <Button
                      variant="primary"
                      className="w-full mt-4"
                      onClick={handleGenerateScript}
                      isLoading={isGeneratingScript}
                    >
                      <Wand2 className="w-4 h-4 mr-2" />
                      {isGeneratingScript
                        ? "Generating Script..."
                        : "Generate Content Script"}
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {selectedPost.post_type === "short_video" && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="border-dashed border-zinc-700">
                  <CardContent className="p-8 text-center">
                    <Video className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-white mb-2">
                      Video Recreation Coming Soon
                    </h3>
                    <p className="text-sm text-zinc-400">
                      Video recreation services are being developed. For now, you can recreate image slide posts.
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* Script Display */}
            {recreationStep === "script" && script && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <FileText className="w-4 h-4 text-blue-400" />
                          Generated Script
                        </CardTitle>
                        <CardDescription>
                          AI-crafted content adapted for {activeCollection?.app_name}
                        </CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleGenerateScript}
                        disabled={isGeneratingScript}
                      >
                        <RefreshCw className={`w-4 h-4 mr-1 ${isGeneratingScript ? "animate-spin" : ""}`} />
                        Regenerate
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-zinc-800/50 rounded-xl p-4 max-h-80 overflow-y-auto mb-4">
                      <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">
                        {script}
                      </pre>
                    </div>

                    <textarea
                      className="w-full bg-zinc-800/30 rounded-xl p-4 text-sm text-zinc-300 border border-zinc-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
                      rows={3}
                      placeholder="Add any custom instructions or edits..."
                    />

                    {error && (
                      <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 mt-4">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {error}
                      </div>
                    )}

                    <Button
                      variant="primary"
                      className="w-full mt-4"
                      onClick={handleGenerateImages}
                      isLoading={isGeneratingImages}
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      {isGeneratingImages
                        ? "Generating Images..."
                        : "Generate Slide Images"}
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* Generated Content */}
            {recreationStep === "complete" && generatedImages.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Check className="w-4 h-4 text-green-400" />
                          Generated Slides
                        </CardTitle>
                        <CardDescription>
                          {generatedImages.length} slides ready for publishing
                        </CardDescription>
                      </div>
                      <Button variant="primary" size="sm">
                        <Download className="w-4 h-4 mr-1" />
                        Download All
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {generatedImages.map((imgUrl, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: i * 0.1 }}
                          className="aspect-square rounded-xl overflow-hidden bg-zinc-800 border border-zinc-700/50"
                        >
                          <img
                            src={imgUrl}
                            alt={`Slide ${i + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </motion.div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PostSelectionView() {
  const { posts, setSelectedPost, activeCollection, setCurrentStep } = useAppStore();
  const slidePosts = posts.filter((p) => p.post_type === "image_slides");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              Recreate Content
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Select a saved post to recreate for {activeCollection?.app_name || "your app"}
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => setCurrentStep("storage")}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Storage
          </Button>
        </div>

        {slidePosts.length === 0 ? (
          <div className="text-center py-20">
            <Image className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">
              No posts to recreate
            </h3>
            <p className="text-sm text-zinc-500 mb-6">
              Save some image slide posts first, then come back to recreate them
            </p>
            <Button variant="secondary" onClick={() => setCurrentStep("storage")}>
              Go to Storage
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {slidePosts.map((post, index) => (
              <motion.button
                key={post.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => setSelectedPost(post)}
                className="group text-left bg-zinc-900/50 rounded-2xl border border-zinc-800/50 overflow-hidden hover:border-blue-500/30 transition-all duration-300"
              >
                <div className="aspect-square bg-zinc-800 overflow-hidden">
                  {post.thumbnail_url ? (
                    <img
                      src={post.thumbnail_url}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Image className="w-12 h-12 text-zinc-600" />
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-medium text-white truncate">
                    {post.title || "Untitled Post"}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Click to recreate
                  </p>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressStep({
  step,
  label,
  isActive,
  isComplete,
}: {
  step: number;
  label: string;
  isActive: boolean;
  isComplete: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
          isComplete
            ? "bg-green-500/20 text-green-400 border border-green-500/30"
            : isActive
              ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
              : "bg-zinc-800 text-zinc-500 border border-zinc-700"
        }`}
      >
        {isComplete ? <Check className="w-3 h-3" /> : step}
      </div>
      <span
        className={`text-sm ${
          isActive ? "text-white font-medium" : "text-zinc-500"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function ServiceOption({
  name,
  description,
  isActive,
  isAvailable,
  onClick,
}: {
  name: string;
  description: string;
  isActive: boolean;
  isAvailable: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!isAvailable}
      className={`w-full p-4 rounded-xl border text-left transition-all ${
        !isAvailable
          ? "border-zinc-800/50 bg-zinc-900/30 opacity-50 cursor-not-allowed"
          : isActive
            ? "border-blue-500/50 bg-blue-500/10 shadow-lg shadow-blue-500/5"
            : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className={`text-sm font-medium ${isActive ? "text-blue-400" : "text-zinc-300"}`}>
            {name}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
        </div>
        {!isAvailable && (
          <Badge variant="default">Coming Soon</Badge>
        )}
        {isActive && isAvailable && (
          <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
            <Check className="w-3 h-3 text-white" />
          </div>
        )}
      </div>
    </button>
  );
}
