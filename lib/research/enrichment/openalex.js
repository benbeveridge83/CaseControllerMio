import{matchConfidence,normalizeDoi}from'./matching.js'
const authors=w=>(w?.authorships||[]).map(x=>x?.author?.display_name).filter(Boolean)
const candidate=w=>({doi:w?.doi,title:w?.title,publication_year:w?.publication_year,authors:authors(w)})
const normalize=w=>{
 if(!w)return null
 const loc=w.primary_location||{}
 return{provider:'OpenAlex',openalex_id:String(w.id||'').split('/').pop()||null,doi:normalizeDoi(w.doi)||null,title:w.title||null,publication_year:w.publication_year||null,authors:authors(w),citation_count:Number.isFinite(Number(w.cited_by_count))?Number(w.cited_by_count):null,fwci:Number.isFinite(Number(w.fwci))?Number(w.fwci):null,canonical_url:loc.landing_page_url||w.doi||null,open_access_pdf:loc.pdf_url||null,is_oa:Boolean(w?.open_access?.is_oa),oa_status:w?.open_access?.oa_status||null}
}
async function jsonOrNull(response){if(!response?.ok)return null;try{return await response.json()}catch{return null}}
export async function fetchOpenAlexWork(fetchFn,publication={}){
 const doi=normalizeDoi(publication.doi)
 if(doi){
  const url=`https://api.openalex.org/works/${encodeURIComponent(`https://doi.org/${doi}`)}`
  const response=await fetchFn(url)
  const body=await jsonOrNull(response)
  if(body){const m=matchConfidence(publication,candidate(body));if(m.accepted)return{...normalize(body),match:m}}
  if(response?.status&&response.status!==404)return null
 }
 const title=String(publication.title||'').trim();if(!title)return null
 const response=await fetchFn(`https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=5`)
 const body=await jsonOrNull(response);if(!body)return null
 const matches=(body.results||[]).map(w=>({w,m:matchConfidence(publication,candidate(w))})).filter(x=>x.m.accepted).sort((a,b)=>b.m.score-a.m.score)
 return matches.length?{...normalize(matches[0].w),match:matches[0].m}:null
}
