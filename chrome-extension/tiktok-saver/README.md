# TikTok Saver Chrome Extension (MVP)

This extension auto-scrolls TikTok web feed, detects post URLs, and sends them to Social Spark backend batch endpoint:

- Endpoint: `/api/extension/tiktok/batch-save`
- Behavior: Vertex relevance scoring on backend, save relevant posts, trigger video intake for videos.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder: `chrome-extension/tiktok-saver`

## Required backend setup

Set these env vars in Social Spark:

- `VERTEXT_API_KEY`

Existing app vars for Supabase, extractor, and R2 must already be configured.

The relevance model is fixed to `gemini-3.1-flash-lite-preview` in backend code.

## How to run

1. Open TikTok web in a tab.
2. Open extension popup.
3. Set backend URL and target collection ID.
4. Click `Start`.
5. Click `Stop` to halt.
6. Click `Flush` to force-send queued URLs.

## Notes

- Extension supports TikTok URLs only in MVP.
- Queue processing is throttled by `Flush (ms)` and `Batch Size`.
- Duplicate URLs in a run are ignored client-side.
