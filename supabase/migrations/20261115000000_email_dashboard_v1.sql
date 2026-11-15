-- Email dashboard v1: multi-mailbox tokens, folder selection, per-category
-- resolution, and cached AI categorization.
--
-- Tokens are service-role only (never readable by the browser). Folder settings,
-- resolutions, and categorizations are owner-scoped via RLS.

-- One delegated token per (user, mailbox). Presence of a row == connected.
create table if not exists public.mio_email_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_email text not null,
  display_name text,
  access_token text not null,
  refresh_token text,
  id_token text,
  expires_at timestamptz,
  scopes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, account_email)
);
alter table public.mio_email_tokens enable row level security;

-- Ben's chosen folders per mailbox. Only selected folders feed the dashboard.
create table if not exists public.mio_email_folder_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_email text not null,
  folder_id text not null,
  folder_name text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, account_email, folder_id)
);
alter table public.mio_email_folder_settings enable row level security;

-- Per (message, category) resolution so a multi-category message can be
-- resolved independently in each section and the state survives reloads.
create table if not exists public.mio_email_resolutions (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null,
  category text not null,
  resolved boolean not null default true,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, message_id, category)
);
alter table public.mio_email_resolutions enable row level security;

-- Cached AI classification for a message (categories, topics, matter hint).
create table if not exists public.mio_email_categorizations (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null,
  categories jsonb not null default '[]',
  topics jsonb not null default '{}',
  matter_hint text,
  ai boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.mio_email_categorizations enable row level security;

-- Owner-scoped RLS policies for the three user-facing tables.
create policy "email folder settings owner select"
  on public.mio_email_folder_settings for select using (auth.uid() = user_id);
create policy "email folder settings owner insert"
  on public.mio_email_folder_settings for insert with check (auth.uid() = user_id);
create policy "email folder settings owner update"
  on public.mio_email_folder_settings for update using (auth.uid() = user_id);
create policy "email folder settings owner delete"
  on public.mio_email_folder_settings for delete using (auth.uid() = user_id);

create policy "email resolutions owner select"
  on public.mio_email_resolutions for select using (auth.uid() = user_id);
create policy "email resolutions owner insert"
  on public.mio_email_resolutions for insert with check (auth.uid() = user_id);
create policy "email resolutions owner update"
  on public.mio_email_resolutions for update using (auth.uid() = user_id);
create policy "email resolutions owner delete"
  on public.mio_email_resolutions for delete using (auth.uid() = user_id);

create policy "email categorizations owner select"
  on public.mio_email_categorizations for select using (auth.uid() = user_id);
create policy "email categorizations owner insert"
  on public.mio_email_categorizations for insert with check (auth.uid() = user_id);
create policy "email categorizations owner update"
  on public.mio_email_categorizations for update using (auth.uid() = user_id);
create policy "email categorizations owner delete"
  on public.mio_email_categorizations for delete using (auth.uid() = user_id);

create index if not exists mio_email_tokens_user_idx on public.mio_email_tokens (user_id);
create index if not exists mio_email_folder_settings_user_idx on public.mio_email_folder_settings (user_id);
create index if not exists mio_email_resolutions_user_idx on public.mio_email_resolutions (user_id);
