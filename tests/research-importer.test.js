import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const importer=fs.readFileSync(new URL('../scripts/import-equal-parenting-research.mjs',import.meta.url),'utf8')
const migration=fs.readFileSync(new URL('../supabase/migrations/20260913031500_equal_parenting_research_v1.sql',import.meta.url),'utf8')

test('inventory memberships use a stable import key and never broad-delete manual rows',()=>{
  assert.match(migration,/research_review_memberships[\s\S]*?inventory_key text unique/i)
  assert.match(importer,/inventory_key/)
  assert.doesNotMatch(importer,/\.not\(['"]membership_note['"]/)
})

test('imported child rows have provenance keys and cleanup is inventory-scoped',()=>{
  for(const table of ['research_studies','research_access_links','research_metrics'])
    assert.match(migration,new RegExp(`create table if not exists public\\.${table}[\\s\\S]*?inventory_key text unique`,'i'))
  assert.match(importer,/inventory:\$\{work\}:/)
  assert.match(importer,/\.like\('inventory_key',`inventory:\$\{work\}:%`\)/)
  assert.doesNotMatch(importer,/from\('research_(?:studies|access_links|metrics)'\)\.delete\(\)\.eq\('publication_id'/)
})
