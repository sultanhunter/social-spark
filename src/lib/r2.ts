import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { fetchWithProxy } from "@/lib/proxy-fetch";

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!;
const R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME!;
const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/\/+$/, "");

if (!R2_PUBLIC_URL) {
  throw new Error(
    "Missing CLOUDFLARE_R2_PUBLIC_URL. Set it to your public r2.dev or custom domain URL so uploaded images can be displayed in the UI."
  );
}

if (R2_PUBLIC_URL.includes("r2.cloudflarestorage.com")) {
  throw new Error(
    "CLOUDFLARE_R2_PUBLIC_URL cannot be the S3 API endpoint. Use your public r2.dev/custom domain URL instead (for example: https://pub-xxxx.r2.dev)."
  );
}

export const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

function encodeKeyForPublicUrl(key: string): string {
  return key
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function getSafeExtensionFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split("/").pop() || "";
    const ext = filename.includes(".") ? filename.split(".").pop() || "" : "";
    if (/^[a-zA-Z0-9]{2,5}$/.test(ext)) {
      return ext.toLowerCase();
    }
  } catch {
    // Ignore parse failures and use default extension.
  }

  return "jpg";
}

function isImageContentType(contentType: string | null): boolean {
  return typeof contentType === "string" && contentType.toLowerCase().startsWith("image/");
}

function inferImageContentTypeFromBytes(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return "image/gif";
  }

  return null;
}

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await r2Client.send(command);
  return `${R2_PUBLIC_URL}/${encodeKeyForPublicUrl(key)}`;
}

export async function getSignedDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(r2Client, command, { expiresIn: 3600 });
}

export function generateMediaKey(collectionId: string, postId: string, filename: string): string {
  return `collections/${collectionId}/posts/${postId}/${filename}`;
}

/**
 * Download an image from a URL and upload it to R2
 * @param imageUrl - The URL of the image to download
 * @param key - The R2 key/path where the image should be stored
 * @returns The public URL of the uploaded image in R2
 */
export async function downloadAndUploadToR2(
  imageUrl: string,
  key: string
): Promise<string> {
  try {
    // Download the image
    const response = await fetchWithProxy(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SocialSpark/1.0)",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate this is actually an image payload (TikTok sometimes returns HTML/error pages).
    const rawContentType = response.headers.get("content-type")?.split(";")[0] || null;
    const inferredContentType = inferImageContentTypeFromBytes(buffer);
    const contentType = isImageContentType(rawContentType)
      ? (rawContentType as string)
      : inferredContentType;

    if (!contentType) {
      throw new Error(
        `Source URL did not return image bytes (content-type=${rawContentType || "unknown"})`
      );
    }

    // Upload to R2
    const r2Url = await uploadToR2(key, buffer, contentType);
    return r2Url;
  } catch (error) {
    console.error("Error downloading and uploading image:", error);
    throw error;
  }
}

/**
 * Download multiple images and upload them to R2
 * @param imageUrls - Array of image URLs to download
 * @param collectionId - Collection ID for organizing files
 * @param postId - Post ID for organizing files
 * @returns Array of R2 URLs
 */
export async function downloadAndUploadMultipleToR2(
  imageUrls: string[],
  collectionId: string,
  postId: string
): Promise<string[]> {
  const uploadPromises = imageUrls.map(async (url, index) => {
    const extension = getSafeExtensionFromUrl(url);
    const filename = `image-${index + 1}.${extension}`;
    const key = generateMediaKey(collectionId, postId, filename);
    return downloadAndUploadToR2(url, key);
  });

  return Promise.all(uploadPromises);
}
