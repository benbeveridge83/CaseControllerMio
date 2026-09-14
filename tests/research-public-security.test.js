import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const path=new URL('../supabase/migrations/20260913183200_equal_parenting_research_public_cache.sql',import.meta.url)
const sql=()=>fs.readFileSync(path,'utf8')

test('public research catalog is a sanitized RLS cache, not a definer view',()=>{
  const s=sql()
  assert.match(s,/drop view if exists public\.research_public_catalog/i)
  assert.match(s,/create table if not exists public\.research_public_catalog/i)
  assert.match(s,/alter table public\.research_public_catalog enable row level security/i)
  assert.match(s,/create policy research_public_catalog_read/i)
  assert.doesNotMatch(s,/create or replace view public\.research_public_catalog/i)
})

test('anonymous users receive no private source-table grants',()=>{
  const s=sql()
  for(const table of ['research_publications','research_studies','research_access_links','research_metrics'])
    assert.match(s,new RegExp(`revoke all on public\\.${table} from anon`,'i'))
  assert.doesNotMatch(s,/grant select[^;]*on public\.research_publications to anon/i)
  assert.doesNotMatch(s,/grant select[^;]*on public\.research_studies to anon/i)
})

test('cache refresh only copies published and legally public research data',()=>{
  const s=sql()
  assert.match(s,/editorial_status\s*=\s*'published'/i)
  assert.match(s,/extraction_status\s*=\s*'verified'/i)
  assert.match(s,/is_public\s*=\s*true/i)
  assert.match(s,/link_type\s*<>\s*'mio_public_copy'\s*or\s*a\.redistribution_permitted\s*=\s*true/i)
  assert.doesNotMatch(s,/internal_notes|inventory_raw|score_notes/)
})

test('cache refresh functions have fixed search paths and are not callable by app roles',()=>{
  const s=sql()
  assert.match(s,/security definer\s*\nset search_path = public, pg_temp/i)
  assert.match(s,/revoke all on function public\.research_refresh_public_catalog\(uuid\) from public, anon, authenticated/i)
  assert.match(s,/revoke all on function public\.research_public_catalog_trigger\(\) from public, anon, authenticated/i)
})
