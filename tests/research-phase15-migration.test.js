import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const path=new URL('../supabase/migrations/20260913_equal_parenting_research_phase15.sql',import.meta.url)
const sql=()=>fs.readFileSync(path,'utf8')

test('phase 1.5 adds sortable bibliometric and completion summaries',()=>{
  const s=sql()
  for(const c of [
    'citation_count_current','citation_count_provider','citation_count_captured_at',
    'citations_per_year','fwci_current','influential_citation_count_current',
    'major_review_count','impact_data_completeness','analysis_completion_status','analysis_verified_at'
  ]) assert.match(s,new RegExp(`add column if not exists ${c}`,'i'))
})

test('public catalog remains sanitized and gains safe importance fields',()=>{
  const s=sql()
  assert.match(s,/citation_count_current/i)
  assert.match(s,/citations_per_year/i)
  assert.match(s,/major_review_count/i)
  assert.match(s,/impact_data_completeness/i)
  assert.doesNotMatch(s,/internal_notes[^\n]*research_public_catalog/i)
})
