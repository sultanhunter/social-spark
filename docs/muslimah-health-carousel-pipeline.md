# muslimah.health Carousel Pipeline

Endpoint:

```txt
POST /api/muslimah-carousel/generate
```

Environment:

```txt
OPENAI_API_KEY=...
CLOUDFLARE_R2_ACCOUNT_ID=...
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
CLOUDFLARE_R2_BUCKET_NAME=...
CLOUDFLARE_R2_PUBLIC_URL=...
INSTAGRAM_GRAPH_ACCESS_TOKEN=...        # only needed when publish=true
INSTAGRAM_GRAPH_USER_ID=...             # only needed when publish=true
MUSLIMAH_CAROUSEL_REFERENCE_IMAGE_PATHS=/absolute/hook.png,/absolute/chat.png
SOCIAL_EXTRACTOR_API_URL=https://your-existing-render-service.onrender.com
SOCIAL_EXTRACTOR_API_TOKEN=...          # same token as Render
MUSLIMAH_CAROUSEL_CALLBACK_TOKEN=...    # optional; otherwise SOCIAL_EXTRACTOR_API_TOKEN is reused
MUSLIMAH_CAROUSEL_CALLBACK_BASE_URL=... # optional; otherwise Vercel/request origin is used
MUSLIMAH_CAROUSEL_WORKER_URL=...        # optional override; otherwise derived from SOCIAL_EXTRACTOR_API_URL
MUSLIMAH_CAROUSEL_WORKER_TOKEN=...      # optional override; otherwise SOCIAL_EXTRACTOR_API_TOKEN is reused
```

Default models and image settings:

```txt
Script: gpt-5.5 via Responses API structured JSON
Images: gpt-image-2 via Images API
Quality: medium
Size: 1024x1536, normalized to 1080x1920 PNG before R2 upload
```

Generate script and images:

```bash
curl -X POST http://localhost:3000/api/muslimah-carousel/generate \
  -H "Content-Type: application/json" \
  -d '{
    "focus": "prayer, ghusl, skincare and energy",
    "previousHookBackground": "pink satin",
    "previousFeatures": ["Prayer", "Nutrition tracking"],
    "generateImages": true,
    "publish": false
  }'
```

This returns `202` with a `jobId` after the existing Render service worker is started. Poll the job:

```bash
curl http://localhost:3000/api/muslimah-carousel/jobs/JOB_ID
```

Generate script only:

```bash
curl -X POST http://localhost:3000/api/muslimah-carousel/generate \
  -H "Content-Type: application/json" \
  -d '{ "generateImages": false }'
```

Generate from an approved script:

```bash
curl -X POST http://localhost:3000/api/muslimah-carousel/generate \
  -H "Content-Type: application/json" \
  -d '{
    "script": { "...": "the approved muslimah.health JSON" },
    "generateImages": true
  }'
```

Publish after generation:

```bash
curl -X POST http://localhost:3000/api/muslimah-carousel/generate \
  -H "Content-Type: application/json" \
  -d '{
    "generateImages": true,
    "publish": true
  }'
```

Notes:

- The implemented carousel count is 10 slides because the requested structure is hook, 8 chat/reveal slides, and CTA, and Instagram carousel publishing in this app caps at 10 images.
- The public generate route stays under the 300-second serverless cap. Long image generation runs on the existing `social-extractor-render` backend at `/api/muslimah-carousel/worker`.
- Render returns `202` immediately, then calls back to `social-spark` at `/api/muslimah-carousel/jobs/{jobId}/complete` when the job completes or fails.
- Render does not need Supabase credentials for this pipeline.
- The worker sends the attached style references to the image edit endpoint for every generated slide when `referenceImagePaths` or `MUSLIMAH_CAROUSEL_REFERENCE_IMAGE_PATHS` is configured.
- Publishing is opt-in. The default job result returns R2 image URLs for review before posting.
- Run the `muslimah_carousel_jobs` SQL from `supabase-migration.sql` before using image generation jobs.
