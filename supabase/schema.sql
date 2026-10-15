-- Baseline schema for Orbit Social Manager.
-- Applied to Supabase project bimngjcqcebertsgvovl on 2026-10-15.
-- Do not re-run against an already initialized database; use migrations for future changes.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled draft',
  caption text not null default '',
  hashtags text[] not null default '{}',
  media_url text,
  media_type text check (media_type is null or media_type in ('image', 'video')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook', 'youtube', 'tiktok', 'linkedin', 'x')),
  provider_account_id text,
  display_name text,
  connection_status text not null default 'pending'
    check (connection_status in ('pending', 'connected', 'expired', 'revoked', 'error')),
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, provider_account_id)
);

create table public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_id uuid references public.drafts(id) on delete set null,
  platform text not null check (platform in ('instagram', 'facebook', 'youtube', 'tiktok', 'linkedin', 'x')),
  scheduled_for timestamptz not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'published', 'failed', 'cancelled')),
  result_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index drafts_user_updated_idx on public.drafts (user_id, updated_at desc);
create index social_accounts_user_idx on public.social_accounts (user_id);
create index publish_jobs_due_idx on public.publish_jobs (status, scheduled_for);
create index publish_jobs_user_idx on public.publish_jobs (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.drafts enable row level security;
alter table public.social_accounts enable row level security;
alter table public.publish_jobs enable row level security;

revoke all on table public.profiles, public.drafts, public.social_accounts, public.publish_jobs from anon, authenticated;
grant select, insert, update, delete on table public.profiles, public.drafts, public.social_accounts, public.publish_jobs to authenticated;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "drafts_select_own" on public.drafts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "drafts_insert_own" on public.drafts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "drafts_update_own" on public.drafts
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "drafts_delete_own" on public.drafts
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "social_accounts_select_own" on public.social_accounts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "social_accounts_delete_own" on public.social_accounts
  for delete to authenticated using ((select auth.uid()) = user_id);
-- Only trusted server-side OAuth code should create/update social connection state.

create policy "publish_jobs_select_own" on public.publish_jobs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "publish_jobs_insert_own" on public.publish_jobs
  for insert to authenticated with check (
    (select auth.uid()) = user_id and status = 'queued'
    and (draft_id is null or exists (
      select 1 from public.drafts d where d.id = draft_id and d.user_id = (select auth.uid())
    ))
  );
create policy "publish_jobs_cancel_own_queued" on public.publish_jobs
  for update to authenticated
  using ((select auth.uid()) = user_id and status = 'queued')
  with check ((select auth.uid()) = user_id and status = 'cancelled');
create policy "publish_jobs_delete_own" on public.publish_jobs
  for delete to authenticated using ((select auth.uid()) = user_id);


-- Server-only YouTube OAuth state and encrypted token storage.
-- These tables intentionally have no anon/authenticated grants; Edge Functions
-- access them with the server-only Supabase secret key.
create table if not exists public.youtube_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists youtube_oauth_states_expiry_idx on public.youtube_oauth_states (expires_at);

create table if not exists public.youtube_oauth_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  channel_id text not null,
  channel_title text,
  encrypted_tokens text not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.youtube_oauth_states enable row level security;
alter table public.youtube_oauth_tokens enable row level security;
revoke all on table public.youtube_oauth_states, public.youtube_oauth_tokens from anon, authenticated;


-- Indexes and explicit deny-all RLS policies for server-only OAuth records.
create index if not exists publish_jobs_draft_id_idx on public.publish_jobs (draft_id);
create index if not exists youtube_oauth_states_user_id_idx on public.youtube_oauth_states (user_id);
drop policy if exists "youtube_oauth_states_deny_client_access" on public.youtube_oauth_states;
create policy "youtube_oauth_states_deny_client_access" on public.youtube_oauth_states
  for all to anon, authenticated using (false) with check (false);
drop policy if exists "youtube_oauth_tokens_deny_client_access" on public.youtube_oauth_tokens;
create policy "youtube_oauth_tokens_deny_client_access" on public.youtube_oauth_tokens
  for all to anon, authenticated using (false) with check (false);


-- Indexes and explicit deny-all RLS policies for server-only OAuth records.
create index if not exists publish_jobs_draft_id_idx on public.publish_jobs (draft_id);
create index if not exists youtube_oauth_states_user_id_idx on public.youtube_oauth_states (user_id);
drop policy if exists "youtube_oauth_states_deny_client_access" on public.youtube_oauth_states;
create policy "youtube_oauth_states_deny_client_access" on public.youtube_oauth_states
  for all to anon, authenticated using (false) with check (false);
drop policy if exists "youtube_oauth_tokens_deny_client_access" on public.youtube_oauth_tokens;
create policy "youtube_oauth_tokens_deny_client_access" on public.youtube_oauth_tokens
  for all to anon, authenticated using (false) with check (false);
