import { ProxyAgent, fetch as undiciFetch } from "undici";

type FetchMode = "auto" | "proxy" | "direct";

let cachedAgent: ProxyAgent | null = null;

function withOptionalSession(username: string, sessionId?: string): string {
  if (!sessionId) return username;
  if (process.env.DECODO_PROXY_USE_SESSION !== "true") return username;
  if (username.includes("session-")) return username;
  return `${username}-session-${sessionId}`;
}

export function getProxyUrl(sessionId?: string): string | null {
  const directUrl = process.env.DECODO_PROXY_URL || process.env.PROXY_URL;
  if (directUrl) return directUrl;

  const host = process.env.DECODO_PROXY_HOST || process.env.PROXY_HOST;
  const port = process.env.DECODO_PROXY_PORT || process.env.PROXY_PORT;
  const username =
    process.env.DECODO_PROXY_USERNAME || process.env.PROXY_USERNAME;
  const password =
    process.env.DECODO_PROXY_PASSWORD || process.env.PROXY_PASSWORD;

  if (!host || !port || !username || !password) return null;

  const finalUsername = withOptionalSession(username, sessionId);

  const encodedUsername = encodeURIComponent(finalUsername);
  const encodedPassword = encodeURIComponent(password);
  return `http://${encodedUsername}:${encodedPassword}@${host}:${port}`;
}

function getProxyAgent(): ProxyAgent | null {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return null;

  if (!cachedAgent) {
    cachedAgent = new ProxyAgent(proxyUrl);
  }

  return cachedAgent;
}

export function isProxyConfigured(): boolean {
  return Boolean(getProxyUrl());
}

export async function fetchWithProxy(
  url: string,
  init: RequestInit = {},
  mode: FetchMode = "auto"
): Promise<Response> {
  if (mode === "direct") {
    return fetch(url, init);
  }

  const proxyAgent = getProxyAgent();

  if (mode === "proxy") {
    if (!proxyAgent) {
      throw new Error(
        "Proxy mode requested but Decodo proxy is not configured"
      );
    }

    return (await undiciFetch(url, {
      ...(init as object),
      dispatcher: proxyAgent,
    })) as unknown as Response;
  }

  if (proxyAgent) {
    try {
      return (await undiciFetch(url, {
        ...(init as object),
        dispatcher: proxyAgent,
      })) as unknown as Response;
    } catch {
      return fetch(url, init);
    }
  }

  return fetch(url, init);
}
