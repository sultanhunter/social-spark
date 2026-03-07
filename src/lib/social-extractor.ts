import { randomUUID } from "crypto";

type SupportedPlatform = "instagram" | "tiktok" | "youtube" | "twitter" | "unknown";

export interface ExtractedPostData {
  title: string | null;
  description: string | null;
  mediaUrls: string[];
  extractor: string;
  attempts: number;
}

export interface ExtractedVideoFrame {
  index: number;
  timestamp: number;
  mimeType: string;
  data: string;
}

export interface ExtractedVideoFramesData {
  title: string | null;
  description: string | null;
  extractor: string;
  videoUrl: string;
  durationSeconds: number | null;
  requestedFrameCount: number;
  extractedFrameCount: number;
  frameWidth: number;
  frames: ExtractedVideoFrame[];
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function dedupe(urls: string[]): string[] {
  return Array.from(new Set(urls.filter(Boolean)));
}

function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = 500): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function parseRemoteError(rawBody: string): { message: string; upstreamRequestId: string | null } {
  const fallbackMessage = truncate(toSingleLine(rawBody || "unknown error"));

  try {
    const parsed = JSON.parse(rawBody) as {
      error?: unknown;
      details?: unknown;
      requestId?: unknown;
    };

    const details = Array.isArray(parsed.details)
      ? parsed.details.join(" | ")
      : typeof parsed.details === "string"
        ? parsed.details
        : "";

    const message =
      (typeof parsed.error === "string" ? parsed.error : "") ||
      details ||
      fallbackMessage;

    const upstreamRequestId =
      typeof parsed.requestId === "string" && parsed.requestId.trim()
        ? parsed.requestId
        : null;

    return {
      message: truncate(toSingleLine(message)),
      upstreamRequestId,
    };
  } catch {
    return { message: fallbackMessage, upstreamRequestId: null };
  }
}

function getRemoteExtractorUrl(): string | null {
  const configured = process.env.SOCIAL_EXTRACTOR_API_URL || process.env.EXTRACTOR_API_URL;
  if (!configured) return null;
  return configured.replace(/\/+$/, "");
}

function getRemoteExtractorHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

async function extractWithRemoteService(
  url: string,
  platform: SupportedPlatform,
  sessionId?: string
): Promise<ExtractedPostData> {
  const baseUrl = getRemoteExtractorUrl();
  if (!baseUrl) {
    throw new Error(
      "Remote extractor is not configured. Set SOCIAL_EXTRACTOR_API_URL on Vercel."
    );
  }

  const requestId = randomUUID().slice(0, 8);
  const token = process.env.SOCIAL_EXTRACTOR_API_TOKEN || process.env.EXTRACTOR_API_TOKEN;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const startedAt = Date.now();
  const endpoint = `${baseUrl}/api/extract-social-post`;

  console.log(
    `[extract-remote] req=${requestId} start host=${getRemoteExtractorHost(baseUrl)} platform=${platform} session=${sessionId ?? "none"} token=${token ? "yes" : "no"}`
  );

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url, platform, sessionId }),
      signal: controller.signal,
    });

    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
      const rawBody = await response.text();
      const parsedError = parseRemoteError(rawBody);
      const upstreamRequest = parsedError.upstreamRequestId
        ? ` upstreamReq=${parsedError.upstreamRequestId}`
        : "";

      console.error(
        `[extract-remote] req=${requestId} failed status=${response.status} elapsedMs=${elapsedMs}${upstreamRequest} message=${parsedError.message}`
      );

      throw new Error(
        `remote extractor request failed (${response.status})${upstreamRequest}: ${parsedError.message}`
      );
    }

    const data = (await response.json()) as {
      title?: unknown;
      description?: unknown;
      mediaUrls?: unknown;
      extractor?: unknown;
      attempts?: unknown;
    };

    const mediaUrls = Array.isArray(data.mediaUrls)
      ? dedupe(data.mediaUrls.filter((item): item is string => isHttpUrl(item)))
      : [];

    if (mediaUrls.length === 0) {
      console.error(
        `[extract-remote] req=${requestId} failed status=200 elapsedMs=${elapsedMs} message=no media URLs in response`
      );
      throw new Error("remote extractor returned no media URLs");
    }

    const extractor =
      typeof data.extractor === "string"
        ? `remote:${data.extractor}`
        : "remote:extractor-service";

    console.log(
      `[extract-remote] req=${requestId} success elapsedMs=${elapsedMs} extractor=${extractor} media=${mediaUrls.length}`
    );

    return {
      title: typeof data.title === "string" ? data.title : null,
      description: typeof data.description === "string" ? data.description : null,
      mediaUrls,
      extractor,
      attempts: typeof data.attempts === "number" ? data.attempts : 1,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(
        `[extract-remote] req=${requestId} timeout elapsedMs=${Date.now() - startedAt}`
      );
      throw new Error("remote extractor timed out after 120s");
    }

    console.error(
      `[extract-remote] req=${requestId} exception elapsedMs=${Date.now() - startedAt}`,
      error
    );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractSocialPost(
  url: string,
  platform: SupportedPlatform,
  sessionId?: string
): Promise<ExtractedPostData> {
  if (platform === "instagram" || platform === "tiktok") {
    return extractWithRemoteService(url, platform, sessionId);
  }

  return {
    title: null,
    description: null,
    mediaUrls: [],
    extractor: "none",
    attempts: 1,
  };
}

