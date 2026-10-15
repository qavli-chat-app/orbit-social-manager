# Orbit Social Manager — Supabase backend

Project reference: `bimngjcqcebertsgvovl`  
Project URL: `https://bimngjcqcebertsgvovl.supabase.co`  
Region: `ap-south-1` (Mumbai)  
Creation quote confirmed: `$0/month` for project creation only.

## Implemented
- `profiles`, `drafts`, `social_accounts`, and `publish_jobs` tables.
- Row Level Security enabled on every table.
- Authenticated users can only access rows owned by their own Supabase user ID.
- Browser integration uses only the public publishable key; no service-role key or social token is shipped to the browser.
- The static app supports Supabase email/password sign-up/sign-in and syncs draft text to the user's private cloud account.

## Important limits
- Email confirmation behavior depends on Supabase Auth settings.
- Cloud sync uploads text metadata only; selected local video files are not uploaded.
- `social_accounts` stores connection metadata only, not provider access/refresh tokens.
- Social OAuth, actual publishing, analytics, background scheduling, and platform API approvals are **not yet configured**. Never mark a social account connected until its official OAuth flow has completed and the server has validated it.
- GitHub Pages is static hosting. Provider secrets and OAuth token exchange must run server-side, e.g. in Supabase Edge Functions with secrets configured in the Supabase project.
- Stay within the Supabase Free plan limits; do not enable paid features or upgrade without explicit approval.

See [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).


## One-time Auth URL setting
In the Supabase Dashboard for this project, open **Authentication → URL Configuration** and set:
- Site URL: `https://qavli-chat-app.github.io/orbit-social-manager/`
- Redirect URL allow-list: `https://qavli-chat-app.github.io/orbit-social-manager/**`

The frontend requests email-confirmation redirects back to the deployed site. Test sign-up/sign-in after the latest GitHub Pages deployment. Do not paste passwords, access tokens, service-role keys, or social app secrets into chat or GitHub.


## YouTube OAuth integration (channel verification + upload scope)

A Supabase Edge Function named `youtube-oauth` has been deployed. It is intentionally **fail-closed** until the owner configures Google OAuth and the encryption key in Supabase's server-side Edge Function Secrets. It requests `youtube.readonly` and `youtube.upload`, verifies the user's channel with YouTube Data API v3, and encrypts OAuth tokens at rest with AES-GCM before saving them. Reconnect after changing scopes so a saved token receives the upload grant.

### One-time setup required by the project owner

1. In Google Cloud Console, create/select a project and enable **YouTube Data API v3**.
2. Configure the OAuth consent screen. While testing, add only your own Google account as a test user if Google offers that option. Public use with YouTube scopes may require Google's verification.
3. Create an OAuth client of type **Web application**.
4. Add this exact **Authorized redirect URI**:
   `https://bimngjcqcebertsgvovl.supabase.co/functions/v1/youtube-oauth`
5. In the Supabase project, open **Edge Functions → Secrets**:  
   `https://supabase.com/dashboard/project/bimngjcqcebertsgvovl/functions/secrets`
6. Add these server-side secrets (never put them in GitHub, frontend code, or chat):
   - `GOOGLE_CLIENT_ID` = the OAuth web client ID
   - `GOOGLE_CLIENT_SECRET` = the OAuth web client secret
   - `ORBIT_TOKEN_ENCRYPTION_KEY` = a fresh base64-encoded 32-byte random key generated on your own device (for example, with `openssl rand -base64 32`). Keep a safe backup; changing it without re-encrypting existing rows makes saved tokens unreadable.
7. In Supabase Authentication → URL Configuration, keep the app site URL set to `https://qavli-chat-app.github.io/orbit-social-manager/`.
8. Deploy the latest GitHub Pages build and test sign-in, then press **Connect YouTube**. Confirm the verified channel name appears. Do not call it connected until that test succeeds.

### Security and current scope

- The callback uses a short-lived, one-time random `state` value bound to the signed-in Supabase user.
- OAuth tokens are encrypted with AES-GCM before being stored; the encryption key and Google client secret belong only in Edge Function Secrets.
- The `youtube_oauth_states` and `youtube_oauth_tokens` tables have RLS enabled and no grants for `anon` or `authenticated`; only server-side code should access them.
- The first iteration requests read-only channel access. Video uploads, scheduling, token refresh/revocation UX, and public Google app verification are not yet implemented.
- Keep within free-tier quotas; enabling the API does not guarantee unlimited free quota.


## Facebook Pages, Instagram and TikTok OAuth

The `social-oauth` Edge Function is deployed and uses one-time, 10-minute OAuth state bound to the signed-in Orbit user. It verifies the provider response before saving account metadata, encrypts provider tokens with AES-GCM, and stores them in server-only `social_oauth_tokens`. The new OAuth tables have RLS enabled and no browser-role SELECT grants.

