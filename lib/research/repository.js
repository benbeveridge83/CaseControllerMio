import{slugifyResearchTitle}from'./model.js'
const PUBLICATION_COLUMNS='id,inventory_work_id,slug,title,authors_text,publication_year,journal_or_publisher,doi,source_type,admission_route,direct_child_outcome,included_nielsen_2018,country_text,citation_text,abstract_summary,overall_findings_summary,limitations_summary,what_it_supports,what_it_does_not_establish,finding_direction,topics,evidence_strength_score,impact_score,equal_parenting_relevance_score,historical_field_importance_score,score_notes,editorial_status,published_at,citation_verification,internal_notes,inventory_raw,created_by,updated_by,created_at,updated_at'
const LIST_COLUMNS=`${PUBLICATION_COLUMNS},studies:research_studies(id,study_label,extraction_status,country_text,sample_size,child_age_text,age_min,age_max,parenting_time_definition,shared_time_min_percent,shared_time_max_percent,exact_or_near_50_50,comparator,study_design,outcomes_measured,controls_summary,longitudinal,pre_separation_controls,conflict_controls,ses_controls,effect_size_summary,result_direction,result_summary,key_limitation,causal_claim_strength),access_links:research_access_links(id,link_type,url,access_status,license_text,redistribution_permitted,is_preferred,is_public,checked_at)`
const fail=r=>{if(r?.error)throw new Error(r.error.message||String(r.error));return r?.data}
const cleanPublication=input=>{const {studies,accessLinks,access_links,metrics,reviewMemberships,review_memberships,...row}=input||{};return row}

export async function listResearchPublications(client){return fail(await client.from('research_publications').select(LIST_COLUMNS).order('publication_year',{ascending:false,nullsFirst:false}))||[]}
export async function getResearchPublication(client,id){
  const publication=fail(await client.from('research_publications').select(PUBLICATION_COLUMNS).eq('id',id).single())
  const [studies,accessLinks,metrics,reviewMemberships]=await Promise.all([
    client.from('research_studies').select('*').eq('publication_id',id),
    client.from('research_access_links').select('*').eq('publication_id',id),
    client.from('research_metrics').select('*').eq('publication_id',id),
    client.from('research_review_memberships').select('*').eq('included_publication_id',id)
  ]).then(rs=>rs.map(fail))
  return {publication,studies:studies||[],accessLinks:accessLinks||[],metrics:metrics||[],reviewMemberships:reviewMemberships||[]}
}
export async function saveResearchPublication(client,input){const row=cleanPublication(input);if(!row.id&&!row.slug){row.slug=slugifyResearchTitle(row.title);if(!row.slug)throw new Error('Title is required before saving a new research publication.')}return fail(await client.from('research_publications').upsert(row,{onConflict:row.id?'id':'slug'}).select(PUBLICATION_COLUMNS).single())}
async function replaceChildren(client,table,publicationId,rows=[]){fail(await client.from(table).delete().eq('publication_id',publicationId));if(!rows.length)return[];const payload=rows.map(({id,...row})=>({...row,publication_id:publicationId}));return fail(await client.from(table).insert(payload).select('*'))||[]}
export const replaceResearchStudies=(client,id,rows)=>replaceChildren(client,'research_studies',id,rows)
export const replaceResearchAccessLinks=(client,id,rows)=>replaceChildren(client,'research_access_links',id,rows)
export const replaceResearchMetrics=(client,id,rows)=>replaceChildren(client,'research_metrics',id,rows)
export async function replaceResearchReviewMemberships(client,publicationId,rows=[]){fail(await client.from('research_review_memberships').delete().eq('included_publication_id',publicationId));if(!rows.length)return[];const payload=rows.map(({id,...row})=>({...row,included_publication_id:publicationId}));return fail(await client.from('research_review_memberships').insert(payload).select('*'))||[]}
export async function setResearchEditorialStatus(client,id,status,actorId){const patch={editorial_status:status,updated_by:actorId,updated_at:new Date().toISOString()};if(status==='published')patch.published_at=new Date().toISOString();const {data,error}=await client.from('research_publications').update(patch).eq('id',id).select(PUBLICATION_COLUMNS).single();if(error)throw new Error(error.message);return data}
export {PUBLICATION_COLUMNS,LIST_COLUMNS}
