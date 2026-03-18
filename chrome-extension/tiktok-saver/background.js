const DEFAULT_CONFIG = {
  backendUrl: "http://localhost:3000",
  collectionId: "7579367d-a324-4995-b326-f21f6deb02ea",
  confidenceThreshold: 0.6,
  batchSize: 3,
  flushIntervalMs: 4000,
  autoScrollIntervalMs: 1500,
};

const state = {
  running: false,
  tabId: null,
  config: { ...DEFAULT_CONFIG },
  queue: [],
  seenUrls: new Set(),
  inFlight: false,
  stats: {
    detected: 0,
    queued: 0,
    sentBatches: 0,
    saved: 0,
    skipped: 0,
    failed: 0,
    lastError: "",
    lastRunAt: null,
  },
};

let flushTimer = null;

function emitStats() {
  chrome.runtime.sendMessage({ type: "STATS_UPDATED", payload: { ...state.stats, running: state.running } });
}

function normalizeUrl(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function enqueueUrls(urls) {
  const normalized = urls.map(normalizeUrl).filter(Boolean);
  for (const url of normalized) {
    if (state.seenUrls.has(url)) continue;
    state.seenUrls.add(url);
    state.queue.push(url);
    state.stats.detected += 1;
  }
  state.stats.queued = state.queue.length;
  emitStats();
  scheduleFlush();
}

function scheduleFlush() {
  if (!state.running) return;
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushQueue();
  }, state.config.flushIntervalMs);
}

async function flushQueue() {
  if (!state.running || state.inFlight) return;
  if (state.queue.length === 0) return;

  state.inFlight = true;
  const batch = state.queue.splice(0, Math.max(1, state.config.batchSize));
  state.stats.queued = state.queue.length;

  try {
    const endpoint = `${state.config.backendUrl.replace(/\/+$/, "")}/api/extension/tiktok/batch-save`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        collectionId: state.config.collectionId,
        urls: batch,
        confidenceThreshold: state.config.confidenceThreshold,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Batch save failed (${response.status}): ${body.slice(0, 250)}`);
    }

    const payload = await response.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];

    state.stats.sentBatches += 1;
    state.stats.lastRunAt = new Date().toISOString();
    state.stats.saved += results.filter((item) => String(item.status || "").startsWith("saved_")).length;
    state.stats.skipped += results.filter((item) => String(item.status || "").startsWith("skipped_")).length;
    state.stats.failed += results.filter((item) => item.status === "failed").length;
    state.stats.lastError = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    state.stats.failed += batch.length;
    state.stats.lastError = message;
  } finally {
    state.inFlight = false;
    state.stats.queued = state.queue.length;
    emitStats();
    if (state.queue.length > 0) scheduleFlush();
  }
}

async function sendStartToTab() {
  if (typeof state.tabId !== "number") return;
  try {
    await chrome.tabs.sendMessage(state.tabId, {
      type: "START_CAPTURE",
      payload: {
        autoScrollIntervalMs: state.config.autoScrollIntervalMs,
      },
    });
  } catch {
    // Content script might not be ready yet.
  }
}

async function sendStopToTab() {
  if (typeof state.tabId !== "number") return;
  try {
    await chrome.tabs.sendMessage(state.tabId, { type: "STOP_CAPTURE" });
  } catch {
    // Ignore tab messaging failures during stop.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;

  if (type === "FOUND_URLS") {
    if (state.running && Array.isArray(message?.payload?.urls)) {
      enqueueUrls(message.payload.urls);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (type === "START_RUN") {
    const config = message?.payload?.config || {};
    const tabIdFromPayload = Number(message?.payload?.tabId);
    state.config = {
      ...DEFAULT_CONFIG,
      ...state.config,
      ...config,
      backendUrl: String(config.backendUrl || state.config.backendUrl || DEFAULT_CONFIG.backendUrl),
      collectionId: String(config.collectionId || DEFAULT_CONFIG.collectionId),
      confidenceThreshold: Number(config.confidenceThreshold || DEFAULT_CONFIG.confidenceThreshold),
      batchSize: Number(config.batchSize || DEFAULT_CONFIG.batchSize),
      flushIntervalMs: Number(config.flushIntervalMs || DEFAULT_CONFIG.flushIntervalMs),
      autoScrollIntervalMs: Number(config.autoScrollIntervalMs || DEFAULT_CONFIG.autoScrollIntervalMs),
    };

    state.tabId = Number.isInteger(tabIdFromPayload)
      ? tabIdFromPayload
      : sender?.tab?.id ?? null;
    state.running = true;
    state.stats.lastError = "";
    emitStats();
    sendStartToTab();

    sendResponse({ ok: true, running: state.running });
    return true;
  }

  if (type === "STOP_RUN") {
    state.running = false;
    state.inFlight = false;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    sendStopToTab();
    emitStats();
    sendResponse({ ok: true, running: state.running });
    return true;
  }

  if (type === "FLUSH_NOW") {
    flushQueue().then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (type === "GET_STATUS") {
    sendResponse({
      ok: true,
      payload: {
        running: state.running,
        stats: state.stats,
        queueLength: state.queue.length,
      },
    });
    return true;
  }

  return false;
});
