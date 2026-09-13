export const FINDING_DIRECTIONS=['favors_shared','neutral','mixed','conditional_concern','disfavors_shared','methodology_only']
export const SOURCE_TYPES=['original_empirical','longitudinal','natural_experiment','systematic_review','meta_analysis','narrative_review','consensus_report','methodology_critique','policy_legal','other']
export const RESEARCH_TOPICS=['mental_health','physical_health','behavior','education','attachment','coparenting','conflict','father_child','mother_child','adolescents','young_children','policy','methodology','economics','stability']
const SCORE_KEYS=['impact_score','evidence_strength_score','equal_parenting_relevance_score','historical_field_importance_score']
const text=v=>String(v??'').trim()
const lower=v=>text(v).toLowerCase()
const numericOrNull=v=>{if(v===null||v===undefined||text(v)==='')return null;const n=Number(v);if(!Number.isFinite(n)||n<0||n>100)throw new Error('Research scores must be between 0 and 100.');return n}

export function slugifyResearchTitle(value=''){
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')
}

export function normalizePublicationDraft(input={}){
  const title=text(input.title)
  const source_type=SOURCE_TYPES.includes(input.source_type)?input.source_type:'other'
  const finding_direction=FINDING_DIRECTIONS.includes(input.finding_direction)?input.finding_direction:'mixed'
  const out={...input,title,source_type,finding_direction,topics:Array.isArray(input.topics)?[...new Set(input.topics.filter(Boolean))]:[]}
  for(const key of SCORE_KEYS)out[key]=numericOrNull(input[key])
  if(input.publication_year!==undefined&&input.publication_year!==null&&text(input.publication_year)!==''){
    const y=Number(input.publication_year)
    if(!Number.isInteger(y)||y<1800||y>2200)throw new Error('Publication year must be between 1800 and 2200.')
    out.publication_year=y
  }else out.publication_year=null
  if(!out.slug&&title)out.slug=slugifyResearchTitle(title)
  return out
}

export function validatePublicationForPublish(p,bundle={}){
  const errors=[]
  if(!text(p.title))errors.push('Title is required.')
  if(!text(p.authors_text))errors.push('Authors are required before publishing.')
  if(!Number.isInteger(Number(p.publication_year)))errors.push('Publication year is required before publishing.')
  if(!text(p.overall_findings_summary))errors.push('Findings summary is required before publishing.')
  const publicLinks=(bundle.accessLinks||[]).filter(x=>x?.is_public!==false&&text(x?.url))
  if(!publicLinks.length)errors.push('At least one public canonical, publisher, abstract, full-text, or purchase access link is required before publishing.')
  if(['original_empirical','longitudinal','natural_experiment','policy_legal'].includes(p.source_type)){
    for(const study of bundle.studies||[])if(!study?.causal_claim_strength||study.causal_claim_strength==='not_applicable')errors.push('Each empirical analysis needs a causal-claim-strength classification.')
  }
  return errors
}

export function matchesResearchFilters(row={},filters={}){
  if(filters.search){const hay=[row.title,row.authors_text,row.doi,row.publication_year,row.country_text].map(lower).join(' ');if(!hay.includes(lower(filters.search)))return false}
  if(filters.finding_direction&&row.finding_direction!==filters.finding_direction)return false
  if(filters.source_type&&row.source_type!==filters.source_type)return false
  if(filters.editorial_status&&row.editorial_status!==filters.editorial_status)return false
  if(filters.topic&&!((row.topics||[]).includes(filters.topic)))return false
  if(filters.access_status&&!((row.access_links||row.accessLinks||[]).some(x=>x.access_status===filters.access_status)))return false
  if(filters.exact50&&!((row.studies||[]).some(s=>s.exact_or_near_50_50===true)))return false
  return true
}

export function sortResearchRows(rows=[],sort={key:'publication_year',direction:'desc'}){
  const key=sort.key||'publication_year',dir=sort.direction==='asc'?1:-1
  return [...rows].sort((a,b)=>{const av=a?.[key],bv=b?.[key],an=av===null||av===undefined||av==='',bn=bv===null||bv===undefined||bv==='';if(an||bn){if(an&&bn)return 0;return an?1:-1}if(typeof av==='number'&&typeof bv==='number')return(av-bv)*dir;return String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'})*dir})
}
