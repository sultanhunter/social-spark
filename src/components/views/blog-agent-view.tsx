"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Copy,
  Eye,
  ExternalLink,
  FileText,
  RefreshCw,
  Rocket,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/modal";
import {
  DEFAULT_REASONING_MODEL,
  REASONING_MODELS,
  isReasoningModel,
} from "@/lib/reasoning-model";

type BlogCategory =
  | "islamic-guidance"
  | "period-health"
  | "pregnancy"
  | "lifestyle"
  | "app-updates"
  | "general";

type BlogResearch = {
  researchSummary: string;
  targetAudience: string;
  primaryKeywords: string[];
  secondaryKeywords: string[];
  outline: string[];
  keyInsights: string[];
  faqQuestions: string[];
  sources: Array<{
    title: string;
    url: string;
    insight: string;
  }>;
};

type BlogDraft = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  category: BlogCategory;
  tags: string[];
  author: string;
  meta_title: string;
  meta_description: string;
  cover_image?: string;
};

type BlogDraftPost = {
  id?: string;
  slug: string;
  status: "draft" | "published";
  reading_time_minutes?: number;
  published_at?: string | null;
};

type BlogListItem = {
  id?: string;
  title?: string;
  slug: string;
  excerpt?: string;
  category?: string;
  status: "draft" | "published";
  reading_time_minutes?: number;
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type BlogAgentGenerateResponse = {
  model: string;
  topicPlan: {
    selectedTopic: string;
    selectionRationale: string;
    trendSignals: string[];
    candidateTopics: Array<{
      title: string;
      whyNow: string;
      seoPotential: string;
      audienceNeed: string;
    }>;
    suggestedCategory: BlogCategory;
  };
  research: BlogResearch;
  draft: BlogDraft;
  generatedImages?: {
    imageModel: string;
    coverImageUrl: string;
    inlineImages: Array<{ url: string; alt: string }>;
  };
  draftPost: BlogDraftPost;
};

type BlogPostsResponse = {
  posts: BlogListItem[];
  total: number;
  warning?: string | null;
  error?: string;
};

type BlogPostDetail = BlogListItem & {
  content?: string;
  meta_title?: string;
  meta_description?: string;
  author?: string;
  tags?: string[];
  cover_image?: string;
};

type BlogPostDetailResponse = {
  post?: BlogPostDetail;
  error?: string;
};

type BlogGenerateJobResponse = {
  jobId?: string;
  status?: string;
  message?: string;
  error?: string;
};

type BlogGenerationJobStatusResponse = {
  jobId: string;
  status: "draft" | "generating" | "completed" | "failed";
  error?: string | null;
  result?: BlogAgentGenerateResponse | null;
};

export function BlogAgentView({ collectionId }: { collectionId: string }) {
  const router = useRouter();
  const { activeCollection } = useAppStore();

  const [reasoningModel, setReasoningModel] = useState(DEFAULT_REASONING_MODEL);
  const [result, setResult] = useState<BlogAgentGenerateResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishingSlug, setPublishingSlug] = useState<string | null>(null);
  const [posts, setPosts] = useState<BlogListItem[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(false);
  const [postsError, setPostsError] = useState("");
  const [postsWarning, setPostsWarning] = useState("");
  const [previewPost, setPreviewPost] = useState<BlogPostDetail | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    setIsLoadingPosts(true);
    setPostsError("");

    try {
      const response = await fetch("/api/blog-agent/posts", { method: "GET" });
      const data = (await response.json()) as BlogPostsResponse;

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch blog posts.");
      }

      setPosts(Array.isArray(data.posts) ? data.posts : []);
      setPostsWarning(typeof data.warning === "string" ? data.warning : "");
    } catch (err) {
      setPostsError(err instanceof Error ? err.message : "Failed to load blog posts.");
    } finally {
      setIsLoadingPosts(false);
    }
  }, []);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;

    const pollJob = async () => {
      try {
        const response = await fetch(`/api/blog-agent/jobs/${encodeURIComponent(activeJobId)}`, {
          method: "GET",
          cache: "no-store",
        });
        const data = (await response.json()) as BlogGenerationJobStatusResponse & { error?: string };

        if (!response.ok) {
          throw new Error(data.error || "Failed to check job status.");
        }

        if (cancelled) return;

        if (data.status === "completed") {
          if (data.result) {
            setResult(data.result);
          }
          setSuccess("Blog draft generation completed.");
          setActiveJobId(null);
          await loadPosts();
          return;
        }

        if (data.status === "failed") {
          setError(data.error || "Background generation failed.");
          setActiveJobId(null);
          await loadPosts();
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to poll generation status.");
      }
    };

    void pollJob();
    const intervalId = setInterval(() => {
      void pollJob();
    }, 7000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [activeJobId, loadPosts]);

  const openPreview = async (slug: string) => {
    setIsPreviewOpen(true);
    setIsLoadingPreview(true);
    setPreviewError("");
    setPreviewPost(null);

    try {
      const response = await fetch(`/api/blog-agent/posts/${encodeURIComponent(slug)}`, {
        method: "GET",
      });
      const data = (await response.json()) as BlogPostDetailResponse;

      if (!response.ok || !data.post) {
        throw new Error(data.error || "Failed to load post preview.");
      }

      setPreviewPost(data.post);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to load preview.");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError("");
    setSuccess("");
    setActiveJobId(null);

    try {
      const response = await fetch("/api/blog-agent/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId,
          reasoningModel,
        }),
      });

      const data = (await response.json()) as BlogGenerateJobResponse;

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate blog draft.");
      }

      if (!data.jobId) {
        throw new Error("Generation job did not return a valid job ID.");
      }

      setResult(null);
      setActiveJobId(data.jobId);
      setSuccess("Generation started. The server is preparing your long-form SEO draft in the background.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Blog generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const publishBySlug = async (slug: string) => {
    const isCurrentDraft = result?.draftPost.slug === slug;

    if (isCurrentDraft) {
      setIsPublishing(true);
    } else {
      setPublishingSlug(slug);
    }

    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/blog-agent/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });

      const data = (await response.json()) as { post?: BlogDraftPost; error?: string };

      if (!response.ok || !data.post) {
        throw new Error(data.error || "Failed to publish draft.");
      }

      setResult((prev) => {
        if (!prev || prev.draftPost.slug !== slug) return prev;
        return {
          ...prev,
          draftPost: {
            ...prev.draftPost,
            ...data.post,
            status: "published",
          },
        };
      });

      setSuccess(`Post \"${data.post.slug}\" is now published.`);
      setPreviewPost((prev) => {
        if (!prev || prev.slug !== slug) return prev;
        return {
          ...prev,
          ...data.post,
          status: "published",
        };
      });
      await loadPosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish request failed.");
    } finally {
      if (isCurrentDraft) {
        setIsPublishing(false);
      } else {
        setPublishingSlug(null);
      }
    }
  };

  const handlePublish = async () => {
    if (!result) return;
    await publishBySlug(result.draftPost.slug);
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4 lg:sticky lg:top-22 lg:h-fit">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/collections/${collectionId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to collection
          </Button>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Blog Agent</CardTitle>
              <CardDescription>Research-first workflow for SEO-ready Muslimah Pro blog content.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <StatusRow label="1. Trend discovery" done={Boolean(result?.topicPlan)} />
              <StatusRow label="2. Draft generated" done={Boolean(result?.draftPost)} />
              <StatusRow label="3. Publish decision" done={result?.draftPost.status === "published"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>
                <span className="font-medium text-slate-800">App:</span>{" "}
                {activeCollection?.app_name || "Muslimah Pro"}
              </p>
              {activeCollection?.app_description ? (
                <p className="leading-relaxed">{activeCollection.app_description}</p>
              ) : (
                <p className="leading-relaxed">
                  Add a richer app description in your collection to get even more specific blog angles.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Create Blog Draft</CardTitle>
              <CardDescription>
                Choose a Gemini model. The agent handles trend discovery, topic selection, deep research, and a long-form SEO draft (2,000-5,000 words with table of contents and references).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-800">Gemini Model</label>
                <select
                  value={reasoningModel}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (isReasoningModel(value)) {
                      setReasoningModel(value);
                    }
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                >
                  {REASONING_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button variant="primary" onClick={handleGenerate} isLoading={isGenerating || Boolean(activeJobId)}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {isGenerating
                    ? "Queuing generation..."
                    : activeJobId
                      ? "Generating in background..."
                      : "Auto-Research + Generate Draft"}
                </Button>

                {result?.draft?.content ? (
                  <Button
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(result.draft.content)}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Markdown
                  </Button>
                ) : null}

                {result?.draftPost.status === "draft" ? (
                  <Button variant="outline" onClick={handlePublish} isLoading={isPublishing}>
                    <Rocket className="mr-2 h-4 w-4" />
                    {isPublishing ? "Publishing..." : "Publish Draft"}
                  </Button>
                ) : null}
              </div>

              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              {success ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {success}
                </div>
              ) : null}

              {activeJobId ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700">
                  Job {activeJobId.slice(0, 8)} is running on the worker server. This panel updates automatically.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">All Blog Posts</CardTitle>
                  <CardDescription>Fetched from Muslimah Pro Blog API (published and drafts).</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => void loadPosts()} isLoading={isLoadingPosts}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {postsWarning ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {postsWarning}
                </p>
              ) : null}

              {postsError ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {postsError}
                </p>
              ) : null}

              {!postsError && posts.length === 0 ? (
                <p className="text-sm text-slate-500">No blog posts found yet.</p>
              ) : null}

              <div className="space-y-2">
                {posts.map((post) => (
                  <div key={post.slug} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{post.title || post.slug}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={post.status === "published" ? "success" : "default"}>
                          {post.status}
                        </Badge>
                        {post.category ? <Badge variant="default">{post.category}</Badge> : null}
                      </div>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" />
                        {post.slug}
                      </span>
                      {typeof post.reading_time_minutes === "number" ? (
                        <span>{post.reading_time_minutes} min read</span>
                      ) : null}
                      {formatBlogDate(post) ? <span>{formatBlogDate(post)}</span> : null}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void openPreview(post.slug)}
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" />
                        Preview
                      </Button>

                      {post.status === "published" ? (
                        <a
                          href={`https://muslimahpro.com/blog/${post.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-500"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open live post
                        </a>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void publishBySlug(post.slug)}
                          isLoading={publishingSlug === post.slug}
                        >
                          <Rocket className="mr-1 h-3.5 w-3.5" />
                          Publish
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {result ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Agent Topic Selection</CardTitle>
                  <CardDescription>Topic chosen from current trend and demand signals.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-slate-700">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected Topic</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">
                      {result.topicPlan.selectedTopic}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">{result.topicPlan.selectionRationale}</p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <InfoBlock title="Trend Signals" items={result.topicPlan.trendSignals} />
                    <InfoBlock
                      title="Candidate Topics"
                      items={result.topicPlan.candidateTopics.map((item) => item.title)}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Research Brief</CardTitle>
                  <CardDescription>Grounded prep work used for generation.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-slate-700">
                  <p>{result.research.researchSummary}</p>

                  <div className="grid gap-3 md:grid-cols-2">
                    <InfoBlock title="Primary Keywords" items={result.research.primaryKeywords} />
                    <InfoBlock title="Secondary Keywords" items={result.research.secondaryKeywords} />
                  </div>

                  <InfoBlock title="Outline" items={result.research.outline} />
                  <InfoBlock title="FAQ Targets" items={result.research.faqQuestions} />

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</p>
                    <div className="space-y-2">
                      {result.research.sources.map((source, index) => (
                        <a
                          key={`${source.url}-${index}`}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-lg border border-slate-200 bg-slate-50 p-3 transition hover:border-slate-300"
                        >
                          <p className="text-sm font-medium text-slate-800">{source.title}</p>
                          <p className="mt-0.5 break-all text-xs text-slate-500">{source.url}</p>
                          {source.insight ? <p className="mt-1 text-xs text-slate-600">{source.insight}</p> : null}
                        </a>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Generated Draft</CardTitle>
                  <CardDescription>Saved to Blog API as draft before publishing.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={result.draftPost.status === "published" ? "success" : "default"}>
                      {result.draftPost.status}
                    </Badge>
                    <Badge variant="default">{result.draft.category}</Badge>
                    {typeof result.draftPost.reading_time_minutes === "number" ? (
                      <Badge variant="default">{result.draftPost.reading_time_minutes} min read</Badge>
                    ) : null}
                    <Badge variant="default">{result.model}</Badge>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-lg font-semibold text-slate-900">{result.draft.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{result.draft.excerpt}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" />
                        {result.draft.slug}
                      </span>
                      {result.draftPost.status === "published" ? (
                        <a
                          href={`https://muslimahpro.com/blog/${result.draft.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-500"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open live post
                        </a>
                      ) : null}
                    </div>
                  </div>

                  {result.generatedImages?.coverImageUrl ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Generated Cover Image ({result.generatedImages.imageModel})
                      </p>
                      <div
                        className="h-56 w-full rounded-lg border border-slate-200 bg-cover bg-center"
                        style={{ backgroundImage: `url(${result.generatedImages.coverImageUrl})` }}
                        role="img"
                        aria-label={`${result.draft.title} cover`}
                      />
                      <a
                        href={result.generatedImages.coverImageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-500"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open generated image
                      </a>
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-2">
                    <MetaItem label="Meta Title" value={result.draft.meta_title} icon={<BookOpen className="h-4 w-4" />} />
                    <MetaItem label="Meta Description" value={result.draft.meta_description} icon={<CheckCircle2 className="h-4 w-4" />} />
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Markdown Content</p>
                    <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {result.draft.content}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}

          <Dialog
            open={isPreviewOpen}
            onOpenChange={(open) => {
              setIsPreviewOpen(open);
              if (!open) {
                setPreviewError("");
              }
            }}
          >
            <DialogContent className="max-w-4xl">
              <DialogHeader>
                <DialogTitle>Blog Post Preview</DialogTitle>
                <DialogDescription>
                  Review full content before publishing.
                </DialogDescription>
              </DialogHeader>

              <div className="p-6 pt-4">
                {isLoadingPreview ? (
                  <p className="text-sm text-slate-600">Loading preview...</p>
                ) : previewError ? (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {previewError}
                  </p>
                ) : previewPost ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={previewPost.status === "published" ? "success" : "default"}>
                          {previewPost.status}
                        </Badge>
                        {previewPost.category ? <Badge variant="default">{previewPost.category}</Badge> : null}
                      </div>
                      <h3 className="mt-2 text-lg font-semibold text-slate-900">
                        {previewPost.title || previewPost.slug}
                      </h3>
                      {previewPost.excerpt ? (
                        <p className="mt-1 text-sm text-slate-600">{previewPost.excerpt}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {previewPost.status === "draft" ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => void publishBySlug(previewPost.slug)}
                          isLoading={publishingSlug === previewPost.slug}
                        >
                          <Rocket className="mr-2 h-4 w-4" />
                          Publish This Draft
                        </Button>
                      ) : (
                        <a
                          href={`https://muslimahpro.com/blog/${previewPost.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open Live Post
                        </a>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Markdown Content
                      </p>
                      <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                        {previewPost.content || "No content available."}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">Select a post to preview.</p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {done ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      ) : (
        <div className="h-4 w-4 rounded-full border border-slate-300" />
      )}
      <span className={done ? "text-slate-700" : "text-slate-500"}>{label}</span>
    </div>
  );
}

function InfoBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">No items available.</p>
      ) : (
        <ul className="space-y-1 text-sm text-slate-700">
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>• {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatBlogDate(post: BlogListItem): string {
  const raw = post.updated_at || post.published_at || post.created_at;
  if (!raw) return "";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function MetaItem({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-sm text-slate-700">{value}</p>
    </div>
  );
}
