// TikTok scraping utilities

import { fetchWithProxy, isProxyConfigured } from "@/lib/proxy-fetch";

export interface TikTokPostData {
  title: string | null;
  description: string | null;
  mediaUrls: string[];
  thumbnailUrl: string | null;
  username: string | null;
  isVideo: boolean;
}

function pushFirstValidUrl(candidates: unknown, mediaUrls: string[]) {
  if (!Array.isArray(candidates)) return;
  const url = candidates.find(
    (item): item is string => typeof item === "string" && /^https?:\/\//i.test(item)
  );
  if (url && !mediaUrls.includes(url)) {
    mediaUrls.push(url);
  }
}

function extractImagePostUrls(imagePost: unknown, mediaUrls: string[]) {
  if (!imagePost || typeof imagePost !== "object") return;
  const imagePostRow = imagePost as Record<string, unknown>;
  const images = imagePostRow.images;
  if (!Array.isArray(images)) return;

  for (const image of images) {
    if (!image || typeof image !== "object") continue;
    const imageRow = image as Record<string, unknown>;

    const imageUrlObj =
      typeof imageRow.imageURL === "object" && imageRow.imageURL !== null
        ? (imageRow.imageURL as Record<string, unknown>)
        : null;
    const displayImageObj =
      typeof imageRow.displayImage === "object" && imageRow.displayImage !== null
        ? (imageRow.displayImage as Record<string, unknown>)
        : null;

    pushFirstValidUrl(imageUrlObj?.urlList, mediaUrls);
    pushFirstValidUrl(displayImageObj?.urlList, mediaUrls);
  }
}

/**
 * Extract TikTok video ID from URL
 */
export function extractTikTokVideoId(url: string): string | null {
  // Handle various TikTok URL formats
  // https://www.tiktok.com/@username/video/1234567890
  // https://vm.tiktok.com/ABC123/
  // https://www.tiktok.com/t/ABC123/
  
  const videoMatch = url.match(/tiktok\.com\/@[^\/]+\/video\/(\d+)/);
  if (videoMatch) return videoMatch[1];
  
  const shortMatch = url.match(/(?:vm\.tiktok\.com|tiktok\.com\/t)\/([A-Za-z0-9]+)/);
  if (shortMatch) return shortMatch[1];
  
  return null;
}

/**
 * Fetch TikTok post data
 */
export async function fetchTikTokPost(url: string): Promise<TikTokPostData> {
  console.log(`Fetching TikTok post: ${url}`);
  console.log(`Proxy enabled for scraping: ${isProxyConfigured()}`);

  // First, resolve short URLs
  let finalUrl = url;
  if (url.includes('vm.tiktok.com') || url.includes('tiktok.com/t/')) {
    try {
      const response = await fetchWithProxy(url, {
        method: 'HEAD',
        redirect: 'follow',
      });
      finalUrl = response.url;
    } catch (error) {
      console.log("Failed to resolve short URL:", error);
    }
  }

  // Try to fetch the page and extract data
  try {
    const response = await fetchWithProxy(finalUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch TikTok page: ${response.status}`);
    }

    const html = await response.text();
    return extractTikTokDataFromHTML(html);
  } catch (error) {
    console.error("Failed to fetch TikTok post:", error);
    throw error;
  }
}

/**
 * Extract TikTok data from HTML
 */
function extractTikTokDataFromHTML(html: string): TikTokPostData {
  const mediaUrls: string[] = [];
  let description: string | null = null;
  let username: string | null = null;
  let isVideo = true;

  // Try to find SIGI_STATE data (TikTok's state management)
  const sigiMatch = html.match(/<script[^>]*id="SIGI_STATE"[^>]*>([^<]+)<\/script>/);
  if (sigiMatch) {
    try {
      const sigiData = JSON.parse(sigiMatch[1]);
      const itemModule = sigiData?.ItemModule;
      
      if (itemModule) {
        const videoId = Object.keys(itemModule)[0];
        const videoData = itemModule[videoId];
        
        if (videoData) {
          description = videoData.desc || null;
          username = videoData.author || null;

          if (videoData.imagePost) {
            extractImagePostUrls(videoData.imagePost, mediaUrls);
            if (mediaUrls.length > 0) {
              isVideo = false;
            }
          }
          
          // Get video cover/thumbnail
          if (videoData.video?.cover) {
            mediaUrls.push(videoData.video.cover);
          }
          if (videoData.video?.dynamicCover) {
            mediaUrls.push(videoData.video.dynamicCover);
          }
        }
      }
    } catch (e) {
      console.log("Failed to parse SIGI_STATE");
    }
  }

  // Try to find __UNIVERSAL_DATA_FOR_REHYDRATION__
  const universalMatch = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/);
  if (universalMatch) {
    try {
      const universalData = JSON.parse(universalMatch[1]);
      const defaultScope = universalData?.__DEFAULT_SCOPE__;
      const itemInfo = defaultScope?.["webapp.video-detail"]?.itemInfo?.itemStruct;
      
      if (itemInfo) {
        description = description || itemInfo.desc || null;
        username = username || itemInfo.author?.uniqueId || null;

        if (itemInfo.imagePost) {
          extractImagePostUrls(itemInfo.imagePost, mediaUrls);
          if (mediaUrls.length > 0) {
            isVideo = false;
          }
        }
        
        if (itemInfo.video?.cover && !mediaUrls.includes(itemInfo.video.cover)) {
          mediaUrls.push(itemInfo.video.cover);
        }
        if (itemInfo.video?.originCover && !mediaUrls.includes(itemInfo.video.originCover)) {
          mediaUrls.push(itemInfo.video.originCover);
        }
      }
    } catch (e) {
      console.log("Failed to parse __UNIVERSAL_DATA_FOR_REHYDRATION__");
    }
  }

  // Fallback to meta tags
  if (mediaUrls.length === 0) {
    const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"[^>]*>/i);
    if (ogImage && ogImage[1]) {
      mediaUrls.push(ogImage[1]);
    }
  }

  if (!description) {
    const ogDescription = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i);
    description = ogDescription?.[1] || null;
  }

  return {
    title: description ? description.substring(0, 100) : null,
    description,
    mediaUrls,
    thumbnailUrl: mediaUrls[0] || null,
    username,
    isVideo,
  };
}
