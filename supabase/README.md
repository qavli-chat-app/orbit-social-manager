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
