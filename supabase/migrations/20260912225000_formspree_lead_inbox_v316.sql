create table if not exists public.mio_formspree_leads (
  id uuid primary key default gen_random_uuid(), form_id text not null, submission_key text not null unique,
  submitted_at timestamptz not null, received_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  source text not null default 'formspree', full_name text, email text, phone text, county text, family_type text, matter_kind text, message text,
  raw_submission jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new','acknowledged','contacted','converted','declined','spam')),
  minimized_at timestamptz, addressed_at timestamptz, addressed_by uuid, matter_id uuid references public.matters(id) on delete set null,
  last_seen_at timestamptz not null default now()
);
create index if not exists mio_formspree_leads_open_idx on public.mio_formspree_leads(status,submitted_at desc) where status in ('new','acknowledged');
create index if not exists mio_formspree_leads_email_idx on public.mio_formspree_leads(lower(email)) where email is not null;
alter table public.mio_formspree_leads enable row level security;
drop policy if exists mio_formspree_leads_read on public.mio_formspree_leads;
create policy mio_formspree_leads_read on public.mio_formspree_leads for select to authenticated using (true);
drop policy if exists mio_formspree_leads_update on public.mio_formspree_leads;
create policy mio_formspree_leads_update on public.mio_formspree_leads for update to authenticated using (true) with check (true);
create table if not exists public.mio_formspree_config(id boolean primary key default true check(id),webhook_token_hash text not null,form_id text,last_webhook_at timestamptz,last_reconcile_at timestamptz,last_error text,updated_at timestamptz not null default now());
alter table public.mio_formspree_config enable row level security;
create or replace function public.mio_touch_formspree_lead() returns trigger language plpgsql as $$begin new.updated_at:=now();return new;end;$$;
drop trigger if exists mio_formspree_leads_touch on public.mio_formspree_leads;
create trigger mio_formspree_leads_touch before update on public.mio_formspree_leads for each row execute function public.mio_touch_formspree_lead();
do $$ begin begin alter publication supabase_realtime add table public.mio_formspree_leads; exception when duplicate_object then null; end; end $$;