export async function extractVideoFrames(
  url: string,
  platform: SupportedPlatform,
  options?: {
    sessionId?: string;
    frameCount?: number;
    frameWidth?: number;
  }
): Promise<ExtractedVideoFramesData> {
  if (platform !== "instagram" && platform !== "tiktok") {
    throw new Error(`Video frame extraction not supported for platform: ${platform}`);
  }

  const baseUrl = getRemoteExtractorUrl();
  if (!baseUrl) {
    throw new Error(
      "Remote extractor is not configured. Set SOCIAL_EXTRACTOR_API_URL on Vercel."
    );
  }

  const requestId = randomUUID().slice(0, 8);
  const token = process.env.SOCIAL_EXTRACTOR_API_TOKEN || process.env.EXTRACTOR_API_TOKEN;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const startedAt = Date.now();
  const endpoint = `${baseUrl}/api/extract-video-frames`;

  console.log(
    `[extract-remote-video] req=${requestId} start host=${getRemoteExtractorHost(baseUrl)} platform=${platform} session=${options?.sessionId ?? "none"} token=${token ? "yes" : "no"}`
  );

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        url,
        platform,
        sessionId: options?.sessionId,
        frameCount: options?.frameCount,
        frameWidth: options?.frameWidth,
      }),
      signal: controller.signal,
    });

    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
      const rawBody = await response.text();
      const parsedError = parseRemoteError(rawBody);
      const upstreamRequest = parsedError.upstreamRequestId
        ? ` upstreamReq=${parsedError.upstreamRequestId}`
        : "";

      console.error(
        `[extract-remote-video] req=${requestId} failed status=${response.status} elapsedMs=${elapsedMs}${upstreamRequest} message=${parsedError.message}`
      );

      throw new Error(
        `remote video extractor request failed (${response.status})${upstreamRequest}: ${parsedError.message}`
      );
    }

    const data = (await response.json()) as {
      title?: unknown;
      description?: unknown;
      extractor?: unknown;
      videoUrl?: unknown;
      durationSeconds?: unknown;
      requestedFrameCount?: unknown;
      extractedFrameCount?: unknown;
      frameWidth?: unknown;
      frames?: unknown;
    };

    const frames = Array.isArray(data.frames)
      ? data.frames
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const row = item as Record<string, unknown>;
            if (typeof row.data !== "string" || !row.data.trim()) return null;

            return {
              index: typeof row.index === "number" ? row.index : 0,
              timestamp: typeof row.timestamp === "number" ? row.timestamp : 0,
              mimeType: typeof row.mimeType === "string" ? row.mimeType : "image/jpeg",
              data: row.data,
            } satisfies ExtractedVideoFrame;
          })
          .filter((item): item is ExtractedVideoFrame => Boolean(item))
      : [];

    if (typeof data.videoUrl !== "string" || !isHttpUrl(data.videoUrl)) {
      throw new Error("remote video extractor returned no direct video URL");
    }

    if (frames.length === 0) {
      throw new Error("remote video extractor returned zero frames");
    }

    const extractor =
      typeof data.extractor === "string"
        ? `remote:${data.extractor}`
        : "remote:extractor-service";

    console.log(
      `[extract-remote-video] req=${requestId} success elapsedMs=${elapsedMs} extractor=${extractor} frames=${frames.length}`
    );

    return {
      title: typeof data.title === "string" ? data.title : null,
      description: typeof data.description === "string" ? data.description : null,
      extractor,
      videoUrl: data.videoUrl,
      durationSeconds:
        typeof data.durationSeconds === "number" && Number.isFinite(data.durationSeconds)
          ? data.durationSeconds
          : null,
      requestedFrameCount:
        typeof data.requestedFrameCount === "number" && Number.isFinite(data.requestedFrameCount)
          ? data.requestedFrameCount
          : frames.length,
      extractedFrameCount:
        typeof data.extractedFrameCount === "number" && Number.isFinite(data.extractedFrameCount)
          ? data.extractedFrameCount
          : frames.length,
      frameWidth:
        typeof data.frameWidth === "number" && Number.isFinite(data.frameWidth)
          ? data.frameWidth
          : 960,
      frames,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(
        `[extract-remote-video] req=${requestId} timeout elapsedMs=${Date.now() - startedAt}`
      );
      throw new Error("remote video extractor timed out after 180s");
    }

    console.error(
      `[extract-remote-video] req=${requestId} exception elapsedMs=${Date.now() - startedAt}`,
      error
    );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