Callback URL for Meta and TikTok:
`https://bimngjcqcebertsgvovl.supabase.co/functions/v1/social-oauth`

Add these values under Supabase **Edge Functions → Secrets** (never GitHub or browser code):
- `META_APP_ID` — Meta app ID
- `META_APP_SECRET` — Meta app secret
- `TIKTOK_CLIENT_KEY` — TikTok developer app client key
- `TIKTOK_CLIENT_SECRET` — TikTok developer app secret
- `ORBIT_TOKEN_ENCRYPTION_KEY` — same base64-encoded 32-byte encryption key used by the YouTube function

### Provider-side setup and restrictions
- **Meta / Facebook Pages:** Add the exact callback URL to the Meta app's Valid OAuth Redirect URIs. The login must have access to one or more Facebook Pages. Meta may require app review and advanced access for permissions such as `pages_manage_posts` and `instagram_content_publish`.
- **Instagram:** This flow discovers Instagram professional accounts linked to the authorized Facebook Pages. Personal Instagram accounts are not supported by this publishing API flow. Link the Instagram Business/Creator profile to a Facebook Page before connecting.
- **TikTok:** Add the exact callback URL to the TikTok app's redirect URI allowlist and request the relevant approved scopes. Direct Post requires approved `video.publish` access and TikTok's product-use/audit requirements; unaudited direct posts can be restricted to private visibility. TikTok may reject a social-management app whose use case does not meet its developer guidelines.
- OAuth connection does **not** mean publishing or scheduling is enabled. Real publishing needs separate platform-specific upload endpoints, media hosting, explicit consent, rate-limit handling and verified provider permissions. Scheduled jobs also need a working worker/cron path. Do not report these as operational until end-to-end tests pass.

### Current verification status
- Deployed: `youtube-oauth` Edge Function and `social-oauth` Edge Function.
- Database check confirmed `social_oauth_states` and `social_oauth_tokens` have RLS enabled and neither `anon` nor `authenticated` can SELECT them.
- Not yet verified: actual provider account connection (secrets and provider-side OAuth apps still need owner configuration), any real post, and scheduled publishing.


## Publishing, media storage and scheduled jobs

The `social-publish` Edge Function is deployed. It validates the signed-in user for direct publish/schedule requests, uses encrypted server-side provider tokens, and only reports immediate publishing after a provider confirms the response. Current behavior:
- YouTube: video upload through the official API; the first version sets visibility to **private**. Reconnect after the new `youtube.upload` scope is configured.
- Facebook Pages: text, image, or video post where the authorized Page token and Meta permissions allow it.
- Instagram Professional: image or Reel publishing through the official Graph API; requires a public media URL and Meta publishing permission.
- TikTok: official **inbox upload** only. The user must finish/publish in TikTok. This does not claim to auto-publish directly.
- Schedule: creates a private cloud draft and queued job. A GitHub Actions workflow runs every five minutes to process due jobs, but it will not run successfully until the same worker secret is set in GitHub and Supabase.

### Public media bucket
A public `orbit-media` Supabase Storage bucket was configured with a 50 MB file limit and image/video MIME allowlist. Authenticated uploads are restricted to the user's own folder (`<user-id>/...`). Files in a public bucket are publicly readable by anyone who obtains the URL; upload only content you intend to share publicly. Free-plan quotas still apply.

### Finish the secure setup
1. In Supabase **Edge Functions → Secrets**, set the OAuth values documented above and a fresh `ORBIT_WORKER_SECRET` random secret.
2. In GitHub repo **Settings → Secrets and variables → Actions**, add the exact same value as repository secret `ORBIT_WORKER_SECRET`. Never commit the secret or send it in chat.
3. Configure Google, Meta and TikTok developer apps with the exact callback URL above. Use provider-side test users/roles during testing.
4. Sign in to the deployed app, connect each platform, then test with a non-sensitive post. YouTube defaults to private; TikTok requires final confirmation inside TikTok.
5. Test scheduled jobs and inspect Supabase Edge Function logs and the GitHub Actions run. A scheduled job is not considered verified until a due job is actually processed and provider confirmation is stored.

### Platform restrictions
- Meta may require app review/advanced access for Page and Instagram publishing permissions.
- Instagram publishing requires a Professional account linked to an authorized Facebook Page; personal accounts are not supported by this flow.
- TikTok direct publishing is not implemented here. The official inbox-upload flow requires approved `video.upload`, and TikTok may require product review and verified media URL domains. Direct Post has separate audit and product-use requirements.
- Public YouTube publishing may require Google OAuth verification and applicable API compliance review; this implementation intentionally defaults to private visibility.
- No paid resource has been intentionally enabled. Stay within free-tier quotas and do not upgrade automatically.
