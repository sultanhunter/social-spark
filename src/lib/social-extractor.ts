import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fetchInstagramPost } from "@/lib/instagram";
import { getProxyUrl } from "@/lib/proxy-fetch";
import { fetchTikTokPost } from "@/lib/tiktok";

const execFileAsync = promisify(execFile);

type SupportedPlatform = "instagram" | "tiktok" | "youtube" | "twitter" | "unknown";

export interface ExtractedPostData {
  title: string | null;
  description: string | null;
  mediaUrls: string[];
  extractor: string;
  attempts: number;
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function dedupe(urls: string[]): string[] {
  return Array.from(new Set(urls.filter(Boolean)));
}

function resolveInstagramCookiesFile(): string | null {
  const cookiesInProjectRoot = resolve(process.cwd(), "instagram_cookies.txt");
  return existsSync(cookiesInProjectRoot) ? cookiesInProjectRoot : null;
}

function getLargestThumbnail(entry: Record<string, unknown>): string | null {
  const thumbnails = entry.thumbnails;
  if (!Array.isArray(thumbnails)) return null;

  const candidates = thumbnails
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((thumb) => ({
      url: isHttpUrl(thumb.url) ? thumb.url : null,
      area:
        typeof thumb.width === "number" && typeof thumb.height === "number"
          ? thumb.width * thumb.height
          : 0,
    }))
    .filter((thumb) => thumb.url !== null)
    .sort((a, b) => b.area - a.area);

  return candidates[0]?.url ?? null;
}

function extractUrlsFromEntry(entry: Record<string, unknown>): string[] {
  const urls: string[] = [];

  if (isHttpUrl(entry.url)) urls.push(entry.url);
  if (isHttpUrl(entry.thumbnail)) urls.push(entry.thumbnail);

  const largestThumb = getLargestThumbnail(entry);
  if (largestThumb) urls.push(largestThumb);

  const formats = entry.formats;
  if (Array.isArray(formats)) {
    for (const format of formats) {
      if (!format || typeof format !== "object") continue;
      const candidate = format as Record<string, unknown>;
      if (isHttpUrl(candidate.url)) urls.push(candidate.url);
    }
  }

  return dedupe(urls);
}

function parseYtDlpStdout(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("yt-dlp returned empty output");

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const lines = trimmed.split("\n").reverse();
    for (const line of lines) {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
  }

  throw new Error("Failed to parse yt-dlp JSON output");
}

async function runYtDlp(args: string[]): Promise<Record<string, unknown>> {
  const maxBuffer = 10 * 1024 * 1024;
  const timeout = 120_000;
  const configuredPath = process.env.YT_DLP_PATH || "yt-dlp";

  try {
    const { stdout } = await execFileAsync(configuredPath, args, {
      maxBuffer,
      timeout,
    });
    return parseYtDlpStdout(stdout);
  } catch (error) {
    if (error instanceof Error && /ENOENT/.test(error.message)) {
      const { stdout } = await execFileAsync("python3", ["-m", "yt_dlp", ...args], {
        maxBuffer,
        timeout,
      });
      return parseYtDlpStdout(stdout);
    }

    throw error;
  }
}

async function runGalleryDl(
  url: string,
  platform: SupportedPlatform,
  sessionId?: string
): Promise<string[]> {
  const configuredPath = process.env.GALLERY_DL_PATH || "gallery-dl";
  const args = ["-g", url];

  const proxyUrl = getProxyUrl(sessionId);
  if (proxyUrl) {
    args.unshift(proxyUrl);
    args.unshift("--proxy");
  }

  const cookiesFile = resolveInstagramCookiesFile();
  if (cookiesFile && platform === "instagram") {
    args.unshift(cookiesFile);
    args.unshift("--cookies");
  }

  try {
    const { stdout } = await execFileAsync(configuredPath, args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });

    return dedupe(
      stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^https?:\/\//i.test(line))
    );
  } catch (error) {
    if (error instanceof Error && /ENOENT/.test(error.message)) {
      throw new Error("gallery-dl not found (install with: brew install gallery-dl)");
    }
    throw error;
  }
}

