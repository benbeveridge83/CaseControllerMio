-- Microsoft Graph integration foundation (Paralegal Phase 2).
-- Server-side token storage and durable approval-review storage.
-- Both tables are service-role only (RLS enabled, no public policies):
-- access/refresh tokens and approval reviews must never reach the browser.

create table if not exists public.mio_microsoft_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_email text,
  access_token text not null,
  refresh_token text,
  id_token text,
  expires_at timestamptz,
  scopes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mio_microsoft_tokens enable row level security;

create table if not exists public.mio_paralegal_reviews (
  id uuid primary key,
  owner_id uuid not null,
  task_id text not null,
  action text not null,
  email jsonb not null,
  task jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.mio_paralegal_reviews enable row level security;

create index if not exists mio_paralegal_reviews_owner_idx on public.mio_paralegal_reviews (owner_id);
create index if not exists mio_paralegal_reviews_expires_idx on public.mio_paralegal_reviews (expires_at);

create table if not exists public.mio_microsoft_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  folder text not null default 'inbox',
  cursor text,
  last_sync_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.mio_microsoft_sync_state enable row level security;
