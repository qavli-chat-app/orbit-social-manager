# Orbit Social Manager

A free-first installable PWA starter for planning social media content.

## Included
- Responsive dashboard for YouTube, Facebook, Instagram, TikTok, WhatsApp, Telegram, Pinterest and LinkedIn
- Local video preview (no upload), caption templates, local draft storage, JSON export
- PWA manifest, SVG icon, offline app shell

## Important limitations
This repository is a **front-end starter**, not a completed multi-platform automation service. It does not authenticate to social platforms, upload/publish posts, fetch analytics, provide real AI inference, or implement customer accounts/tenancy. These require a secure backend and platform-specific official API access, permissions, approval, and compliant token storage. Never put API secrets in frontend code. The caption helper is a local template generator, not an AI model.

## Deploy with GitHub Pages
1. Open repository **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch `main` and folder `/(root)`, then Save.
4. Wait for the Pages deployment to finish. The site URL will be `https://qavli-chat-app.github.io/orbit-social-manager/`.

## Install on Android
Open the deployed HTTPS URL in Chrome → menu → **Add to Home screen** / **Install app**.


## Supabase backend
The separate Supabase project has been provisioned for this app. See [supabase/README.md](./supabase/README.md) for the backend scope and security notes. The frontend uses the public publishable key only; social provider secrets are not stored in GitHub Pages.