function extractFromYtDlpPayload(payload: Record<string, unknown>): ExtractedPostData {
  const entries = Array.isArray(payload.entries)
    ? payload.entries.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];

  const title = typeof payload.title === "string" ? payload.title : null;
  const description = typeof payload.description === "string" ? payload.description : null;

  if (entries.length === 0) {
    return {
      title,
      description,
      mediaUrls: extractUrlsFromEntry(payload),
      extractor: "yt-dlp",
      attempts: 1,
    };
  }

  const mediaUrls = dedupe(entries.flatMap((entry) => extractUrlsFromEntry(entry)));

  return {
    title,
    description,
    mediaUrls,
    extractor: "yt-dlp",
    attempts: 1,
  };
}

async function extractWithYtDlp(
  url: string,
  platform: SupportedPlatform,
  sessionId?: string
): Promise<ExtractedPostData | null> {
  const args = ["--dump-single-json", "--skip-download", "--no-warnings", "--no-call-home", "--ignore-errors"];

  const proxyUrl = getProxyUrl(sessionId);
  if (proxyUrl) args.push("--proxy", proxyUrl);

  const cookiesFile = resolveInstagramCookiesFile();
  if (cookiesFile && platform === "instagram") {
    args.push("--cookies", cookiesFile);
  }

  const instagramSessionId = process.env.INSTAGRAM_SESSIONID;
  if (instagramSessionId && platform === "instagram") {
    args.push("--add-header", `Cookie: sessionid=${instagramSessionId}`);
  }

  args.push(url);

  const payload = await runYtDlp(args);
  const extracted = extractFromYtDlpPayload(payload);

  if (extracted.mediaUrls.length === 0) {
    return null;
  }

  return extracted;
}

export async function extractSocialPost(
  url: string,
  platform: SupportedPlatform,
  sessionId?: string
): Promise<ExtractedPostData> {
  let galleryDlError: string | null = null;
  let ytDlpError: string | null = null;

  if (platform === "instagram" || platform === "tiktok") {
    try {
      const mediaUrls = await runGalleryDl(url, platform, sessionId);
      if (mediaUrls.length > 0) {
        return {
          title: null,
          description: null,
          mediaUrls,
          extractor: "gallery-dl",
          attempts: 1,
        };
      }
      galleryDlError = "gallery-dl returned no media";
    } catch (error) {
      galleryDlError =
        error instanceof Error ? error.message : "gallery-dl extraction failed";
    }
  }

  if (platform === "instagram" || platform === "tiktok") {
    try {
      const fromYtDlp = await extractWithYtDlp(url, platform, sessionId);
      if (fromYtDlp) {
        return fromYtDlp;
      }
      ytDlpError = "yt-dlp returned no media";
    } catch (error) {
      ytDlpError = error instanceof Error ? error.message : "yt-dlp extraction failed";
    }
  }

  if (platform === "instagram") {
    try {
      const data = await fetchInstagramPost(url);
      return {
        title: data.title,
        description: data.description,
        mediaUrls: dedupe(data.mediaUrls),
        extractor: "instagram-fallback",
        attempts: 1,
      };
    } catch (error) {
      const fallbackError = error instanceof Error ? error.message : "instagram fallback failed";
      if (galleryDlError && ytDlpError) {
        throw new Error(
          `gallery-dl: ${galleryDlError}; yt-dlp: ${ytDlpError}; fallback: ${fallbackError}`
        );
      }
      if (ytDlpError) {
        throw new Error(`yt-dlp: ${ytDlpError}; fallback: ${fallbackError}`);
      }
      if (galleryDlError) {
        throw new Error(`gallery-dl: ${galleryDlError}; fallback: ${fallbackError}`);
      }
      throw error;
    }
  }

  if (platform === "tiktok") {
    try {
      const data = await fetchTikTokPost(url);
      return {
        title: data.title,
        description: data.description,
        mediaUrls: dedupe(data.mediaUrls),
        extractor: "tiktok-fallback",
        attempts: 1,
      };
    } catch (error) {
      const fallbackError = error instanceof Error ? error.message : "tiktok fallback failed";
      if (galleryDlError && ytDlpError) {
        throw new Error(
          `gallery-dl: ${galleryDlError}; yt-dlp: ${ytDlpError}; fallback: ${fallbackError}`
        );
      }
      if (ytDlpError) {
        throw new Error(`yt-dlp: ${ytDlpError}; fallback: ${fallbackError}`);
      }
      if (galleryDlError) {
        throw new Error(`gallery-dl: ${galleryDlError}; fallback: ${fallbackError}`);
      }
      throw error;
    }
  }

  return {
    title: null,
    description: null,
    mediaUrls: [],
    extractor: "none",
    attempts: 1,
  };
}
