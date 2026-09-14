export const FINDING_DIRECTIONS=['favors_shared','neutral','mixed','conditional_concern','disfavors_shared','methodology_only']
export const SOURCE_TYPES=['original_empirical','longitudinal','natural_experiment','systematic_review','meta_analysis','narrative_review','consensus_report','methodology_critique','policy_legal','other']
export const RESEARCH_TOPICS=['mental_health','physical_health','behavior','education','attachment','coparenting','conflict','father_child','mother_child','adolescents','young_children','policy','methodology','economics','stability']
const SCORE_KEYS=['impact_score','evidence_strength_score','equal_parenting_relevance_score','historical_field_importance_score']
const EMPIRICAL_TYPES=new Set(['original_empirical','longitudinal','natural_experiment','policy_legal'])
const EVIDENCE_OPTIONAL_TYPES=new Set(['consensus_report','methodology_critique'])
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

const reviewedStudies=studies=>(studies||[]).filter(s=>s?.extraction_status!=='unverified')
const hasPublicLink=links=>(links||[]).some(x=>x?.is_public!==false&&text(x?.url)&&(x?.link_type!=='mio_public_copy'||x?.redistribution_permitted===true))
const citationKnown=p=>p?.citation_count_captured_at!=null||p?.citation_verification==='unavailable'

export function researchCompletion(p={},bundle={}){
  const empirical=EMPIRICAL_TYPES.has(p.source_type),studies=reviewedStudies(bundle.studies),nonEmpirical=!empirical
  const items=[
    {label:'Bibliography verified',done:Boolean(text(p.title)&&text(p.authors_text)&&Number.isInteger(Number(p.publication_year)))},
    {label:'Source link verified',done:hasPublicLink(bundle.accessLinks)},
    {label:'Citation metrics current',done:citationKnown(p)},
    {label:'Study definition coded',applicable:empirical,done:nonEmpirical||studies.some(x=>text(x.parenting_time_definition))},
    {label:'Sample/ages coded',applicable:empirical,done:nonEmpirical||studies.some(x=>(Number(x.sample_size)>0||text(x.child_age_text)))},
    {label:'Design coded',applicable:empirical,done:nonEmpirical||studies.some(x=>text(x.study_design))},
    {label:'Controls coded',applicable:empirical,done:nonEmpirical||studies.some(x=>text(x.controls_summary))},
    {label:'Findings coded',done:Boolean(text(p.overall_findings_summary))},
    {label:'Limitations coded',done:Boolean(text(p.limitations_summary))},
    {label:'What it supports coded',done:Boolean(text(p.what_it_supports))},
    {label:'What it does not establish coded',done:Boolean(text(p.what_it_does_not_establish))},
    {label:'Evidence score ready',done:p.evidence_strength_score!=null||EVIDENCE_OPTIONAL_TYPES.has(p.source_type)},
    {label:'Relevance score ready',done:p.equal_parenting_relevance_score!=null},
    {label:'Impact score ready',done:p.impact_score!=null||p.citation_verification==='unavailable'},
    {label:'Historical importance reviewed',done:p.historical_field_importance_score!=null}
  ].map(x=>({applicable:x.applicable!==false,...x}))
  const applicable=items.filter(x=>x.applicable),done=applicable.filter(x=>x.done).length,percent=applicable.length?Math.round((done/applicable.length)*100):0
  const substantive=['Findings coded','Limitations coded','What it supports coded','What it does not establish coded'].every(label=>items.find(x=>x.label===label)?.done)
  const empiricalVerified=!empirical||studies.length>0&&studies.every(x=>x.extraction_status==='verified')
  const status=percent===100&&substantive&&empiricalVerified?'verified':percent>=80&&substantive?'ready_for_editorial_review':'needs_enrichment'
  return{status,items,percent}
}

