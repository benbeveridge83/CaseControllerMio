// The V324 re-resolution migration is a rollout step, so two of its promises are asserted here: it
// records what it replaced (the only thing that makes the change reversible from the data alone) and
// it never names a money column. Comments are stripped before the money check, because the header
// deliberately names the fields it promises not to touch.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync(new URL('../supabase/migrations/20260923090000_lawpay_provider_account_resolution_v324.sql', import.meta.url), 'utf8')
const body = sql.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n')

test('the re-resolution function writes only the account classification, its provenance and its history', () => {
  assert.match(body, /create or replace function public\.mio_reresolve_lawpay_accounts_v324\(p_provider_account_id text, p_account_key text, p_actor text default ''\)/)
  assert.match(body, /set account_key = p_account_key/)
  assert.match(body, /'\{mio_account_key_source\}', to_jsonb\('configured_account'::text\)/)
  // The previous values are appended before they are replaced: without this the change could not be
  // reverted from the data.
  assert.match(body, /'\{mio_account_resolution_history\}'/)
  assert.match(body, /jsonb_build_array\(jsonb_build_object\(/)
  assert.match(body, /'from_account_key', coalesce\(t\.account_key, ''\)/)
  assert.match(body, /'from_source', coalesce\(t\.raw->>'mio_account_key_source', ''\)/)
  // Re-running is harmless: an already-mapped row is not touched again.
  assert.match(body, /coalesce\(t\.account_key, ''\) <> p_account_key/)
  for (const column of ['amount_cents', 'amount_refunded_cents', 'currency', 'payer_name', 'payer_email', 'reference', 'last_four', 'status']) {
    assert.equal(body.includes(column), false, `the update must never name ${column}`)
  }
  assert.doesNotMatch(body, /\bdelete\b|\btruncate\b/, 'it removes nothing')
})

test('the re-resolution refuses unless a named actor and an exactly matching active mapping both exist', () => {
  // The mapping is the only authority for naming an account, so the function must look for an active
  // row matching the provider identifier AND the Mio account key, and refuse everything else.
  // The matching row is locked, not merely read: the lock must outlive the check and cover the update,
  // so a concurrent mapping change cannot be raced by a stale mapping.
  assert.match(body, /select a\.account_key into v_mapping_key\s*\n\s*from public\.mio_lawpay_accounts a\s*\n\s*where a\.provider_account_id = p_provider_account_id\s*\n\s*and a\.account_key = p_account_key\s*\n\s*and a\.is_active\s*\n\s*for share;/)
  assert.match(body, /if not found then/)
  assert.match(body, /'mapping_account_key', v_mapping_key,/, 'the write reports the audited, locked mapping key')
  assert.doesNotMatch(body, /if not exists \(select 1 from public\.mio_lawpay_accounts/, 'the authority check must lock the row rather than read it unlocked')
  assert.match(body, /'ok', false,/)
  assert.match(body, /points at a different Mio account, so nothing was written/)
  assert.match(body, /No active mapping exists for this provider account and Mio account, so nothing was written/)
  assert.match(body, /'updated', 0,/, 'a refusal reports zero updated rows')
  // No audit history may be written for an anonymous caller.
  assert.match(body, /v_actor text := nullif\(btrim\(coalesce\(p_actor, ''\)\), ''\)/)
  assert.match(body, /if v_actor is null then/)
  assert.match(body, /Mio could not tell who is re-resolving these transactions, so nothing was written/)
  // The history entry records the actor that was checked, not the raw parameter.
  assert.match(body, /'actor', v_actor,/)
  assert.doesNotMatch(body, /'actor', coalesce\(p_actor, ''\)/)
})

test('the mapping cannot be created by this migration, and the function is service-role only', () => {
  assert.doesNotMatch(body, /insert into public\.mio_lawpay_accounts/, 'this migration creates no mapping')
  assert.doesNotMatch(body, /insert into public\.lawpay_transactions/, 'this migration creates no transaction')
  assert.match(body, /revoke all on function public\.mio_reresolve_lawpay_accounts_v324\(text,text,text\) from public, anon, authenticated;/)
  assert.match(body, /grant execute on function public\.mio_reresolve_lawpay_accounts_v324\(text,text,text\) to service_role;/)
  assert.match(body, /security definer set search_path = public, pg_temp/, 'a definer function pins its search path')
  // An unknown account key is refused rather than stored.
  assert.match(body, /v_allowed text\[\] := array\['operating','trust','echeck_operating','echeck_trust','clientcredit_trust'\]/)
  assert.match(body, /not \(coalesce\(p_account_key, ''\) = any\(v_allowed\)\)/)
})
