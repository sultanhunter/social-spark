let observer = null;
let autoScrollTimer = null;
let isRunning = false;

function getPostUrlsFromDom() {
  const elements = Array.from(document.querySelectorAll('[data-e2e="video-author-avatar"]'));
  const urls = [];

  for (const element of elements) {
    const parentContainer = element.closest('[data-e2e="recommend-list-item-container"], .video-feed-item'); // Trying a few common selectors
    if(parentContainer) {
       const wrapperNode = element.closest('a');
       if(wrapperNode && wrapperNode.href) {
            let author = wrapperNode.href.split("/").pop(); // Get @username
            if(!author || !author.startsWith("@")) continue;

            const idNode = parentContainer.querySelector('[id^="xgwrapper-0-"]');
            if(idNode) {
               const videoId = idNode.id.split("-").pop();
               if(videoId) {
                    urls.push(`https://www.tiktok.com/${author}/video/${videoId}`);
               }
            }
       }
    }
  }

  // Backup / fallback for traditional a tags if they exist.
  const anchors = Array.from(document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]'));
  anchors.forEach((anchor) => {
    if(typeof anchor.href === "string" && anchor.href.startsWith("https://www.tiktok.com/")) {
       urls.push(anchor.href);
    }
  });

  return Array.from(new Set(urls));
}

function sendUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return;
  chrome.runtime.sendMessage({
    type: "FOUND_URLS",
    payload: { urls },
  });
}

function startCapture(autoScrollIntervalMs) {
  if (isRunning) return;
  isRunning = true;

  sendUrls(getPostUrlsFromDom());

  observer = new MutationObserver(() => {
    if (!isRunning) return;
    sendUrls(getPostUrlsFromDom());
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  autoScrollTimer = window.setInterval(() => {
    if (!isRunning) return;
    window.scrollBy({ top: window.innerHeight * 0.9, left: 0, behavior: "smooth" });
    sendUrls(getPostUrlsFromDom());
  }, Math.max(500, Number(autoScrollIntervalMs) || 1500));
}

function stopCapture() {
  isRunning = false;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (autoScrollTimer) {
    window.clearInterval(autoScrollTimer);
    autoScrollTimer = null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "START_CAPTURE") {
    startCapture(message?.payload?.autoScrollIntervalMs);
    sendResponse({ ok: true, running: isRunning });
    return true;
  }

  if (message?.type === "STOP_CAPTURE") {
    stopCapture();
    sendResponse({ ok: true, running: isRunning });
    return true;
  }

  return false;
});
