import{fetchOpenAlexWork}from'./openalex.js'
import{fetchSemanticScholarWork}from'./semanticScholar.js'
import{calculateCitationsPerYear}from'../model.js'
import{calculateImpactScore}from'../scoring.js'
import{appendResearchMetric,upsertResearchAccessLink,updateResearchSummary,countVerifiedMajorReviews}from'../repository.js'

const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))
const percentile=(value,values=[])=>{if(!finite(value))return null;const clean=values.filter(finite).map(Number);if(!clean.length)return null;const v=Number(value);return Math.round((clean.filter(x=>x<=v).length/clean.length)*1000)/10}
const readRows=async(client,columns)=>{const{data,error}=await client.from('research_publications').select(columns);if(error)throw new Error(error.message);return data||[]}

export async function enrichPublication({client,publication,fetchFn=fetch,currentYear=new Date().getUTCFullYear(),semanticScholarApiKey}={}){
 if(!client||!publication?.id)throw new Error('Enrichment requires a database client and publication id.')
 const warnings=[];const now=new Date().toISOString()
 let oa=null
 try{oa=await fetchOpenAlexWork(fetchFn,publication)}catch(e){warnings.push(`OpenAlex: ${e?.message||e}`)}
 if(!oa)return{status:'needs_review',warnings:[...warnings,'No high-confidence OpenAlex match.']}

 if(oa.citation_count!==null)await appendResearchMetric(client,{publication_id:publication.id,provider:'OpenAlex',metric_type:'citation_count',metric_value:oa.citation_count,source_url:oa.openalex_id?`https://openalex.org/${oa.openalex_id}`:null,captured_at:now})
 if(oa.fwci!==null)await appendResearchMetric(client,{publication_id:publication.id,provider:'OpenAlex',metric_type:'fwci',metric_value:oa.fwci,source_url:oa.openalex_id?`https://openalex.org/${oa.openalex_id}`:null,captured_at:now})
 if(oa.open_access_pdf)await upsertResearchAccessLink(client,{publication_id:publication.id,link_type:'open_access_pdf',url:oa.open_access_pdf,access_status:'free full text',license_text:null,redistribution_permitted:false,is_preferred:true,is_public:true,checked_at:now})
 if(oa.canonical_url)await upsertResearchAccessLink(client,{publication_id:publication.id,link_type:'publisher',url:oa.canonical_url,access_status:oa.is_oa?'free full text':'publisher access',license_text:null,redistribution_permitted:false,is_preferred:!oa.open_access_pdf,is_public:true,checked_at:now})

 let semantic=null
 try{semantic=await fetchSemanticScholarWork(fetchFn,publication,{apiKey:semanticScholarApiKey})}catch(e){warnings.push(`Semantic Scholar: ${e?.message||e}`)}
 if(semantic?.error)warnings.push(`Semantic Scholar: ${semantic.error}`)
 if(semantic&&!semantic.error&&semantic.influential_citation_count!==null)await appendResearchMetric(client,{publication_id:publication.id,provider:'Semantic Scholar',metric_type:'influential_citation_count',metric_value:semantic.influential_citation_count,source_url:semantic.canonical_url,captured_at:now})

 const reviewCount=await countVerifiedMajorReviews(client,publication.id)
 const cpy=calculateCitationsPerYear(oa.citation_count,publication.publication_year,currentYear)
 const cohort=await readRows(client,'id,citation_count_current,citations_per_year,fwci_current,influential_citation_count_current,major_review_count')
 const overlay=cohort.map(r=>r.id===publication.id?{...r,citation_count_current:oa.citation_count,citations_per_year:cpy,fwci_current:oa.fwci,influential_citation_count_current:semantic&&!semantic.error?semantic.influential_citation_count:r.influential_citation_count_current,major_review_count:reviewCount}:r)
 const impact=calculateImpactScore({
  citation_percentile:percentile(oa.citation_count,overlay.map(x=>x.citation_count_current)),
  citations_per_year_percentile:percentile(cpy,overlay.map(x=>x.citations_per_year)),
  fwci_percentile:percentile(oa.fwci,overlay.map(x=>x.fwci_current)),
  influential_citation_percentile:percentile(semantic&&!semantic.error?semantic.influential_citation_count:null,overlay.map(x=>x.influential_citation_count_current)),
  review_inclusion_percentile:percentile(reviewCount,overlay.map(x=>x.major_review_count))
 })
 await updateResearchSummary(client,publication.id,{citation_count_current:oa.citation_count,citation_count_provider:'OpenAlex',citation_count_captured_at:now,citations_per_year:cpy,fwci_current:oa.fwci,influential_citation_count_current:semantic&&!semantic.error?semantic.influential_citation_count:null,major_review_count:reviewCount,impact_score:impact.score,impact_data_completeness:impact.completeness,citation_verification:'verified'})
 return{status:warnings.length?'partial':'enriched',warnings,openAlex:oa,semanticScholar:semantic,impact,reviewCount,citationsPerYear:cpy}
}

export{percentile}
