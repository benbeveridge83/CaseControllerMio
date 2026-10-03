-- Fee Agreement PDF template storage: a private bucket with authenticated-only access.
-- PDFs are uploaded by the logged-in user (browser) and downloaded by lib/pnc.js
-- (server, using that same authenticated session via the user's Bearer token), so only
-- `authenticated` policies are required. No public access, no service-role in the client.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fee-agreement-templates', 'fee-agreement-templates', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists "fee_agreement_templates_select" on storage.objects;
create policy "fee_agreement_templates_select" on storage.objects
  for select to authenticated using (bucket_id = 'fee-agreement-templates');

drop policy if exists "fee_agreement_templates_insert" on storage.objects;
create policy "fee_agreement_templates_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'fee-agreement-templates');

drop policy if exists "fee_agreement_templates_update" on storage.objects;
create policy "fee_agreement_templates_update" on storage.objects
  for update to authenticated using (bucket_id = 'fee-agreement-templates') with check (bucket_id = 'fee-agreement-templates');

drop policy if exists "fee_agreement_templates_delete" on storage.objects;
create policy "fee_agreement_templates_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'fee-agreement-templates');
