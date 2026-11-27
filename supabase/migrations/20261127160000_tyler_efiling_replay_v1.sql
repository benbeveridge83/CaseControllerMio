-- Durable Tyler ECF5 callback replay protection. Additive and fail-closed.
-- A replay key is the (environment, signed message ID, payload SHA-256) tuple.
-- The first verified delivery atomically claims the key; identical retries are
-- recognised as duplicates and must never be treated as a new filing event.
create table if not exists public.mio_efiling_replay_keys (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('stage','production')),
  message_id text not null check (length(trim(message_id)) between 1 and 256),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  trusted_issuer text,
  received_at timestamptz not null default clock_timestamp(),
  unique (environment, message_id, payload_sha256)
);
create index if not exists mio_efiling_replay_keys_received_idx
  on public.mio_efiling_replay_keys (received_at desc);

alter table public.mio_efiling_replay_keys enable row level security;
revoke all on public.mio_efiling_replay_keys from public, anon, authenticated;
grant select, insert on public.mio_efiling_replay_keys to service_role;

-- Atomic first-wins claim. Returns claimed=true only for the first insertion;
-- a later identical delivery returns claimed=false without mutating anything.
create or replace function public.mio_claim_efiling_replay_v1(
  p_environment text, p_message_id text, p_payload_sha256 text,
  p_trusted_issuer text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare rid uuid;
begin
  if p_environment not in ('stage','production') or
     p_message_id is null or length(trim(p_message_id)) not between 1 and 256 or
     p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid Tyler replay key' using errcode='22023';
  end if;
  insert into public.mio_efiling_replay_keys(environment,message_id,payload_sha256,trusted_issuer)
  values(p_environment,p_message_id,p_payload_sha256,left(p_trusted_issuer,256))
  on conflict(environment,message_id,payload_sha256) do nothing
  returning id into rid;
  return jsonb_build_object('claimed', rid is not null, 'id', rid);
end; $$;

revoke all on function public.mio_claim_efiling_replay_v1(text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.mio_claim_efiling_replay_v1(text,text,text,text)
  to service_role;
