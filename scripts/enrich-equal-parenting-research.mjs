import{createClient}from'@supabase/supabase-js'
import{enrichPublication}from'../lib/research/enrichment/orchestrator.js'

const args=process.argv.slice(2)
const flag=name=>args.includes(name)
const value=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null}
const dryRun=flag('--dry-run'),workId=value('--work-id'),limitRaw=value('--limit'),all=flag('--all')
if(!dryRun&&!all&&!workId&&!limitRaw)throw new Error('Choose --all, --work-id <ID>, --limit <N>, or --dry-run.')
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key)throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the shell. The service-role key must never use a VITE_ prefix.')
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
let q=client.from('research_publications').select('*').order('publication_year',{ascending:false,nullsFirst:false})
if(workId)q=q.eq('inventory_work_id',workId)
const{data,error}=await q;if(error)throw new Error(error.message)
let publications=data||[]
if(limitRaw){const n=Number(limitRaw);if(!Number.isInteger(n)||n<1)throw new Error('--limit must be a positive integer.');publications=publications.slice(0,n)}
if(dryRun){console.log(`DRY RUN: ${publications.length} publications would be enriched.`);for(const p of publications)console.log(`${p.inventory_work_id||p.id} ${p.title}`);process.exit(0)}
const summary={enriched:0,partial:0,needs_review:0,errors:0}
for(const p of publications){
 try{
  const r=await enrichPublication({client,publication:p,fetchFn:fetch,currentYear:new Date().getUTCFullYear(),semanticScholarApiKey:process.env.SEMANTIC_SCHOLAR_API_KEY})
  summary[r.status]=(summary[r.status]||0)+1
  console.log(`${p.inventory_work_id||p.id} ${r.status} OpenAlex citations=${r.openAlex?.citation_count??'n/a'} FWCI=${r.openAlex?.fwci??'n/a'} reviews=${r.reviewCount??'n/a'} impact=${r.impact?.score??'n/a'} completeness=${r.impact?.completeness??'n/a'}${r.warnings?.length?` warnings=${r.warnings.join(' | ')}`:''}`)
 }catch(e){summary.errors++;console.error(`${p.inventory_work_id||p.id} ERROR ${e?.message||e}`)}
}
console.log(`SUMMARY enriched=${summary.enriched} partial=${summary.partial} needs_review=${summary.needs_review} errors=${summary.errors}`)
if(summary.errors&&summary.errors===publications.length)process.exitCode=1
