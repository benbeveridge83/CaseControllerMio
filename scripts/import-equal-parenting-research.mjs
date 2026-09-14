import fs from 'node:fs'
import * as XLSX from 'xlsx'
import {createClient} from '@supabase/supabase-js'
import {parseResearchInventory} from '../lib/research/inventory.js'

const args=process.argv.slice(2),dry=args.includes('--dry-run'),file=args.find(x=>x!=='--dry-run')
if(!file)throw new Error('Usage: node scripts/import-equal-parenting-research.mjs [--dry-run] /path/inventory.xlsx')
const workbook=XLSX.read(fs.readFileSync(file),{type:'buffer'})
const parsed=parseResearchInventory(workbook)
console.log(JSON.stringify({publications:parsed.publications.length,studies:parsed.studies.length,accessLinks:parsed.accessLinks.length,metrics:parsed.metrics.length,reviewMemberships:parsed.reviewMemberships.length,warnings:parsed.warnings},null,2))
if(dry)process.exit(0)
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key)throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the local shell. Never use a VITE_ variable for the service-role key.')
const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const fail=(label,r)=>{if(r.error)throw new Error(`${label}: ${r.error.message}`);return r.data}

const existing=fail('load existing publications',await supabase.from('research_publications').select('id,inventory_work_id,doi,slug,editorial_status'))||[]
const byWork=new Map(existing.filter(x=>x.inventory_work_id).map(x=>[x.inventory_work_id,x]))
const byDoi=new Map(existing.filter(x=>x.doi).map(x=>[String(x.doi).trim().toLowerCase(),x]))
let inserted=0,updated=0
for(const p of parsed.publications){
 const found=byWork.get(p.inventory_work_id)||byDoi.get(String(p.doi||'').trim().toLowerCase())
 const row={...p,...(found?{id:found.id,slug:found.slug,editorial_status:found.editorial_status}:{})}
 const saved=fail(`upsert ${p.inventory_work_id}`,await supabase.from('research_publications').upsert(row,{onConflict:'id'}).select('id,inventory_work_id,doi,slug,editorial_status').single())
 byWork.set(saved.inventory_work_id,saved);if(saved.doi)byDoi.set(String(saved.doi).trim().toLowerCase(),saved)
 found?updated++:inserted++
}
const groups=(items,key='inventory_work_id')=>{const m=new Map();for(const x of items){if(!m.has(x[key]))m.set(x[key],[]);m.get(x[key]).push(x)}return m}
const studyGroups=groups(parsed.studies),accessGroups=groups(parsed.accessLinks),metricGroups=groups(parsed.metrics)
for(const p of parsed.publications){
 const work=p.inventory_work_id,pub=byWork.get(work);if(!pub)throw new Error(`Missing publication for Work ID ${work}`)
 const studies=studyGroups.get(work)||[]
 fail(`delete imported studies ${work}`,await supabase.from('research_studies').delete().like('inventory_key',`inventory:${work}:%`))
 if(studies.length){const rows=studies.map(({inventory_work_id,inventory_study_id,...x},i)=>({...x,inventory_key:`inventory:${work}:study:${inventory_study_id||i+1}`,publication_id:pub.id}));fail(`insert studies ${work}`,await supabase.from('research_studies').insert(rows))}
 const links=(accessGroups.get(work)||[]).filter(x=>x.url)
 fail(`delete imported access ${work}`,await supabase.from('research_access_links').delete().like('inventory_key',`inventory:${work}:%`))
 if(links.length){const rows=links.map(({inventory_work_id,...x},i)=>({...x,inventory_key:`inventory:${work}:access:${x.link_type}:${i+1}`,publication_id:pub.id}));fail(`insert access ${work}`,await supabase.from('research_access_links').insert(rows))}
 const metrics=metricGroups.get(work)||[]
 fail(`delete imported metrics ${work}`,await supabase.from('research_metrics').delete().like('inventory_key',`inventory:${work}:%`))
 if(metrics.length){const rows=metrics.map(({inventory_work_id,notes,...x},i)=>({...x,inventory_key:`inventory:${work}:metric:${x.metric_type}:${i+1}`,publication_id:pub.id}));fail(`insert metrics ${work}`,await supabase.from('research_metrics').insert(rows))}
}
fail('delete stale imported memberships',await supabase.from('research_review_memberships').delete().like('inventory_key','inventory:membership:%'))
for(const m of parsed.reviewMemberships){
 const review=byWork.get(m.review_inventory_work_id),included=byWork.get(m.included_inventory_work_id)
 if(!review||!included)throw new Error(`Review membership references missing Work ID ${m.review_inventory_work_id}/${m.included_inventory_work_id}`)
 const inventory_key=`inventory:membership:${m.review_inventory_work_id}::${m.included_inventory_work_id}`
 fail(`membership ${m.review_inventory_work_id}/${m.included_inventory_work_id}`,await supabase.from('research_review_memberships').upsert({inventory_key,review_publication_id:review.id,included_publication_id:included.id,membership_status:m.membership_status,membership_note:m.membership_note},{onConflict:'inventory_key'}))
}
console.log(JSON.stringify({inserted,updated,publications:byWork.size,warnings:parsed.warnings.length},null,2))
