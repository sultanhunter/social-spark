const DEFAULT_GRAPH_API_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION || "v22.0";
const GRAPH_BASE_URL = "https://graph.facebook.com";

interface InstagramGraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

interface GraphResponseWithError {
  error?: InstagramGraphError;
}

interface GraphCreateContainerResponse extends GraphResponseWithError {
  id?: string;
}

interface GraphPublishResponse extends GraphResponseWithError {
  id?: string;
}

interface GraphMediaResponse extends GraphResponseWithError {
  id?: string;
  permalink?: string;
}

export interface PublishInstagramPostSetInput {
  accessToken: string;
  igUserId: string;
  imageUrls: string[];
  caption?: string;
  apiVersion?: string;
}

export interface PublishInstagramPostSetResult {
  mediaId: string;
  permalink: string | null;
  containerId: string;
  childrenContainerIds: string[];
  imageCount: number;
  usedCarousel: boolean;
}

function sanitizeCaption(raw: string | undefined): string {
  if (!raw) return "";
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= 2200) return normalized;
  return normalized.slice(0, 2197).trimEnd() + "...";
}

function normalizeImageUrls(rawUrls: string[]): string[] {
  return Array.from(
    new Set(
      rawUrls
        .filter((url) => typeof url === "string")
        .map((url) => url.trim())
        .filter((url) => /^https?:\/\//i.test(url))
    )
  ).slice(0, 10);
}

function formatGraphError(payload: GraphResponseWithError, fallback: string): string {
  const err = payload.error;
  if (!err) return fallback;
  const code = typeof err.code === "number" ? ` (code ${err.code})` : "";
  return `${err.message || fallback}${code}`;
}

async function graphPost<T extends GraphResponseWithError>(
  path: string,
  params: Record<string, string>,
  accessToken: string,
  apiVersion: string
): Promise<T> {
  const body = new URLSearchParams({
    ...params,
    access_token: accessToken,
  });

  const response = await fetch(`${GRAPH_BASE_URL}/${apiVersion}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = (await response.json()) as T;

  if (!response.ok || payload.error) {
    throw new Error(formatGraphError(payload, "Instagram Graph API request failed."));
  }

  return payload;
}

async function graphGet<T extends GraphResponseWithError>(
  path: string,
  params: Record<string, string>,
  accessToken: string,
  apiVersion: string
): Promise<T> {
  const query = new URLSearchParams({
    ...params,
    access_token: accessToken,
  });

  const response = await fetch(`${GRAPH_BASE_URL}/${apiVersion}/${path}?${query.toString()}`);
  const payload = (await response.json()) as T;

  if (!response.ok || payload.error) {
    throw new Error(formatGraphError(payload, "Instagram Graph API request failed."));
  }

  return payload;
}

function isContainerNotReadyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();

  return (
    message.includes("not finished") ||
    message.includes("not ready") ||
    message.includes("is being processed") ||
    message.includes("try again")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function createImageContainer({
  igUserId,
  imageUrl,
  caption,
  accessToken,
  apiVersion,
  isCarouselItem,
}: {
  igUserId: string;
  imageUrl: string;
  caption?: string;
  accessToken: string;
  apiVersion: string;
  isCarouselItem: boolean;
}): Promise<string> {
  const payload = await graphPost<GraphCreateContainerResponse>(
    `${igUserId}/media`,
    {
      image_url: imageUrl,
      ...(caption ? { caption } : {}),
      ...(isCarouselItem ? { is_carousel_item: "true" } : {}),
    },
    accessToken,
    apiVersion
  );

  if (!payload.id) {
    throw new Error("Instagram did not return a media container id.");
  }

  return payload.id;
}

async function createCarouselContainer({
  igUserId,
  children,
  caption,
  accessToken,
  apiVersion,
}: {
  igUserId: string;
  children: string[];
  caption?: string;
  accessToken: string;
  apiVersion: string;
}): Promise<string> {
  const payload = await graphPost<GraphCreateContainerResponse>(
    `${igUserId}/media`,
    {
      media_type: "CAROUSEL",
      children: children.join(","),
      ...(caption ? { caption } : {}),
    },
    accessToken,
    apiVersion
  );

  if (!payload.id) {
    throw new Error("Instagram did not return a carousel container id.");
  }

  return payload.id;
}

async function publishContainerWithRetry({
  igUserId,
  containerId,
  accessToken,
  apiVersion,
}: {
  igUserId: string;
  containerId: string;
  accessToken: string;
  apiVersion: string;
}): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const payload = await graphPost<GraphPublishResponse>(
        `${igUserId}/media_publish`,
        { creation_id: containerId },
        accessToken,
        apiVersion
      );

      if (!payload.id) {
        throw new Error("Instagram did not return a published media id.");
      }

      return payload.id;
    } catch (error) {
      if (!isContainerNotReadyError(error) || attempt === 8) {
        lastError = error instanceof Error ? error : new Error("Failed to publish Instagram media.");
        break;
      }

      await sleep(2000 * attempt);
    }
  }

  throw lastError || new Error("Failed to publish Instagram media.");
}

async function fetchPermalink({
  mediaId,
  accessToken,
  apiVersion,
}: {
  mediaId: string;
  accessToken: string;
  apiVersion: string;
}): Promise<string | null> {
  try {
    const payload = await graphGet<GraphMediaResponse>(
      mediaId,
      {
        fields: "id,permalink",
      },
      accessToken,
      apiVersion
    );

    return typeof payload.permalink === "string" && payload.permalink.trim().length > 0
      ? payload.permalink
      : null;
  } catch {
    return null;
  }
}

export async function publishInstagramPostSet(
  input: PublishInstagramPostSetInput
): Promise<PublishInstagramPostSetResult> {
  const apiVersion = input.apiVersion || DEFAULT_GRAPH_API_VERSION;
  const caption = sanitizeCaption(input.caption);
  const imageUrls = normalizeImageUrls(input.imageUrls);

  if (imageUrls.length === 0) {
    throw new Error("At least one valid public image URL is required for Instagram publishing.");
  }

  if (imageUrls.length > 10) {
    throw new Error("Instagram supports up to 10 images per carousel.");
  }

  if (imageUrls.length === 1) {
    const containerId = await createImageContainer({
      igUserId: input.igUserId,
      imageUrl: imageUrls[0],
      caption,
      accessToken: input.accessToken,
      apiVersion,
      isCarouselItem: false,
    });

    const mediaId = await publishContainerWithRetry({
      igUserId: input.igUserId,
      containerId,
      accessToken: input.accessToken,
      apiVersion,
    });

    const permalink = await fetchPermalink({
      mediaId,
      accessToken: input.accessToken,
      apiVersion,
    });

    return {
      mediaId,
      permalink,
      containerId,
      childrenContainerIds: [],
      imageCount: 1,
      usedCarousel: false,
    };
  }

  const childrenContainerIds = await Promise.all(
    imageUrls.map((imageUrl) =>
      createImageContainer({
        igUserId: input.igUserId,
        imageUrl,
        accessToken: input.accessToken,
        apiVersion,
        isCarouselItem: true,
      })
    )
  );

  const containerId = await createCarouselContainer({
    igUserId: input.igUserId,
    children: childrenContainerIds,
    caption,
    accessToken: input.accessToken,
    apiVersion,
  });

  const mediaId = await publishContainerWithRetry({
    igUserId: input.igUserId,
    containerId,
    accessToken: input.accessToken,
    apiVersion,
  });

  const permalink = await fetchPermalink({
    mediaId,
    accessToken: input.accessToken,
    apiVersion,
  });

  return {
    mediaId,
    permalink,
    containerId,
    childrenContainerIds,
    imageCount: imageUrls.length,
    usedCarousel: true,
  };
}
