const ids = {
  backendUrl: document.getElementById("backendUrl"),
  collectionId: document.getElementById("collectionId"),
  confidenceThreshold: document.getElementById("confidenceThreshold"),
  batchSize: document.getElementById("batchSize"),
  flushIntervalMs: document.getElementById("flushIntervalMs"),
  autoScrollIntervalMs: document.getElementById("autoScrollIntervalMs"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  flushBtn: document.getElementById("flushBtn"),
  running: document.getElementById("running"),
  detected: document.getElementById("detected"),
  queued: document.getElementById("queued"),
  saved: document.getElementById("saved"),
  skipped: document.getElementById("skipped"),
  failed: document.getElementById("failed"),
  lastError: document.getElementById("lastError"),
};

const STORAGE_KEY = "socialSparkTikTokSaverConfig";
const DEFAULT_COLLECTION_ID = "7579367d-a324-4995-b326-f21f6deb02ea";

function asNumber(input, fallback) {
  const value = Number(input.value);
  return Number.isNaN(value) ? fallback : value;
}

function updateStats(payload) {
  const stats = payload?.stats || {};
  ids.running.textContent = `Running: ${payload?.running ? "yes" : "no"}`;
  ids.detected.textContent = `Detected: ${stats.detected || 0}`;
  ids.queued.textContent = `Queued: ${payload?.queueLength ?? stats.queued ?? 0}`;
  ids.saved.textContent = `Saved: ${stats.saved || 0}`;
  ids.skipped.textContent = `Skipped: ${stats.skipped || 0}`;
  ids.failed.textContent = `Failed: ${stats.failed || 0}`;
  ids.lastError.textContent = `Last error: ${stats.lastError || "none"}`;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function loadConfig() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const config = stored?.[STORAGE_KEY] || {};

  ids.backendUrl.value = config.backendUrl || "http://localhost:3000";
  ids.collectionId.value = config.collectionId || DEFAULT_COLLECTION_ID;
  ids.confidenceThreshold.value = String(config.confidenceThreshold || 0.6);
  ids.batchSize.value = String(config.batchSize || 3);
  ids.flushIntervalMs.value = String(config.flushIntervalMs || 4000);
  ids.autoScrollIntervalMs.value = String(config.autoScrollIntervalMs || 1500);
}

async function saveConfig(config) {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}

function collectConfig() {
  return {
    backendUrl: ids.backendUrl.value.trim(),
    collectionId: ids.collectionId.value.trim(),
    confidenceThreshold: asNumber(ids.confidenceThreshold, 0.6),
    batchSize: asNumber(ids.batchSize, 3),
    flushIntervalMs: asNumber(ids.flushIntervalMs, 4000),
    autoScrollIntervalMs: asNumber(ids.autoScrollIntervalMs, 1500),
  };
}

async function sendToBackground(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload });
}

ids.startBtn.addEventListener("click", async () => {
  const config = collectConfig();
  if (!config.backendUrl || !config.collectionId) {
    ids.lastError.textContent = "Last error: Backend URL and Collection ID are required";
    return;
  }

  await saveConfig(config);
  const activeTab = await getActiveTab();
  if (!activeTab || !activeTab.url || !activeTab.url.includes("tiktok.com")) {
    ids.lastError.textContent = "Last error: Open a TikTok tab before starting";
    return;
  }

  await chrome.tabs.sendMessage(activeTab.id, { type: "START_CAPTURE", payload: { autoScrollIntervalMs: config.autoScrollIntervalMs } }).catch(() => {
    // If this fails, background start may still recover once content script wakes.
  });

  const result = await sendToBackground("START_RUN", { config, tabId: activeTab.id });
  if (!result?.ok) {
    ids.lastError.textContent = "Last error: Failed to start run";
  }
  refreshStatus();
});

ids.stopBtn.addEventListener("click", async () => {
  await sendToBackground("STOP_RUN");
  refreshStatus();
});

ids.flushBtn.addEventListener("click", async () => {
  await sendToBackground("FLUSH_NOW");
  refreshStatus();
});

async function refreshStatus() {
  const status = await sendToBackground("GET_STATUS");
  if (status?.ok) updateStats(status.payload);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "STATS_UPDATED") {
    updateStats(message.payload);
  }
});

loadConfig().then(refreshStatus);
