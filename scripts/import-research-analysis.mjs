import fs from'node:fs'
import{createClient}from'@supabase/supabase-js'
import{normalizeAnalysisDataset,proposedScores,completionAfterImport}from'../lib/research/analysisImport.js'

const args=process.argv.slice(2),dryRun=args.includes('--dry-run'),allowVerifiedOverwrite=args.includes('--allow-verified-overwrite')
const file=args.find(x=>!x.startsWith('--'))
if(!file)throw new Error('Usage: node scripts/import-research-analysis.mjs [--dry-run] [--allow-verified-overwrite] <analysis.json>')
const raw=JSON.parse(fs.readFileSync(file,'utf8')),records=normalizeAnalysisDataset(raw)
if(dryRun){console.log(`DRY RUN: ${records.length} curated research records parsed.`);for(const r of records)console.log(`${r.inventory_work_id} studies=${r.studies.length} sources=${r.sources.length}`);process.exit(0)}
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key)throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the shell. Never expose the service-role key in a VITE_ variable.')
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const fail=r=>{if(r?.error)throw new Error(r.error.message||String(r.error));return r?.data}
let imported=0,conflicts=0
for(const record of records){
 const publication=fail(await client.from('research_publications').select('*').eq('inventory_work_id',record.inventory_work_id).single())
 if(!publication)throw new Error(`Unknown inventory Work ID: ${record.inventory_work_id}`)
 const existingStudies=fail(await client.from('research_studies').select('*').eq('publication_id',publication.id))||[]
 const existingByKey=new Map(existingStudies.filter(x=>x.inventory_key).map(x=>[x.inventory_key,x]))
 let blocked=false
 for(const [field,value]of Object.entries(record.publication)){
  if(value===undefined)continue
  if(publication.analysis_verified_at&&publication[field]!=null&&String(publication[field])!==String(value)){console.error(`${record.inventory_work_id} CONFLICT verified publication field ${field}`);blocked=true;conflicts++}
 }
 if(blocked)continue
 const studyRows=[]
 for(const study of record.studies){
  const existing=existingByKey.get(study.inventory_key)
  if(existing?.extraction_status==='verified'&&!allowVerifiedOverwrite){console.error(`${record.inventory_work_id} CONFLICT verified analysis ${study.study_label}`);blocked=true;conflicts++;continue}
  const{score_inputs,source_url,...row}=study
  studyRows.push({...row,publication_id:publication.id})
 }
 if(blocked&&studyRows.length!==record.studies.length)continue
 if(studyRows.length)fail(await client.from('research_studies').upsert(studyRows,{onConflict:'inventory_key'}).select('id'))
 const mergedPublication={...publication,...record.publication}
 const scores=proposedScores(mergedPublication,record.studies,record.score_inputs)
 const scoreNotes={...(publication.score_notes||{}),...(scores.score_notes||{})}
 const patch={...record.publication,score_notes:scoreNotes}
 if(scores.evidence_strength_score!=null)patch.evidence_strength_score=scores.evidence_strength_score
 if(scores.equal_parenting_relevance_score!=null)patch.equal_parenting_relevance_score=scores.equal_parenting_relevance_score
 if(scores.historical_field_importance_score!=null)patch.historical_field_importance_score=scores.historical_field_importance_score
 const accessLinks=fail(await client.from('research_access_links').select('*').eq('publication_id',publication.id))||[]
 const metrics=fail(await client.from('research_metrics').select('*').eq('publication_id',publication.id))||[]
 const completion=completionAfterImport({...mergedPublication,...patch},{studies:record.studies,accessLinks,metrics})
 patch.analysis_completion_status=completion.status
 patch.analysis_verified_at=completion.status==='verified'?(publication.analysis_verified_at||new Date().toISOString()):null
 fail(await client.from('research_publications').update(patch).eq('id',publication.id).select('id').single())
 imported++;console.log(`${record.inventory_work_id} imported studies=${record.studies.length} completion=${completion.status} evidence=${patch.evidence_strength_score??'n/a'} relevance=${patch.equal_parenting_relevance_score??'n/a'} historical=${patch.historical_field_importance_score??'n/a'}`)
}
console.log(`SUMMARY imported=${imported} conflicts=${conflicts} total=${records.length}`)
if(conflicts)process.exitCode=2
