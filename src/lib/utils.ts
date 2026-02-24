import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

export type SocialPlatform = "instagram" | "tiktok" | "threads" | "youtube" | "twitter" | "unknown";

export interface SlideImageSpec {
  width: number;
  height: number;
  aspectRatio: string;
}

export function extractPlatform(url: string): SocialPlatform {
  const normalized = url.trim().toLowerCase();

  let host = "";
  try {
    const parsed = new URL(normalized);
    host = parsed.hostname.toLowerCase();
  } catch {
    host = normalized;
  }

  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("tiktok.com")) return "tiktok";
  if (host.includes("threads.net")) return "threads";
  if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
  if (host.includes("twitter.com") || host.includes("x.com")) return "twitter";
  return "unknown";
}

export function getSlideImageSpec(platform: string): SlideImageSpec {
  switch (platform) {
    case "instagram":
      return { width: 1080, height: 1350, aspectRatio: "4:5" };
    case "tiktok":
      return { width: 1080, height: 1920, aspectRatio: "9:16" };
    case "threads":
      return { width: 1080, height: 1350, aspectRatio: "4:5" };
    case "twitter":
      return { width: 1080, height: 1080, aspectRatio: "1:1" };
    case "youtube":
      return { width: 1080, height: 1920, aspectRatio: "9:16" };
    default:
      return { width: 1080, height: 1350, aspectRatio: "4:5" };
  }
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}
