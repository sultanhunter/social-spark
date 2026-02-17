# Cloudflare R2 Setup Guide

## 1. Create R2 Bucket

1. Go to Cloudflare Dashboard → R2
2. Click "Create bucket"
3. Enter a bucket name (e.g., `social-spark-media`)
4. Click "Create bucket"

## 2. Enable Public Access

### Option A: Custom Domain (Recommended)

1. In your bucket settings, go to **Settings** → **Public access**
2. Click **Connect Domain**
3. Choose a subdomain or custom domain (e.g., `media.yourdomain.com`)
4. Follow the DNS setup instructions
5. Once connected, use this as your `CLOUDFLARE_R2_PUBLIC_URL`:
   ```
   CLOUDFLARE_R2_PUBLIC_URL=https://media.yourdomain.com
   ```

### Option B: R2.dev Subdomain (Quick Setup)

1. In your bucket settings, go to **Settings** → **Public access**
2. Click **Allow Access** on the "R2.dev subdomain" option
3. Copy the provided URL (e.g., `https://pub-xxxxx.r2.dev`)
4. Add it to your `.env`:
   ```
   CLOUDFLARE_R2_PUBLIC_URL=https://pub-xxxxx.r2.dev
   ```

## 3. Create API Token

1. Go to R2 → **Manage R2 API Tokens**
2. Click **Create API token**
3. Configure:
   - **Token name**: social-spark-api
   - **Permissions**: Object Read & Write
   - **Bucket**: Select your bucket
4. Click **Create API token**
5. Copy the credentials:
   - Access Key ID → `CLOUDFLARE_R2_ACCESS_KEY_ID`
   - Secret Access Key → `CLOUDFLARE_R2_SECRET_ACCESS_KEY`

## 4. Add to .env

Add all R2 credentials to your `.env` file:

```bash
# Cloudflare R2
CLOUDFLARE_R2_ACCOUNT_ID=your_account_id
CLOUDFLARE_R2_ACCESS_KEY_ID=your_access_key_id
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your_secret_access_key
CLOUDFLARE_R2_BUCKET_NAME=social-spark-media
CLOUDFLARE_R2_PUBLIC_URL=https://pub-xxxxx.r2.dev
```

## 5. Test Upload

After setting up, restart your dev server and try saving a post. Images should now be:
1. Downloaded from the original URL
2. Uploaded to your R2 bucket
3. Accessible via public URL
4. Displayed in your app

## Troubleshooting

### Images not showing
- Check if R2 public access is enabled
- Verify the `CLOUDFLARE_R2_PUBLIC_URL` is correct
- Check browser console for CORS errors

### Upload fails
- Verify API token has "Object Read & Write" permissions
- Check if bucket name matches
- Ensure Account ID is correct

### CORS Issues (if using custom domain)
Add CORS policy to your bucket:
```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"]
  }
]
```
