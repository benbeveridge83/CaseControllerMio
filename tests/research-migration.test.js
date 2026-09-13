import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const path=new URL('../supabase/migrations/20260913031500_equal_parenting_research_v1.sql',import.meta.url)
const sql=()=>fs.readFileSync(path,'utf8')

test('research migration creates normalized publication and child tables',()=>{
  const s=sql()
  for(const name of ['research_publications','research_studies','research_access_links','research_metrics','research_review_memberships'])
    assert.match(s,new RegExp(`create table if not exists public\\.${name}`,'i'))
})

test('anonymous users cannot read base research tables',()=>{
  const s=sql()
  for(const name of ['research_publications','research_studies','research_access_links','research_metrics','research_review_memberships'])
    assert.match(s,new RegExp(`revoke all on public\\.${name} from anon`,'i'))
})

test('the anonymous contract is a published-only field-limited view',()=>{
  const s=sql()
  assert.match(s,/create or replace view public\.research_public_catalog/i)
  assert.match(s,/where p\.editorial_status\s*=\s*'published'/i)
  assert.match(s,/grant select on public\.research_public_catalog to anon/i)
  assert.doesNotMatch(s,/grant select[^;]*research_publications[^;]*to anon/i)
})

test('scores are nullable 0-100 values and direction is independent',()=>{
  const s=sql()
  for(const key of ['impact_score','evidence_strength_score','equal_parenting_relevance_score','historical_field_importance_score'])
    assert.match(s,new RegExp(`${key} integer[^,;]*between 0 and 100`,'i'))
  assert.match(s,/finding_direction text/i)
})