export function validatePublicationForPublish(p,bundle={}){
  const errors=[]
  if(!text(p.title))errors.push('Title is required.')
  if(!text(p.authors_text))errors.push('Authors are required before publishing.')
  if(!Number.isInteger(Number(p.publication_year)))errors.push('Publication year is required before publishing.')
  if(!hasPublicLink(bundle.accessLinks))errors.push('At least one public canonical, publisher, abstract, full-text, or purchase access link is required before publishing.')
  if(!text(p.overall_findings_summary))errors.push('Findings summary is required before publishing.')
  if(!text(p.limitations_summary))errors.push('Limitations are required before publishing.')
  if(!text(p.what_it_supports))errors.push('What this study supports is required before publishing.')
  if(!text(p.what_it_does_not_establish))errors.push('What this study does not establish is required before publishing.')
  if(!FINDING_DIRECTIONS.includes(p.finding_direction))errors.push('Finding direction must be reviewed before publishing.')
  if(!citationKnown(p))errors.push('Citation data must be current or explicitly marked unavailable before publishing.')
  if(p.evidence_strength_score==null&&!EVIDENCE_OPTIONAL_TYPES.has(p.source_type))errors.push('Evidence Strength must be reviewed before publishing.')
  if(p.equal_parenting_relevance_score==null)errors.push('Equal-Parenting Relevance must be reviewed before publishing.')
  if(p.historical_field_importance_score==null)errors.push('Historical / Field Importance must be reviewed before publishing.')
  if(p.impact_score==null&&p.citation_verification!=='unavailable')errors.push('Impact must be calculated or citation data explicitly marked unavailable before publishing.')
  if(EMPIRICAL_TYPES.has(p.source_type)){
    const studies=reviewedStudies(bundle.studies)
    if(!studies.length)errors.push('At least one reviewed study analysis is required before publishing an empirical record.')
    else for(const study of studies){
      if(!text(study.parenting_time_definition))errors.push('Each empirical analysis needs its parenting-time definition coded.')
      if(!(Number(study.sample_size)>0||text(study.child_age_text)))errors.push('Each empirical analysis needs sample size or child ages coded.')
      if(!text(study.study_design))errors.push('Each empirical analysis needs its study design coded.')
      if(!text(study.controls_summary))errors.push('Each empirical analysis needs controls coded.')
      if(!study?.causal_claim_strength||study.causal_claim_strength==='not_applicable')errors.push('Each empirical analysis needs a causal-claim-strength classification.')
    }
  }
  return [...new Set(errors)]
}

export function classifyExact50(studies=[]){
  if(!studies.length)return 'unknown'
  const usable=studies.filter(s=>s?.extraction_status!=='unverified')
  const coded=usable.filter(s=>s?.exact_or_near_50_50===true||s?.exact_or_near_50_50===false)
  if(!coded.length)return 'unknown'
  return coded.some(s=>s.exact_or_near_50_50===true)?'yes':'no'
}

const LINK_PRIORITY=['mio_public_copy','open_access_pdf','open_access_html','full_text_oa','repository_manuscript','repository','publisher','purchase','canonical_doi','canonical','abstract']
export function preferredResearchLink(links=[]){
  const usable=(links||[]).filter(x=>x?.url&&x.is_public!==false&&(x.link_type!=='mio_public_copy'||x.redistribution_permitted===true))
  const rank=x=>{const i=LINK_PRIORITY.indexOf(x?.link_type);return i<0?LINK_PRIORITY.length:i}
  return [...usable].sort((a,b)=>rank(a)-rank(b))[0]||null
}

export function calculateCitationsPerYear(count,year,currentYear=new Date().getUTCFullYear()){
  if(count===null||count===undefined||count===''||!Number.isFinite(Number(count)))return null
  const y=Number(year)
  if(!Number.isFinite(y))return null
  return Number(count)/Math.max(1,currentYear-y+1)
}

export function matchesResearchFilters(row={},filters={}){
  if(filters.search){const hay=[row.title,row.authors_text,row.doi,row.publication_year,row.country_text].map(lower).join(' ');if(!hay.includes(lower(filters.search)))return false}
  if(filters.finding_direction&&row.finding_direction!==filters.finding_direction)return false
  if(filters.source_type&&row.source_type!==filters.source_type)return false
  if(filters.editorial_status&&row.editorial_status!==filters.editorial_status)return false
  if(filters.topic&&!((row.topics||[]).includes(filters.topic)))return false
  if(filters.access_status&&!((row.access_links||row.accessLinks||[]).some(x=>x.access_status===filters.access_status)))return false
  if(filters.exact50&&classifyExact50(row.studies||[])!=='yes')return false
  return true
}

export function sortResearchRows(rows=[],sort={key:'publication_year',direction:'desc'}){
  const key=sort.key||'publication_year',dir=sort.direction==='asc'?1:-1
  return [...rows].sort((a,b)=>{const av=a?.[key],bv=b?.[key],an=av===null||av===undefined||av==='',bn=bv===null||bv===undefined||bv==='';if(an||bn){if(an&&bn)return 0;return an?1:-1}if(typeof av==='number'&&typeof bv==='number')return(av-bv)*dir;return String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'})*dir})
}
