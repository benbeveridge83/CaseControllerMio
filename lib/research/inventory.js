import * as XLSX from 'xlsx'
import {slugifyResearchTitle} from './model.js'

const clean=v=>String(v??'').trim()
const lower=v=>clean(v).toLowerCase()
const bool=v=>{const s=lower(v);if(['yes','true','1'].includes(s))return true;if(['no','false','0'].includes(s))return false;return null}
const dateOrNull=v=>{if(v===null||v===undefined||clean(v)==='')return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString()}
const numOrNull=v=>{if(v===null||v===undefined||clean(v)==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
const rows=(wb,name)=>XLSX.utils.sheet_to_json(wb.Sheets[name]||{}, {defval:null,raw:false})

export function mapSourceType(value){
 const s=lower(value)
 if(s.includes('natural experiment'))return'natural_experiment'
 if(s.includes('meta-analysis'))return'meta_analysis'
 if(s.includes('systematic review'))return'systematic_review'
 if(s.includes('consensus'))return'consensus_report'
 if(s.includes('review')||s.includes('synthesis'))return'narrative_review'
 if(s.includes('longitudinal'))return'longitudinal'
 if(s.includes('methodolog'))return'methodology_critique'
 if(s.includes('policy')||s.includes('legal')||s.includes('government'))return'policy_legal'
 if(s.includes('empirical')||s.includes('study'))return'original_empirical'
 return'other'
}
export function mapDirection(value){
 const s=lower(value)
 if(!s)return'mixed'
 if(s.includes('methodolog')||s==='review'||s==='consensus')return'methodology_only'
 if(s.includes('disfavor')||s.includes('harmful')||s.includes('adverse process')||s.includes('reduced private'))return'disfavors_shared'
 if(s.includes('neutral after')||s.includes('disappears after'))return'neutral'
 if(s.includes('concern')||s.includes('conditional')||s.includes('eroded')||s.includes('reverse benefit'))return'conditional_concern'
 if(s.includes('favor')||s.includes('protective')||s.includes('least difficulties')||s.includes('sole worse')||s.includes('shared ~= intact'))return'favors_shared'
 return'mixed'
}
function uniqueSlugs(publications){const used=new Map();for(const p of publications){const base=slugifyResearchTitle([p.authors_text.split(',')[0],p.publication_year,p.title].filter(Boolean).join(' '))||'research';const n=(used.get(base)||0)+1;used.set(base,n);p.slug=n===1?base:`${base}-${n}`}}

export function parseResearchInventory(workbook){
 const warnings=[]
 const publications=rows(workbook,'Master Works').map(r=>{
  const direction=mapDirection(r['Preliminary Direction']),source_type=mapSourceType(r['Source Type'])
  return{inventory_work_id:clean(r['Work ID']),title:clean(r['Title']),authors_text:clean(r['Authors']),publication_year:numOrNull(r['Year']),source_type,admission_route:clean(r['Admission Route'])||null,direct_child_outcome:bool(r['Direct Child Outcome?']),included_nielsen_2018:bool(r['Included in Nielsen 2018?']),country_text:clean(r['Country'])||null,doi:clean(r['DOI'])||null,finding_direction:direction,editorial_status:'draft',citation_verification:clean(r['Citation Verification'])||null,internal_notes:clean(r['Notes'])||null,inventory_raw:{source_type_original:r['Source Type']??null,direction_original:r['Preliminary Direction']??null,sample_n:r['Sample N']??null,shared_equal_definition:r['Shared/Equal Definition']??null,design:r['Design']??null,access_status:r['Access Status']??null}}
 })
 uniqueSlugs(publications)
 const workIds=new Set(publications.map(p=>p.inventory_work_id))
 const accessLinks=[]
 for(const r of rows(workbook,'Access Queue')){
  const work=clean(r['Work ID']);if(!workIds.has(work)){warnings.push(`Access row references missing Work ID ${work}`);continue}
  const common={inventory_work_id:work,access_status:clean(r['Access Status'])||'unknown',license_text:clean(r['License/Permission Notes'])||null,checked_at:null}
  if(clean(r['Canonical URL']))accessLinks.push({...common,link_type:'canonical',url:clean(r['Canonical URL']),redistribution_permitted:false,is_preferred:true,is_public:true})
  if(clean(r['Full Text / OA URL']))accessLinks.push({...common,link_type:'full_text_oa',url:clean(r['Full Text / OA URL']),redistribution_permitted:false,is_preferred:false,is_public:true})
  const decision=lower(r['Mio Copy Decision']),license=lower(r['License/Permission Notes'])
  if(decision.includes('approved')||decision.includes('permitted'))accessLinks.push({...common,link_type:'mio_public_copy',url:'',redistribution_permitted:license.includes('permit')||license.includes('license'),is_preferred:false,is_public:false})
 }
 const metrics=[]
 for(const r of rows(workbook,'Metric Snapshots')){const work=clean(r['Work ID']),value=numOrNull(r['Value']);if(!workIds.has(work)){warnings.push(`Metric row references missing Work ID ${work}`);continue}if(value===null)continue;const captured_at=dateOrNull(r['Retrieved']);if(!captured_at&&clean(r['Retrieved']))warnings.push(`Invalid metric date for ${work}: ${r['Retrieved']}`);metrics.push({inventory_work_id:work,provider:clean(r['Source'])||'inventory',metric_type:clean(r['Metric'])||'metric',metric_value:value,source_url:null,captured_at:captured_at||new Date(0).toISOString(),notes:clean(r['Notes'])||null})}
 const studies=[]
 for(const r of rows(workbook,'Study Analysis Template')){const work=clean(r['Work ID']);if(!work)continue;if(!workIds.has(work)){warnings.push(`Study row references missing Work ID ${work}`);continue}const definition=clean(r['Exact Parenting-Time Definition']);studies.push({inventory_work_id:work,inventory_study_id:clean(r['Study ID'])||null,study_label:clean(r['Sample/Analysis Label'])||'Analysis',extraction_status:lower(r['Extraction Status'])==='verified'?'verified':'unverified',country_text:clean(r['Country'])||null,sample_size:numOrNull(r['Sample N']),child_age_text:clean(r['Child Ages'])||null,parenting_time_definition:definition||null,exact_or_near_50_50:/\b50\s*\/\s*50\b|equal\s+time|alternating\s+weeks/i.test(definition)||null,comparator:clean(r['Comparator'])||null,outcomes_measured:[clean(r['Outcome Domain']),clean(r['Outcome Measure'])].filter(Boolean).join(' — ')||null,longitudinal:bool(r['Longitudinal?']),pre_separation_controls:bool(r['Pre-separation Controls?']),conflict_controls:bool(r['Conflict Controls?']),ses_controls:bool(r['SES Controls?']),effect_size_summary:clean(r['Effect Size'])||null,result_direction:mapDirection(r['Result Direction'])==='methodology_only'?'mixed':mapDirection(r['Result Direction']),causal_claim_strength:['high','moderate','low','very_low'].includes(lower(r['Causal Claim Strength']))?lower(r['Causal Claim Strength']):'not_applicable',key_limitation:clean(r['Key Limitation'])||null})}
 const reviewMemberships=rows(workbook,'Review Memberships').map(r=>({review_inventory_work_id:clean(r['Review Work ID']),included_inventory_work_id:clean(r['Member Work ID']),membership_status:lower(r['Membership Status'])||'included',membership_note:clean(r['Notes'])||null})).filter(r=>r.review_inventory_work_id&&r.included_inventory_work_id)
 for(const m of reviewMemberships)if(!workIds.has(m.review_inventory_work_id)||!workIds.has(m.included_inventory_work_id))warnings.push(`Review membership references missing Work ID ${m.review_inventory_work_id}/${m.included_inventory_work_id}`)
 return{publications,studies,accessLinks,metrics,reviewMemberships,warnings}
}
