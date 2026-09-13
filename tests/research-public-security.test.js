import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const path=new URL('../supabase/migrations/20260913182700_equal_parenting_research_public_security.sql',import.meta.url)
const sql=()=>fs.readFileSync(path,'utf8')

test('public research catalog uses security invoker and published-only RLS',()=>{
  const s=sql()
  assert.match(s,/security_invoker\s*=\s*true/i)
  assert.match(s,/research_publications_anon_published/i)
  assert.match(s,/editorial_status\s*=\s*'published'/i)
  assert.match(s,/research_studies_anon_published/i)
  assert.match(s,/research_access_links_anon_published/i)
  assert.match(s,/research_metrics_anon_published/i)
})

test('anonymous grants are column-limited and exclude private publication fields',()=>{
  const s=sql()
  const grant=s.match(/grant select\s*\(([^;]+)\)\s*on public\.research_publications to anon;/i)
  assert.ok(grant,'expected column-level anon publication grant')
  const cols=grant[1].toLowerCase()
  assert.match(cols,/\btitle\b/)
  assert.match(cols,/\bpublished_at\b/)
  assert.doesNotMatch(cols,/internal_notes|inventory_raw|score_notes|updated_by|created_by/)
  assert.doesNotMatch(s,/grant select on public\.research_publications to anon/i)
})

test('public Mio-copy links require redistribution permission',()=>{
  const s=sql()
  assert.match(s,/link_type\s*<>\s*'mio_public_copy'\s*or\s*redistribution_permitted\s*=\s*true/i)
})
