import{slugifyResearchTitle,researchCompletion}from'./model.js'
import{calculateEvidenceStrength,calculateEqualParentingRelevance,calculateHistoricalImportance}from'./scoring.js'

const text=v=>String(v??'').trim()
const allowedPublicationFields=new Set(['doi','journal_or_publisher','country_text','overall_findings_summary','limitations_summary','what_it_supports','what_it_does_not_establish','finding_direction','topics','citation_verification'])

export function analysisInventoryKey(workId,label){
 const id=text(workId);if(!id)throw new Error('Analysis Work ID is required.')
 const slug=slugifyResearchTitle(label||'analysis');if(!slug)throw new Error(`Analysis label is required for ${id}.`)
 return`analysis::${id}::${slug}`
}

export function normalizeAnalysisDocument(input={}){
 const inventory_work_id=text(input.inventory_work_id);if(!inventory_work_id)throw new Error('Analysis inventory_work_id is required.')
 if(input?.publication?.editorial_status!==undefined)throw new Error(`${inventory_work_id}: editorial status is not allowed in curated analysis JSON.`)
 const sources=(input.sources||[]).map(s=>({url:text(s.url),kind:text(s.kind)||'source',verified:s.verified===true})).filter(s=>s.url)
 if(!sources.length)throw new Error(`${inventory_work_id}: at least one source URL is required.`)
 const publication={}
 for(const[k,v]of Object.entries(input.publication||{})){if(allowedPublicationFields.has(k))publication[k]=v}
 const seen=new Set()
 const studies=(input.studies||[]).map((study,index)=>{
  const label=text(study.study_label)||`Analysis ${index+1}`,sourceUrl=text(study.source_url||study.extraction_source_url)
  if(!sourceUrl)throw new Error(`${inventory_work_id} / ${label}: source URL is required for each substantive analysis row.`)
  const inventory_key=analysisInventoryKey(inventory_work_id,label)
  if(seen.has(inventory_key))throw new Error(`${inventory_work_id}: duplicate analysis label ${label}.`);seen.add(inventory_key)
  return{...study,study_label:label,inventory_key,extraction_source_url:sourceUrl,source_url:undefined,extraction_status:['unverified','needs_review','verified'].includes(study.extraction_status)?study.extraction_status:'needs_review',verified_at:study.extraction_status==='verified'?(study.verified_at||new Date().toISOString()):null}
 })
 return{inventory_work_id,sources,publication,studies,score_inputs:input.score_inputs||{},notes:text(input.notes)}
}

export function normalizeAnalysisDataset(raw){
 const records=Array.isArray(raw)?raw:Array.isArray(raw?.records)?raw.records:[raw]
 const normalized=records.filter(Boolean).map(normalizeAnalysisDocument)
 const ids=new Set();for(const r of normalized){if(ids.has(r.inventory_work_id))throw new Error(`Duplicate Work ID in curated analysis dataset: ${r.inventory_work_id}`);ids.add(r.inventory_work_id)}
 return normalized
}

export function proposedScores(publication,studies,scoreInputs={}){
 let evidence=null,evidenceDetail=null
 const empiricalScores=(studies||[]).map(study=>{
  const explicit=study.score_inputs?.evidence||{}
  const design=explicit.design||study.design_score_key||null
  if(!design)return null
  return calculateEvidenceStrength({...explicit,design,sample_size:explicit.sample_size??study.sample_size,pre_separation_controls:explicit.pre_separation_controls??study.pre_separation_controls,conflict_controls:explicit.conflict_controls??study.conflict_controls,ses_controls:explicit.ses_controls??study.ses_controls})
 }).filter(Boolean).sort((a,b)=>(b.completeness-a.completeness)||(b.score-a.score))
 if(empiricalScores.length){evidence=empiricalScores[0].score;evidenceDetail=empiricalScores[0]}
 const relevanceScores=(studies||[]).map(study=>calculateEqualParentingRelevance({exact_or_near_50_50:study.exact_or_near_50_50,shared_time_min_percent:study.shared_time_min_percent,parenting_time_definition:study.parenting_time_definition,topic_text:(publication.topics||[]).join(' '),source_type:publication.source_type,direct_child_outcome:publication.direct_child_outcome})).sort((a,b)=>b.score-a.score)
 const reviewRelevance=scoreInputs.relevance?calculateEqualParentingRelevance({...scoreInputs.relevance,source_type:publication.source_type,topic_text:(publication.topics||[]).join(' '),direct_child_outcome:scoreInputs.relevance.direct_child_outcome??publication.direct_child_outcome}):null
 const relevance=relevanceScores[0]||reviewRelevance||calculateEqualParentingRelevance({source_type:publication.source_type,topic_text:(publication.topics||[]).join(' '),direct_child_outcome:publication.direct_child_outcome})
 let historical=null
 if(scoreInputs.historical)historical=calculateHistoricalImportance(scoreInputs.historical)
 return{evidence_strength_score:evidence,equal_parenting_relevance_score:relevance?.score??null,historical_field_importance_score:historical?.score??null,score_notes:{curated_analysis:{evidence:evidenceDetail,relevance:relevance||null,historical:historical||null}}}
}

export function completionAfterImport(publication,bundle){return researchCompletion(publication,bundle)}
