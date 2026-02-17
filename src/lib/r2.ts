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

    // Determine content type from response or URL
    const contentType =
      response.headers.get("content-type") || "image/jpeg";

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
