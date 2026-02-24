import { type BlogCategory } from "@/lib/blog-agent";

const DEFAULT_BLOG_API_BASE_URLS = [
  "https://muslimahpro.com/api/blog",
] as const;

export interface MuslimahBlogDraftPayload {
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
}

export interface MuslimahBlogPost {
  id?: string;
  title?: string;
  excerpt?: string;
  category?: string;
  created_at?: string;
  updated_at?: string;
  slug: string;
  status: "draft" | "published";
  reading_time_minutes?: number;
  published_at?: string | null;
  [key: string]: unknown;
}

interface BlogApiRequestOptions {
  authMode?: "required" | "optional" | "none";
}

function getBlogApiBaseUrl(): string {
  const raw = (process.env.MUSLIMAH_BLOG_API_BASE_URL || "").trim();

  if (!raw) {
    return DEFAULT_BLOG_API_BASE_URLS[0];
  }

  const normalized = raw.replace(/\/$/, "");

  if (normalized.endsWith("/api/blog")) {
    return normalized;
  }

  return `${normalized}/api/blog`;
}

function getFallbackBlogApiBaseUrls(primaryBaseUrl: string): string[] {
  const deduped = new Set<string>([primaryBaseUrl, ...DEFAULT_BLOG_API_BASE_URLS]);
  return Array.from(deduped);
}

function getBlogApiKey(): string {
  const key = process.env.MUSLIMAH_BLOG_API_KEY?.trim();

  if (!key) {
    throw new Error("Missing MUSLIMAH_BLOG_API_KEY environment variable.");
  }

  return key;
}

function getOptionalBlogApiKey(): string | null {
  const key = process.env.MUSLIMAH_BLOG_API_KEY?.trim();
  return key || null;
}

export function hasBlogApiKey(): boolean {
  return Boolean(getOptionalBlogApiKey());
}

async function requestBlogApi(
  path: string,
  init: RequestInit,
  options: BlogApiRequestOptions = {}
): Promise<Record<string, unknown>> {
  const configuredBaseUrl = getBlogApiBaseUrl();
  const baseUrls = getFallbackBlogApiBaseUrls(configuredBaseUrl);
  const authMode = options.authMode || "required";
  const apiKey =
    authMode === "required"
      ? getBlogApiKey()
      : authMode === "optional"
        ? getOptionalBlogApiKey()
        : null;

  const networkErrors: string[] = [];

  for (const baseUrl of baseUrls) {
    const endpoint = `${baseUrl}${path}`;

    try {
      const response = await fetch(endpoint, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(init.headers || {}),
        },
      });

      const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const message =
          typeof responseBody.error === "string"
            ? responseBody.error
            : typeof responseBody.message === "string"
              ? responseBody.message
              : `Blog API request failed with status ${response.status}`;
        throw new Error(`${message} (endpoint: ${endpoint})`);
      }

      return responseBody;
    } catch (error) {
      if (error instanceof TypeError) {
        networkErrors.push(`${endpoint}: ${error.message}`);
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `Unable to reach the Muslimah Blog API. Tried ${baseUrls.join(", ")}. Set MUSLIMAH_BLOG_API_BASE_URL to your live API origin. Network errors: ${networkErrors.join(" | ")}`
  );
}

export async function createBlogDraft(
  payload: MuslimahBlogDraftPayload
): Promise<MuslimahBlogPost> {
  const requestBody: Record<string, unknown> = {
    ...payload,
    status: "draft",
  };

  if (!payload.cover_image) {
    delete requestBody.cover_image;
  }

  const result = await requestBlogApi("", {
    method: "POST",
    body: JSON.stringify(requestBody),
  }, { authMode: "required" });

  const post = result.post as MuslimahBlogPost | undefined;
  if (!post?.slug) {
    throw new Error("Blog draft was created but the response did not include a valid slug.");
  }

  return post;
}

export async function publishBlogPost(slug: string): Promise<MuslimahBlogPost> {
  const safeSlug = encodeURIComponent(slug);

  const result = await requestBlogApi(`/${safeSlug}`, {
    method: "PUT",
    body: JSON.stringify({ status: "published" }),
  }, { authMode: "required" });

  const post = result.post as MuslimahBlogPost | undefined;
  if (!post?.slug) {
    throw new Error("Blog publish request succeeded but no post payload was returned.");
  }

  return post;
}

export async function listBlogPosts({
  status,
  category,
  limit = 40,
  offset = 0,
  authMode = "optional",
}: {
  status?: "draft" | "published";
  category?: string;
  limit?: number;
  offset?: number;
  authMode?: "required" | "optional" | "none";
} = {}): Promise<{
  posts: MuslimahBlogPost[];
  total: number;
  limit: number;
  offset: number;
}> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (category) params.set("category", category);
  params.set("limit", String(Math.max(1, Math.min(100, limit))));
  params.set("offset", String(Math.max(0, offset)));

  const query = params.toString();
  const result = await requestBlogApi(query ? `?${query}` : "", { method: "GET" }, { authMode });

  const rawPosts = Array.isArray(result.posts)
    ? result.posts
    : Array.isArray(result.data)
      ? result.data
      : [];

  const posts = rawPosts
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      ...item,
      slug: typeof item.slug === "string" ? item.slug : "",
      status: item.status === "published" ? "published" : "draft",
    }))
    .filter((item): item is MuslimahBlogPost => Boolean(item.slug));

  const total = typeof result.total === "number" ? result.total : posts.length;

  return {
    posts,
    total,
    limit: typeof result.limit === "number" ? result.limit : limit,
    offset: typeof result.offset === "number" ? result.offset : offset,
  };
}

export async function getBlogPost(
  slug: string,
  authMode: "required" | "optional" | "none" = "optional"
): Promise<MuslimahBlogPost> {
  const safeSlug = encodeURIComponent(slug);
  const result = await requestBlogApi(`/${safeSlug}`, { method: "GET" }, { authMode });

  const rawPost =
    typeof result.post === "object" && result.post !== null
      ? (result.post as Record<string, unknown>)
      : typeof result.data === "object" && result.data !== null
        ? (result.data as Record<string, unknown>)
        : null;

  if (!rawPost || typeof rawPost.slug !== "string" || rawPost.slug.trim().length === 0) {
    throw new Error("Blog API did not return a valid post payload.");
  }

  return {
    ...rawPost,
    slug: rawPost.slug,
    status: rawPost.status === "published" ? "published" : "draft",
  } as MuslimahBlogPost;
}
