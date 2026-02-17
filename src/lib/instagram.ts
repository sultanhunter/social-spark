// Instagram scraping utilities using Instagram's internal API

import { fetchWithProxy, isProxyConfigured } from "@/lib/proxy-fetch";

export interface InstagramPostData {
  title: string | null;
  description: string | null;
  mediaUrls: string[];
  thumbnailUrl: string | null;
  username: string | null;
}

/**
 * Extract Instagram post ID (shortcode) from URL
 */
export function extractInstagramPostId(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Fetch Instagram post using the internal GraphQL API
 * This is the same API Instagram's website uses
 */
export async function fetchInstagramPost(url: string): Promise<InstagramPostData> {
  const shortcode = extractInstagramPostId(url);
  
  if (!shortcode) {
    throw new Error("Invalid Instagram URL - could not extract post ID");
  }

  console.log(`Fetching Instagram post: ${shortcode}`);
  console.log(`Proxy enabled for scraping: ${isProxyConfigured()}`);

  // Method 1: Try the __a=1 endpoint (sometimes works)
  try {
    const jsonUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
    const response = await fetchWithProxy(jsonUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (response.ok) {
      const data = await response.json();
      const media = data?.graphql?.shortcode_media || data?.items?.[0];
      
      if (media) {
        return extractMediaFromGraphQL(media);
      }
    }
  } catch (error) {
    console.log("Method 1 (__a=1) failed:", error);
  }

  // Method 2: Try the embed endpoint
  try {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const response = await fetchWithProxy(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (response.ok) {
      const html = await response.text();
      return extractMediaFromEmbed(html);
    }
  } catch (error) {
    console.log("Method 2 (embed) failed:", error);
  }

  // Method 3: GraphQL query endpoint
  try {
    const queryHash = "b3055c01b4b222b8a47dc12b090e4e64"; // Instagram's public query hash for posts
    const variables = JSON.stringify({ shortcode, child_comment_count: 0, fetch_comment_count: 0, parent_comment_count: 0, has_threaded_comments: false });
    
    const graphqlUrl = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(variables)}`;
    
    const response = await fetchWithProxy(graphqlUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (response.ok) {
      const data = await response.json();
      const media = data?.data?.shortcode_media;
      
      if (media) {
        return extractMediaFromGraphQL(media);
      }
    }
  } catch (error) {
    console.log("Method 3 (GraphQL) failed:", error);
  }

  // Method 4: Scrape the HTML page and extract from script tags
  try {
    const pageUrl = `https://www.instagram.com/p/${shortcode}/`;
    const response = await fetchWithProxy(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
    });

    if (response.ok) {
      const html = await response.text();
      return extractMediaFromHTML(html);
    }
  } catch (error) {
    console.log("Method 4 (HTML scrape) failed:", error);
  }

  throw new Error("All Instagram fetch methods failed. The post may be private or Instagram is blocking requests.");
}

/**
 * Extract media from Instagram's GraphQL response
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMediaFromGraphQL(media: any): InstagramPostData {
  const mediaUrls: string[] = [];
  
  // Check if it's a carousel (sidecar)
  if (media.edge_sidecar_to_children?.edges) {
    for (const edge of media.edge_sidecar_to_children.edges) {
      const node = edge.node;
      if (node.is_video) {
        // For videos, get the video URL or thumbnail
        mediaUrls.push(node.video_url || node.display_url);
      } else {
        mediaUrls.push(node.display_url);
      }
    }
  } else if (media.is_video) {
    // Single video
    mediaUrls.push(media.video_url || media.display_url);
  } else {
    // Single image
    mediaUrls.push(media.display_url);
  }

  // Get caption
  const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text || 
                  media.caption?.text || 
                  null;

  return {
    title: caption ? caption.substring(0, 100) : null,
    description: caption,
    mediaUrls,
    thumbnailUrl: mediaUrls[0] || null,
    username: media.owner?.username || null,
  };
}

/**
 * Extract media from Instagram embed page
 */
function extractMediaFromEmbed(html: string): InstagramPostData {
  const mediaUrls: string[] = [];

  // Find all image URLs in the embed
  // Look for EmbeddedMediaImage
  const imgMatches = html.matchAll(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/g);
  for (const match of imgMatches) {
    const url = match[1].replace(/&amp;/g, '&');
    if (!mediaUrls.includes(url)) {
      mediaUrls.push(url);
    }
  }

  // Also try to find display_url in any embedded JSON
  const displayUrlMatches = html.matchAll(/"display_url"\s*:\s*"([^"]+)"/g);
  for (const match of displayUrlMatches) {
    const url = match[1]
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"');
    if (!mediaUrls.includes(url)) {
      mediaUrls.push(url);
    }
  }

  // Try to get high-res versions
  const srcMatches = html.matchAll(/src="(https:\/\/[^"]*instagram[^"]*\.jpg[^"]*)"/g);
  for (const match of srcMatches) {
    const url = match[1].replace(/&amp;/g, '&');
    if (!mediaUrls.includes(url) && !url.includes('150x150')) {
      mediaUrls.push(url);
    }
  }

  // Get caption
  const captionMatch = html.match(/class="Caption"[^>]*>[\s\S]*?<div[^>]*>([^<]+)/);
  const caption = captionMatch ? captionMatch[1].trim() : null;

  // Get username
  const usernameMatch = html.match(/class="UsernameText"[^>]*>([^<]+)/);
  const username = usernameMatch ? usernameMatch[1].trim() : null;

  return {
    title: caption ? caption.substring(0, 100) : null,
    description: caption,
    mediaUrls,
    thumbnailUrl: mediaUrls[0] || null,
    username,
  };
}

/**
 * Extract media from Instagram HTML page
 */
function extractMediaFromHTML(html: string): InstagramPostData {
  const mediaUrls: string[] = [];

  // Try to find the shared data script
  const sharedDataMatch = html.match(/window\._sharedData\s*=\s*(\{.+?\});<\/script>/);
  if (sharedDataMatch) {
    try {
      const sharedData = JSON.parse(sharedDataMatch[1]);
      const media = sharedData?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;
      if (media) {
        return extractMediaFromGraphQL(media);
      }
    } catch (e) {
      console.log("Failed to parse _sharedData");
    }
  }

  // Try to find additional data script
  const additionalDataMatch = html.match(/window\.__additionalDataLoaded\s*\([^,]+,\s*(\{.+?\})\s*\)/);
  if (additionalDataMatch) {
    try {
      const additionalData = JSON.parse(additionalDataMatch[1]);
      const media = additionalData?.graphql?.shortcode_media || additionalData?.items?.[0];
      if (media) {
        return extractMediaFromGraphQL(media);
      }
    } catch (e) {
      console.log("Failed to parse __additionalDataLoaded");
    }
  }

  // Fallback: Extract from meta tags and any JSON in the page
  const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"[^>]*>/i);
  if (ogImage && ogImage[1]) {
    mediaUrls.push(ogImage[1]);
  }

  // Try to find display_url in any script
  const displayUrlMatches = html.matchAll(/"display_url"\s*:\s*"([^"]+)"/g);
  for (const match of displayUrlMatches) {
    const url = match[1]
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"');
    if (!mediaUrls.includes(url)) {
      mediaUrls.push(url);
    }
  }

  const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i);
  const ogDescription = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i);

  return {
    title: ogTitle?.[1] || null,
    description: ogDescription?.[1] || null,
    mediaUrls,
    thumbnailUrl: mediaUrls[0] || null,
    username: null,
  };
}
