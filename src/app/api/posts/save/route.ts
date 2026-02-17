import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractPlatform } from "@/lib/utils";
import { downloadAndUploadMultipleToR2 } from "@/lib/r2";
import { fetchWithProxy } from "@/lib/proxy-fetch";
import { extractSocialPost } from "@/lib/social-extractor";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, collectionId, postType, title, description, imageUrls: manualImageUrls } = body;

    if (!url || !collectionId || !postType) {
      return NextResponse.json(
        { error: "URL, collection ID, and post type are required" },
        { status: 400 }
      );
    }

    const platform = extractPlatform(url);

    // Generate a temporary post ID for R2 storage
    const tempPostId = randomUUID();

    // Attempt to download media and get metadata
    let thumbnailUrl: string | null = null;
    let mediaUrls: string[] = [];
    let metadata: Record<string, unknown> = {};
    let originalImageUrls: string[] = [];
    let postTitle: string | null = title || null;
    let postDescription: string | null = description || null;

    const extractionErrors: string[] = [];

    // Use manually provided image URLs if available
    if (manualImageUrls && Array.isArray(manualImageUrls) && manualImageUrls.length > 0) {
      console.log(`Using ${manualImageUrls.length} manually provided image URLs`);
      originalImageUrls = manualImageUrls;
      metadata = {
        source: "manual",
        fetchedAt: new Date().toISOString(),
      };
    }
    // Otherwise try platform-specific fetching
    else if (platform === "instagram" || platform === "tiktok") {
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const sessionId = randomUUID().slice(0, 8);

        try {
          console.log(`[extract] platform=${platform} attempt=${attempt} session=${sessionId}`);

          const extracted = await extractSocialPost(url, platform, sessionId);

          originalImageUrls = extracted.mediaUrls;
          postTitle = postTitle || extracted.title;
          postDescription = postDescription || extracted.description;

          metadata = {
            platform,
            extractor: extracted.extractor,
            extractionAttempt: attempt,
            sessionId,
            originalMediaUrls: extracted.mediaUrls,
            fetchedAt: new Date().toISOString(),
          };

          if (originalImageUrls.length > 0) {
            console.log(`[extract] success platform=${platform} attempt=${attempt} media=${originalImageUrls.length}`);
            break;
          }

          extractionErrors.push(`Attempt ${attempt}: no media returned`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown extraction error";
          extractionErrors.push(`Attempt ${attempt}: ${message}`);
          console.error(`[extract] failed platform=${platform} attempt=${attempt}`, error);
        }
      }

      if (originalImageUrls.length === 0) {
        return NextResponse.json(
          {
            error:
              "Failed to extract media from this post after multiple attempts. Ensure gallery-dl/yt-dlp are installed, Decodo proxy is configured, and Instagram cookies are set. You can still paste image URLs manually.",
            details: extractionErrors,
          },
          { status: 422 }
        );
      }
    } else {
      // Generic OG scraping for other platforms
      try {
        const metaResponse = await fetchWithProxy(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          redirect: "follow",
        });

        if (metaResponse.ok) {
          const html = await metaResponse.text();
          
          const ogImage = html.match(
            /<meta[^>]*property="og:image"[^>]*content="([^"]*)"[^>]*>/i
          );
          const ogTitle = html.match(
            /<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i
          );
          const ogDescription = html.match(
            /<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i
          );

          if (ogImage && ogImage[1]) {
            originalImageUrls = [ogImage[1]];
          }
          
          postTitle = postTitle || ogTitle?.[1] || null;
          postDescription = ogDescription?.[1] || null;

          metadata = {
            ogTitle: ogTitle?.[1] || null,
            ogDescription: ogDescription?.[1] || null,
            ogImage: ogImage?.[1] || null,
            fetchedAt: new Date().toISOString(),
          };
        }
      } catch (error) {
        console.log("Could not fetch metadata for URL:", url, error);
      }
    }

    // Download images and upload to R2
    if (originalImageUrls.length > 0) {
      try {
        console.log(`Uploading ${originalImageUrls.length} images to R2...`);
        mediaUrls = await downloadAndUploadMultipleToR2(
          originalImageUrls,
          collectionId,
          tempPostId
        );
        thumbnailUrl = mediaUrls[0] || null;
        console.log(`Successfully uploaded ${mediaUrls.length} images to R2`);
      } catch (error) {
        console.error("Failed to download and upload images to R2:", error);
        return NextResponse.json(
          {
            error: "Media extraction worked, but upload to R2 failed.",
            details: error instanceof Error ? error.message : "Unknown R2 upload error",
          },
          { status: 502 }
        );
      }
    }

    // Save to database
    const { data, error } = await supabase
      .from("saved_posts")
      .insert({
        collection_id: collectionId,
        original_url: url,
        platform,
        post_type: postType,
        title: postTitle,
        description: postDescription,
        media_urls: mediaUrls,
        thumbnail_url: thumbnailUrl,
        metadata,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save post" },
      { status: 500 }
    );
  }
}
