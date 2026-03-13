import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { extractPlatform } from "@/lib/utils";
import { downloadAndUploadToR2 } from "@/lib/r2";
import { fetchWithProxy } from "@/lib/proxy-fetch";
import { extractSocialPost } from "@/lib/social-extractor";
import { fetchTikTokPost } from "@/lib/tiktok";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

function isTransientSupabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const row = error as Record<string, unknown>;
  const combined = `${typeof row.message === "string" ? row.message : ""} ${typeof row.details === "string" ? row.details : ""}`.toLowerCase();

  return (
    combined.includes("fetch failed") ||
    combined.includes("connecttimeouterror") ||
    combined.includes("und_err_connect_timeout") ||
    combined.includes("timed out") ||
    combined.includes("network")
  );
}

function isTlsHostnameMismatchError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const row = error as Record<string, unknown>;
  const combined = `${typeof row.message === "string" ? row.message : ""} ${typeof row.details === "string" ? row.details : ""}`.toLowerCase();

  return (
    combined.includes("err_tls_cert_altname_invalid") ||
    combined.includes("hostname/ip does not match certificate") ||
    combined.includes("altnames")
  );
}

function getErrorDetails(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const row = error as Record<string, unknown>;
  return typeof row.details === "string" && row.details.trim() ? row.details : null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type SavedPostInsertRow = {
  id: string;
} & Record<string, unknown>;

function dedupeHttpUrls(urls: string[]): string[] {
  return Array.from(
    new Set(
      urls
        .filter((url) => typeof url === "string" && /^https?:\/\//i.test(url.trim()))
        .map((url) => url.trim())
    )
  );
}

function getSafeExtensionFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split("/").pop() || "";
    const ext = filename.includes(".") ? filename.split(".").pop() || "" : "";
    if (/^[a-zA-Z0-9]{2,5}$/.test(ext)) return ext.toLowerCase();
  } catch {
    // Ignore parse failures and fall back.
  }
  return "jpg";
}

