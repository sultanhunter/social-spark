import { NextRequest, NextResponse } from "next/server";
import { publishBlogPost } from "@/lib/muslimah-blog-api";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const slug = asNonEmptyString(body.slug);

    if (!slug) {
      return NextResponse.json({ error: "Post slug is required." }, { status: 400 });
    }

    const post = await publishBlogPost(slug);
    return NextResponse.json({ post });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to publish blog post.",
      },
      { status: 500 }
    );
  }
}
