import { NextResponse } from "next/server";
import {
  hasBlogApiKey,
  listBlogPosts,
  type MuslimahBlogPost,
} from "@/lib/muslimah-blog-api";

function sortByRecency(posts: MuslimahBlogPost[]): MuslimahBlogPost[] {
  const getTimestamp = (post: MuslimahBlogPost): number => {
    const value = post.updated_at || post.published_at || post.created_at;
    if (!value || typeof value !== "string") return 0;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  return [...posts].sort((a, b) => getTimestamp(b) - getTimestamp(a));
}

export async function GET() {
  try {
    const publishedResult = await listBlogPosts({
      status: "published",
      limit: 60,
      authMode: "optional",
    });

    let draftPosts: MuslimahBlogPost[] = [];
    let draftFetchWarning: string | null = null;

    if (hasBlogApiKey()) {
      try {
        const draftResult = await listBlogPosts({
          status: "draft",
          limit: 60,
          authMode: "required",
        });
        draftPosts = draftResult.posts;
      } catch (error) {
        draftFetchWarning =
          error instanceof Error
            ? `Draft posts unavailable: ${error.message}`
            : "Draft posts unavailable.";
      }
    }

    const bySlug = new Map<string, MuslimahBlogPost>();
    for (const post of [...publishedResult.posts, ...draftPosts]) {
      bySlug.set(post.slug, post);
    }

    const posts = sortByRecency(Array.from(bySlug.values()));

    return NextResponse.json({
      posts,
      total: posts.length,
      warning: draftFetchWarning,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch blog posts.",
      },
      { status: 500 }
    );
  }
}
