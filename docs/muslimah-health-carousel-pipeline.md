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
- The route sends the attached style references to the image edit endpoint for every generated slide when `referenceImagePaths` or `MUSLIMAH_CAROUSEL_REFERENCE_IMAGE_PATHS` is configured.
- Publishing is opt-in. The default returns R2 image URLs for review before posting.
