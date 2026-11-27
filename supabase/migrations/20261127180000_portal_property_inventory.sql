-- Client-entered property and debt inventories, enabled per matter.
alter table public.mio_portal_matter_settings
 add column if not exists property_inventory boolean not null default false;

create table if not exists public.mio_portal_property_inventory (
 matter_id uuid primary key references public.matters(id) on delete cascade,
 client_id uuid not null references public.clients(id) on delete cascade,
 recipient_email text not null,
 inventory jsonb not null default '{"assets":[],"securedDebts":[],"unsecuredDebts":[],"documentChecklist":{}}'::jsonb,
 version integer not null default 1 check(version>0),
 updated_at timestamptz not null default now(),
 constraint mio_portal_property_inventory_shape check (
  jsonb_typeof(inventory)='object'
  and jsonb_typeof(inventory->'assets')='array'
  and jsonb_typeof(inventory->'securedDebts')='array'
  and jsonb_typeof(inventory->'unsecuredDebts')='array'
 )
);
alter table public.mio_portal_property_inventory enable row level security;
revoke all on public.mio_portal_property_inventory from public,anon,authenticated;
grant all on public.mio_portal_property_inventory to service_role;

create or replace function public.mio_portal_property_inventory_save(
 p_matter uuid,p_client uuid,p_email text,p_version integer,p_inventory jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_row public.mio_portal_property_inventory;
begin
 if jsonb_typeof(p_inventory)<>'object'
  or jsonb_typeof(p_inventory->'assets')<>'array'
  or jsonb_typeof(p_inventory->'securedDebts')<>'array'
  or jsonb_typeof(p_inventory->'unsecuredDebts')<>'array'
  or octet_length(p_inventory::text)>450000 then
  raise exception 'Invalid property inventory payload';
 end if;
 select * into current_row from public.mio_portal_property_inventory where matter_id=p_matter for update;
 if not found then
  if p_version<>0 then raise sqlstate 'PT409' using message='The inventory changed. Refresh before saving.'; end if;
  insert into public.mio_portal_property_inventory(matter_id,client_id,recipient_email,inventory,version)
  values(p_matter,p_client,lower(trim(p_email)),p_inventory,1) returning * into current_row;
 else
  if current_row.client_id is distinct from p_client or current_row.recipient_email is distinct from lower(trim(p_email)) then
   raise exception 'The inventory belongs to a different client';
  end if;
  if current_row.version<>p_version then raise sqlstate 'PT409' using message='The inventory changed in another window. Refresh before saving.'; end if;
  update public.mio_portal_property_inventory set inventory=p_inventory,version=version+1,updated_at=now()
   where matter_id=p_matter returning * into current_row;
 end if;
 return jsonb_build_object('inventory',current_row.inventory,'version',current_row.version);
exception when unique_violation then
 raise sqlstate 'PT409' using message='The inventory was created in another window. Refresh before saving.';
end $$;
revoke all on function public.mio_portal_property_inventory_save(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.mio_portal_property_inventory_save(uuid,uuid,text,integer,jsonb) to service_role;
