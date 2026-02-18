# Social Spark Setup Guide

## 1. Environment Variables

Use `.env.example` as the template and keep your real values in `.env`.

```bash
cp .env.example .env
```

### Required Variables:

#### Supabase
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL (found in Project Settings > API)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anon/public key (found in Project Settings > API)

#### Cloudflare R2
- `CLOUDFLARE_R2_ACCOUNT_ID` - Your Cloudflare account ID
- `CLOUDFLARE_R2_ACCESS_KEY_ID` - R2 Access Key ID (create in R2 > Manage API Tokens)
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY` - R2 Secret Access Key
- `CLOUDFLARE_R2_BUCKET_NAME` - Your R2 bucket name
- `CLOUDFLARE_R2_PUBLIC_URL` - Your R2 public URL (see R2-SETUP.md for details)

**Important**: See `R2-SETUP.md` for detailed instructions on setting up R2 public access.

#### Google Gemini
- `GOOGLE_GEMINI_API_KEY` - Get from https://makersuite.google.com/app/apikey

#### Decodo Proxy (optional but recommended for Instagram/TikTok fetching)
- `DECODO_PROXY_HOST` - `isp.decodo.com`
- `DECODO_PROXY_PORT` - Your Decodo ISP proxy port
- `DECODO_PROXY_USERNAME` - Your Decodo proxy username
- `DECODO_PROXY_PASSWORD` - Your Decodo proxy password
- `DECODO_PROXY_USE_SESSION` - Set `true` to rotate proxy sessions per retry

#### Remote Extractor Service (recommended for Vercel)
- If your app is hosted on Vercel, Instagram/TikTok extraction is expected to run on a separate Node/Docker service (for example your DigitalOcean server).
- Configure:
  - `SOCIAL_EXTRACTOR_API_URL` - Base URL of your extractor server (for example: `https://api.yourdomain.com`)
  - `SOCIAL_EXTRACTOR_API_TOKEN` - Shared Bearer token if your extractor endpoint is protected
- The app calls `POST /api/extract-social-post` on that service for Instagram/TikTok extraction.

## 2. Database Setup

1. Go to your Supabase project
2. Navigate to SQL Editor
3. Open `supabase-schema.sql` from the root directory
4. Copy and paste the entire SQL content
5. Click "Run" to execute the schema

This will create:
- `collections` table
- `saved_posts` table
- `recreated_posts` table
- Necessary indexes and RLS policies

## 3. Install Dependencies

```bash
npm install
```

## 4. Run Development Server

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## How It Works

1. **Create a Collection**: Add a new collection with your app name and description
2. **Save Posts**: Save social media posts you want to recreate
3. **Recreate Content**: Generate scripts and images based on saved posts using AI
4. **Export**: Download generated content for use on your platforms

## Features

- App description-based content generation (no GitHub repo needed)
- Gemini AI for script generation
- Gemini Imagen 3 for image generation
- Cloudflare R2 for media storage
- Supabase for database management
