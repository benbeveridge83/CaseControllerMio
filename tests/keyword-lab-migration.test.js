import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrationPath='supabase/migrations/20260913190000_keyword_lab_v318.sql'
const sql=fs.readFileSync(migrationPath,'utf8').toLowerCase().replace(/\s+/g,' ')

function tableDefinition(name){
 const match=sql.match(new RegExp(`create table public\\.${name} \\((.*?)\\);`))
 assert.ok(match,`missing ${name}`)
 return match[1]
}

test('migration creates the three Keyword Lab tables with their persistence fields',()=>{
 const experiments=tableDefinition('mio_ads_keyword_experiments')
 for(const column of ['id uuid','account_id text','campaign_id text','campaign_name text','ad_group_id text','ad_group_name text','criterion_id text','criterion_resource_name text','keyword text','match_type text','source text','hypothesis text','experiment_started_at timestamptz','approved_by uuid','state text','created_by uuid','created_at timestamptz','updated_at timestamptz'])assert.ok(experiments.includes(column),`missing experiment column ${column}`)

 const cache=tableDefinition('mio_ads_keyword_market_cache')
 for(const column of ['id uuid','account_id text','seed_type text','normalized_seed text','location_ids text[]','language_id text','network text','results jsonb','retrieved_at timestamptz','expires_at timestamptz','created_by uuid','created_at timestamptz','updated_at timestamptz'])assert.ok(cache.includes(column),`missing cache column ${column}`)

 const classifications=tableDefinition('mio_ads_search_term_classifications')
 for(const column of ['id uuid','account_id text','campaign_id text','ad_group_id text','search_term text','classification text','note text','created_by uuid','created_at timestamptz','updated_at timestamptz'])assert.ok(classifications.includes(column),`missing classification column ${column}`)
})

test('migration enforces stable identities, timestamps, and documented values',()=>{
 assert.match(sql,/unique\s*\(account_id,criterion_resource_name\)/)
 assert.match(sql,/unique\s*\(account_id,seed_type,normalized_seed,location_ids,language_id,network,retrieved_at\)/)
 assert.match(sql,/unique\s*\(account_id,campaign_id,ad_group_id,search_term\)/)
 assert.match(sql,/match_type text not null check\s*\(match_type in \('exact','phrase','broad'\)\)/)
 assert.match(sql,/source text not null check\s*\(source in \('manual','planner','search_term'\)\)/)
 assert.match(sql,/state text not null check\s*\(state in \('proposed','approved','active','paused','promoted_to_core','ended'\)\)/)
 assert.match(sql,/classification text not null check\s*\(classification in \('relevant','irrelevant','observe','promoted'\)\)/)
 assert.equal((sql.match(/created_at timestamptz not null default now\(\)/g)||[]).length,3)
 assert.equal((sql.match(/updated_at timestamptz not null default now\(\)/g)||[]).length,3)
})

test('all Keyword Lab tables use firm-only RLS with least grants and no anonymous access',()=>{
 for(const name of ['mio_ads_keyword_experiments','mio_ads_keyword_market_cache','mio_ads_search_term_classifications']){
  assert.match(sql,new RegExp(`alter table public\\.${name} enable row level security`))
  assert.match(sql,new RegExp(`revoke all on public\\.${name} from public, anon, authenticated`))
  assert.match(sql,new RegExp(`grant select, insert on public\\.${name} to authenticated`))
 }
 assert.doesNotMatch(sql,/grant delete on public\.mio_ads_keyword_/)
 assert.doesNotMatch(sql,/grant delete on public\.mio_ads_search_term_classifications/)
 for(const operation of ['select','insert','update']){
  const policies=sql.match(new RegExp(`create policy [^;]+ for ${operation} to authenticated [^;]+;`,'g'))||[]
  assert.equal(policies.length,3,`expected one ${operation} policy per table`)
  for(const policy of policies){
   assert.match(policy,/lower\(\(select auth\.jwt\(\)\)->>'email'\) like '%@beveridgelawfirm\.com'/)
   if(operation==='select')assert.match(policy,/ using\(/)
   if(operation==='insert')assert.match(policy,/ with check\(/)
   if(operation==='update'){assert.match(policy,/ using\(/);assert.match(policy,/ with check\(/)}
  }
 }
 assert.equal((sql.match(/for insert to authenticated with check\(created_by=\(select auth\.uid\(\)\)/g)||[]).length,3)
 assert.match(sql,/approved_by is null or approved_by=\(select auth\.uid\(\)\)/)
 assert.doesNotMatch(sql,/user_metadata|raw_user_meta_data/)
})

test('update grants keep identity and creation audit columns immutable',()=>{
 assert.match(sql,/grant update\(state,hypothesis\) on public\.mio_ads_keyword_experiments to authenticated/)
 assert.match(sql,/grant update\(results,retrieved_at,expires_at\) on public\.mio_ads_keyword_market_cache to authenticated/)
 assert.match(sql,/grant update\(classification,note\) on public\.mio_ads_search_term_classifications to authenticated/)
 assert.doesNotMatch(sql,/grant update\([^)]*(created_by|created_at|approved_by|criterion_resource_name|account_id)[^)]*\)/)
 assert.equal((sql.match(/execute function public\.mio_ads_keyword_lab_touch_updated_at\(\)/g)||[]).length,3)
})

test('Keyword Lab extends change history without changing its existing write surface',()=>{
 assert.match(sql,/drop constraint if exists mio_ads_changes_kind_check/)
 assert.match(sql,/add constraint mio_ads_changes_kind_check check\s*\(kind in \('rsa_update','campaign_negatives','keyword_lab'\)\)/)
 assert.doesNotMatch(sql,/grant update\([^)]*(actor_id|actor_email|kind|payload_hash|before_snapshot|after_snapshot)[^)]*\) on public\.mio_ads_changes/)
})
