-- Firm-wide portal navigation. Billing records and staff access are unaffected.
create table if not exists public.mio_portal_settings (
 id boolean primary key default true check (id),
 intake boolean not null default true,
 discovery boolean not null default true,
 payments boolean not null default true,
 version integer not null default 1 check (version > 0),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
alter table public.mio_portal_settings enable row level security;
revoke all on public.mio_portal_settings from anon, authenticated;
grant all on public.mio_portal_settings to service_role;
-- Requested initial state: hide Payments for all client portals.
insert into public.mio_portal_settings(id,intake,discovery,payments) values(true,true,true,false) on conflict (id) do nothing;
