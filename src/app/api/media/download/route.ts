import { NextRequest, NextResponse } from "next/server";
import { fetchWithProxy } from "@/lib/proxy-fetch";

export const runtime = "nodejs";

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 160) || "download.bin";
}

function deriveFilenameFromUrl(fileUrl: string): string {
  try {
    const parsed = new URL(fileUrl);
    const name = parsed.pathname.split("/").pop();
    if (name && name.length > 0) return sanitizeFilename(name);
  } catch {
    // ignore parse error
  }

  return "download.bin";
}

function isAllowedDownloadUrl(fileUrl: string): boolean {
  const base = process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/\/+$/, "");
  if (!base) return false;
  return fileUrl === base || fileUrl.startsWith(`${base}/`);
}

export async function GET(request: NextRequest) {
  try {
    const fileUrl = request.nextUrl.searchParams.get("url");
    const requestedFilename = request.nextUrl.searchParams.get("filename");

    if (!fileUrl) {
      return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(fileUrl);
    } catch {
      return NextResponse.json({ error: "Invalid download url" }, { status: 400 });
    }

    if (!["https:", "http:"].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: "Unsupported url protocol" }, { status: 400 });
    }

    if (!isAllowedDownloadUrl(fileUrl)) {
      return NextResponse.json({ error: "URL is not allowed for download" }, { status: 403 });
    }

    const upstream = await fetchWithProxy(fileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SocialSpark/1.0)",
      },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream download failed with status ${upstream.status}` },
        { status: 502 }
      );
    }

    const buffer = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const filename = sanitizeFilename(requestedFilename || deriveFilenameFromUrl(fileUrl));

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to download media" },
      { status: 500 }
    );
  }
}
