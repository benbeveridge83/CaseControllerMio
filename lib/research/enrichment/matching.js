const normText=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
export const normalizeDoi=v=>String(v||'').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//,'').replace(/^doi:\s*/,'').trim()
const tokens=v=>new Set(normText(v).split(/\s+/).filter(Boolean))
const similarity=(a,b)=>{const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let intersection=0;for(const x of A)if(B.has(x))intersection++;return intersection/Math.max(A.size,B.size)}
const firstAuthor=v=>{if(Array.isArray(v))return normText(v[0]);return normText(String(v||'').split(/[;,]/)[0])}

export function matchConfidence(publication={},candidate={}){
 const pDoi=normalizeDoi(publication.doi),cDoi=normalizeDoi(candidate.doi)
 if(pDoi&&cDoi&&pDoi===cDoi)return{accepted:true,score:100,reasons:['exact DOI']}
 let score=0;const reasons=[]
 const pt=normText(publication.title),ct=normText(candidate.title)
 if(pt&&ct&&pt===ct){score+=60;reasons.push('exact normalized title')}
 else if(similarity(publication.title,candidate.title)>=0.92){score+=50;reasons.push('high title token similarity')}
 const py=Number(publication.publication_year),cy=Number(candidate.publication_year)
 if(Number.isFinite(py)&&Number.isFinite(cy)){
  if(py===cy){score+=20;reasons.push('exact year')}
  else if(Math.abs(py-cy)===1){score+=10;reasons.push('year within one')}
 }
 const pa=firstAuthor(publication.authors_text||publication.authors),ca=firstAuthor(candidate.authors||candidate.authors_text)
 if(pa&&ca&&pa===ca){score+=20;reasons.push('exact first author')}
 return{accepted:score>=85,score,reasons}
}
