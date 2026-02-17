# Image Storage Update

## What Changed

Images are now properly downloaded and stored in Cloudflare R2 instead of just storing external URLs.

### For Saved Posts
When you save a post from Instagram/TikTok/etc:
1. The app fetches metadata (Open Graph images)
2. Downloads all images from the external URLs
3. Uploads them to your R2 bucket
4. Stores the R2 URLs in the database

### For Generated Images
When you generate images with Gemini:
1. Gemini generates images (base64)
2. Images are automatically uploaded to R2
3. R2 URLs are stored in the database

## Benefits

1. **Reliability**: Images won't break if the original source removes them
2. **Speed**: Faster loading from your CDN vs external sources
3. **Control**: You own and control all media assets
4. **Privacy**: No tracking or rate limits from external sources

## Setup Required

### 1. Enable R2 Public Access

You MUST enable public access for images to be viewable. Choose one:

**Option A: R2.dev subdomain (easiest)**
- Go to your R2 bucket → Settings → Public access
- Enable "R2.dev subdomain"
- Copy the URL (e.g., `https://pub-abc123.r2.dev`)

**Option B: Custom domain**
- Connect a custom domain to your bucket
- Better for production (e.g., `https://media.yoursite.com`)

### 2. Add to .env

Add the public URL to your `.env` file:

```bash
CLOUDFLARE_R2_PUBLIC_URL=https://pub-xxxxx.r2.dev
```

### 3. Restart Server

```bash
# Stop the server (Ctrl+C)
npm run dev
```

## File Structure in R2

Images are organized like this:

```
collections/
  {collection-id}/
    posts/
      {post-id}/
        image-1.jpg       # Original saved post images
        image-2.jpg
        generated-1.png   # AI-generated images
        generated-2.png
```

## Testing

1. Save a post from Instagram/TikTok
2. Check your R2 bucket - you should see images uploaded
3. Images should display in the app
4. Generate content - generated images should also appear

## Troubleshooting

### Images not showing
- Verify R2 public access is enabled
- Check `CLOUDFLARE_R2_PUBLIC_URL` in .env
- Restart dev server

### Upload fails
- Check R2 API token permissions (needs Object Read & Write)
- Verify bucket name is correct
- Check account ID

See `R2-SETUP.md` for detailed setup instructions.
