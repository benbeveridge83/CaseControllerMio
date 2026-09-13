import{normalizeDoi,matchConfidence}from'./matching.js'
const normalize=p=>p?{provider:'Semantic Scholar',semantic_scholar_id:p.paperId||null,doi:normalizeDoi(p?.externalIds?.DOI)||null,title:p.title||null,publication_year:p.year||null,authors:(p.authors||[]).map(a=>a.name).filter(Boolean),citation_count:Number.isFinite(Number(p.citationCount))?Number(p.citationCount):null,influential_citation_count:Number.isFinite(Number(p.influentialCitationCount))?Number(p.influentialCitationCount):null,canonical_url:p.url||null,open_access_pdf:p?.openAccessPdf?.url||null}:null
export async function fetchSemanticScholarWork(fetchFn,publication={},opts={}){
 const doi=normalizeDoi(publication.doi);if(!doi)return null
 const fields='title,year,authors,citationCount,influentialCitationCount,externalIds,url,openAccessPdf'
 const headers=opts.apiKey?{'x-api-key':opts.apiKey}:{}
 try{
  const response=await fetchFn(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=${encodeURIComponent(fields)}`,{headers})
  if(!response?.ok)return{provider:'Semantic Scholar',error:`HTTP ${response?.status||'error'}`}
  const body=await response.json();const normalized=normalize(body);if(!normalized)return null
  const m=matchConfidence(publication,{doi:normalized.doi,title:normalized.title,publication_year:normalized.publication_year,authors:normalized.authors})
  return m.accepted?{...normalized,match:m}:{provider:'Semantic Scholar',error:'Low-confidence match',match:m}
 }catch(e){return{provider:'Semantic Scholar',error:e?.message||String(e)}}
}
