import { NextRequest, NextResponse } from "next/server";
import { getBlogPost, hasBlogApiKey } from "@/lib/muslimah-blog-api";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const authMode = hasBlogApiKey() ? "required" : "optional";
    const post = await getBlogPost(slug, authMode);

    return NextResponse.json({ post });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch blog post.",
      },
      { status: 500 }
    );
  }
}