function isLikelyDirectMediaUrl(url: string, platform: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathWithQuery = `${parsed.pathname}${parsed.search}`.toLowerCase();

    if (
      /\.(mp4|mov|webm|m4v|m3u8|mp3|m4a|aac|opus)(\?|$)/i.test(pathWithQuery) ||
      pathWithQuery.includes("mime_type=audio") ||
      pathWithQuery.includes("mime_type=video") ||
      pathWithQuery.includes("/aweme/v1/play")
    ) {
      return false;
    }

    if (platform === "tiktok") {
      if (host === "www.tiktok.com" || host === "m.tiktok.com" || host === "tiktok.com") {
        return false;
      }

      if (
        pathWithQuery.includes("/photo/") ||
        pathWithQuery.includes("/video/") ||
        pathWithQuery.startsWith("/t/") ||
        pathWithQuery.includes("playwm")
      ) {
        return false;
      }

      if (/\.(jpe?g|png|webp|gif|bmp)(\?|$)/i.test(pathWithQuery)) {
        return true;
      }

      const likelyCdnHost =
        host.includes("tiktokcdn") ||
        host.includes("byteoversea") ||
        host.includes("bytedance") ||
        host.includes("ibytedtos") ||
        host.includes("muscdn") ||
        host.includes("snssdk") ||
        host.includes("akamaized") ||
        host.includes("cloudfront");

      const likelyImagePath =
        pathWithQuery.includes("/obj/") ||
        pathWithQuery.includes("/tos-") ||
        pathWithQuery.includes("image") ||
        pathWithQuery.includes("photomode");

      return likelyCdnHost && likelyImagePath;
    }
  } catch {
    return false;
  }

  return true;
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8);

  try {
    const body = await request.json();
    const { url, collectionId, postType, title, description, imageUrls: manualImageUrls } = body;

    console.log(
      `[posts-save] req=${requestId} start collection=${collectionId ?? "missing"} postType=${postType ?? "missing"} url=${typeof url === "string" ? url : "invalid"}`
    );

    if (!url || !collectionId || !postType) {
      console.warn(`[posts-save] req=${requestId} validation_failed missing required fields`);
      return NextResponse.json(
        { error: "URL, collection ID, and post type are required", requestId },
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
      console.log(`[posts-save] req=${requestId} using_manual_images count=${manualImageUrls.length}`);
      originalImageUrls = dedupeHttpUrls(manualImageUrls);
      metadata = {
        source: "manual",
        fetchedAt: new Date().toISOString(),
      };
    }
    // Otherwise try platform-specific fetching
    else if (platform === "instagram" || platform === "tiktok") {
      const maxAttempts = 3;
      const remoteExtractorConfigured = Boolean(
        process.env.SOCIAL_EXTRACTOR_API_URL || process.env.EXTRACTOR_API_URL
      );

      console.log(
        `[posts-save] req=${requestId} extraction_start platform=${platform} attempts=${maxAttempts} remoteConfigured=${remoteExtractorConfigured}`
      );

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const sessionId = randomUUID().slice(0, 8);

        try {
          console.log(
            `[posts-save] req=${requestId} extraction_attempt platform=${platform} attempt=${attempt} session=${sessionId}`
          );

          const extracted = await extractSocialPost(
            url,
            platform,
            sessionId,
            platform === "tiktok" && postType === "image_slides" ? "image" : "any"
          );

          const remoteUrls = dedupeHttpUrls(extracted.mediaUrls);
          originalImageUrls = remoteUrls.filter((item) => isLikelyDirectMediaUrl(item, platform));
          postTitle = postTitle || extracted.title;
          postDescription = postDescription || extracted.description;

          metadata = {
            platform,
            extractor: extracted.extractor,
            extractionAttempt: attempt,
            sessionId,
            originalMediaUrls: extracted.mediaUrls,
            filteredRemoteMediaCount: remoteUrls.length - originalImageUrls.length,
            fetchedAt: new Date().toISOString(),
          };

          if (platform === "tiktok" && postType === "image_slides") {
            try {
              const tiktokFallback = await fetchTikTokPost(url);
              const fallbackUrls = dedupeHttpUrls(tiktokFallback.mediaUrls).filter((item) =>
                isLikelyDirectMediaUrl(item, platform)
              );

              if (originalImageUrls.length === 0 && fallbackUrls.length > 0) {
                originalImageUrls = fallbackUrls;
                metadata = {
                  ...metadata,
                  tiktokFallbackExtractor: "local-html-parser",
                  fallbackMediaCount: fallbackUrls.length,
                  fallbackMode: "replace",
                };
                console.log(
                  `[posts-save] req=${requestId} tiktok_fallback_used media=${fallbackUrls.length}`
                );
              } else {
                const merged = dedupeHttpUrls([...originalImageUrls, ...fallbackUrls]);

                if (merged.length > originalImageUrls.length) {
                  originalImageUrls = merged;
                  metadata = {
                    ...metadata,
                    tiktokFallbackExtractor: "local-html-parser",
                    mergedMediaCount: merged.length,
                    fallbackMode: "merge",
                  };
                  console.log(
                    `[posts-save] req=${requestId} tiktok_fallback_merged media=${merged.length}`
                  );
                }
              }
            } catch (fallbackError) {
              console.warn(
                `[posts-save] req=${requestId} tiktok_fallback_failed message=${asErrorMessage(fallbackError)}`
              );
            }
          }

          if (originalImageUrls.length > 0) {
            console.log(
              `[posts-save] req=${requestId} extraction_success platform=${platform} attempt=${attempt} media=${originalImageUrls.length} extractor=${extracted.extractor}`
            );
            break;
          }

          extractionErrors.push(`Attempt ${attempt}: no media returned`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown extraction error";
          extractionErrors.push(`Attempt ${attempt}: ${message}`);
          console.error(
            `[posts-save] req=${requestId} extraction_failed platform=${platform} attempt=${attempt} session=${sessionId} message=${message}`,
            error
          );
        }
      }

      if (originalImageUrls.length === 0) {
        console.error(
          `[posts-save] req=${requestId} extraction_exhausted platform=${platform} errors=${extractionErrors.length}`
        );
        return NextResponse.json(
          {
            error:
              "Failed to extract media from this post after multiple attempts. Ensure the DigitalOcean extractor is healthy (SOCIAL_EXTRACTOR_API_URL/TOKEN), Decodo proxy is valid on the extractor server, and instagram_cookies.txt exists on the extractor server root. You can still paste image URLs manually.",
            details: extractionErrors,
            requestId,
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
        console.log(`[posts-save] req=${requestId} og_metadata_failed url=${url}`, error);
      }
    }

    // Download images and upload to R2 (skip invalid candidates instead of failing the whole save)
    if (originalImageUrls.length > 0) {
      try {
        console.log(
          `[posts-save] req=${requestId} r2_upload_start count=${originalImageUrls.length}`
        );

        const uploadedMediaUrls: string[] = [];
        const skippedInvalidMedia: string[] = [];

        for (let index = 0; index < originalImageUrls.length; index += 1) {
          const sourceMediaUrl = originalImageUrls[index];
          const extension = getSafeExtensionFromUrl(sourceMediaUrl);
          const filename = `image-${index + 1}.${extension}`;
          const key = `collections/${collectionId}/posts/${tempPostId}/${filename}`;

          try {
            const uploadedUrl = await downloadAndUploadToR2(sourceMediaUrl, key);
            uploadedMediaUrls.push(uploadedUrl);
          } catch (error) {
            const message = asErrorMessage(error);
            const nonImagePayload =
              message.includes("did not return image bytes") ||
              message.includes("content-type=text/html") ||
              message.includes("content-type=audio/") ||
              message.includes("content-type=video/");

            if (nonImagePayload) {
              skippedInvalidMedia.push(`${sourceMediaUrl} -> ${message}`);
              continue;
            }

            throw error;
          }
        }

        if (skippedInvalidMedia.length > 0) {
          metadata = {
            ...metadata,
            skippedInvalidMediaCount: skippedInvalidMedia.length,
            skippedInvalidMedia: skippedInvalidMedia.slice(0, 8),
          };
        }

        if (uploadedMediaUrls.length === 0) {
          return NextResponse.json(
            {
              error:
                "TikTok extractor returned non-image URLs (HTML/audio/video links). Try a different TikTok URL variant or add image URLs manually.",
              details: skippedInvalidMedia,
              requestId,
            },
            { status: 422 }
          );
        }

        mediaUrls = uploadedMediaUrls;
        thumbnailUrl = mediaUrls[0] || null;
        console.log(`[posts-save] req=${requestId} r2_upload_success count=${mediaUrls.length}`);
      } catch (error) {
        console.error(`[posts-save] req=${requestId} r2_upload_failed`, error);

        const message = asErrorMessage(error);
        const htmlPayloadError = message.includes("did not return image bytes") || message.includes("content-type=text/html");

        if (htmlPayloadError) {
          return NextResponse.json(
            {
              error:
                "TikTok extractor returned non-image URLs (HTML page links). Try a different TikTok URL variant or add image URLs manually.",
              details: message,
              requestId,
            },
            { status: 422 }
          );
        }

        return NextResponse.json(
          {
            error: "Media extraction worked, but upload to R2 failed.",
            details: message,
            requestId,
          },
          { status: 502 }
        );
      }
    }

    // Save to database (with retry for transient network issues)
    const insertPayload = {
      id: tempPostId,
      collection_id: collectionId,
      original_url: url,
      platform,
      post_type: postType,
      title: postTitle,
      description: postDescription,
      media_urls: mediaUrls,
      thumbnail_url: thumbnailUrl,
      metadata: {
        ...metadata,
        requestId,
      },
    };

    const maxDbAttempts = 3;
    let data: SavedPostInsertRow | null = null;
    let lastDbError: unknown = null;

    for (let attempt = 1; attempt <= maxDbAttempts; attempt += 1) {
      const { data: inserted, error: insertError } = await supabase
        .from("saved_posts")
        .insert(insertPayload)
        .select()
        .single();

      if (!insertError) {
        data = inserted as SavedPostInsertRow;
        break;
      }

      const errorCode = insertError.code;

      if (errorCode === "23505") {
        const { data: existingRow, error: fetchExistingError } = await supabase
          .from("saved_posts")
          .select("*")
          .eq("id", tempPostId)
          .maybeSingle();

        if (!fetchExistingError && existingRow) {
          console.log(
            `[posts-save] req=${requestId} db_insert_duplicate_recovered postId=${tempPostId}`
          );
          data = existingRow as SavedPostInsertRow;
          break;
        }
      }

      lastDbError = insertError;
      const shouldRetry = isTransientSupabaseError(insertError);

      if (isTlsHostnameMismatchError(insertError)) {
        break;
      }

      if (!shouldRetry || attempt === maxDbAttempts) {
        break;
      }

      const delayMs = attempt * 600;
      console.warn(
        `[posts-save] req=${requestId} db_insert_retry attempt=${attempt + 1}/${maxDbAttempts} delayMs=${delayMs} message=${asErrorMessage(insertError)}`
      );
      await sleep(delayMs);
    }

    if (!data) {
      throw lastDbError || new Error("Failed to save post");
    }

    console.log(`[posts-save] req=${requestId} success postId=${data.id}`);
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error(`[posts-save] req=${requestId} unexpected_error`, err);

    const details = getErrorDetails(err);

    if (isTlsHostnameMismatchError(err)) {
      return NextResponse.json(
        {
          error:
            "TLS certificate mismatch while connecting to Supabase. This is usually caused by network/ISP interception.",
          details,
          hint:
            "Switch network (VPN/mobile hotspot), or change DNS to 1.1.1.1/8.8.8.8 and retry. The app logic is fine; the DB connection is being intercepted.",
          requestId,
        },
        { status: 503 }
      );
    }

    if (isTransientSupabaseError(err)) {
      return NextResponse.json(
        {
          error: "Temporary network error while saving to Supabase.",
          details,
          requestId,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to save post",
        details,
        requestId,
      },
      { status: 500 }
    );
  }
}
