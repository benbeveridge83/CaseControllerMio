import {extractDisclosureRequests} from './disclosure-extraction.js'

export function extractServedDiscoveryRequests(rawText='',type=''){
 if(/disclosure|rfd/i.test(type))return extractDisclosureRequests(rawText)
 const clean=String(rawText||'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ')
  .replace(/\bPage\s+\d+\s+of\s+\d+\b/gi,' ')
  .replace(/Electronically\s+Served\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?/gi,' ')
  .replace(/[\t ]+/g,' ').trim()
 if(!clean)return []
 // A heading must lead into the actual list. A mention of "these interrogatories"
 // inside question 18 is not a new heading and must never discard questions 1–18.
 const exhibits=[...clean.matchAll(/\bExhibit\s+A\s*(?:(?:Interrogatories|Requests?\s+for\s+(?:Production|Admissions?))\s*:?\s*)?(?=1[.)]\s)/gi)]
 const body=exhibits.length?clean.slice(exhibits.at(-1).index+exhibits.at(-1)[0].length):clean
 let markers=[]
 if(!exhibits.length){
  const named=/(?:^|\s)(?:request\s+for\s+(?:production|inspection|admissions?)|interrogator(?:y|ies)|rfp|rfa|rogs?)\s*(?:no\.?|number|#)?\s*(\d{1,3})\b\s*[).:\-]?/gi
  markers=[...body.matchAll(named)].filter(m=>!/(?:\b(?:to|in|from|under|see)|\banswer\s+to)\s*$/i.test(body.slice(Math.max(0,m.index-40),m.index))).map(m=>({number:Number(m[1]),index:m.index,end:m.index+m[0].length}))
 }
 if(!markers.length){
  markers=[...body.matchAll(/(?:^|\s)([1-9]\d{0,2})[.)]\s+(?=[A-Za-z(“"'])/g)]
   .filter(m=>!/(?:\bnos?\.|\b(?:rule|section|page|request|interrogatory))\s*$/i.test(body.slice(Math.max(0,m.index-35),m.index)))
   .map(m=>({number:Number(m[1]),index:m.index,end:m.index+m[0].length}))
 }
 if(!markers.length)return []
 let best=[]
 for(let i=0;i<markers.length;i++){
  if(markers[i].number!==1)continue
  const sequence=[markers[i]];let next=2
  for(let j=i+1;j<markers.length;j++){
   if(markers[j].number===next){sequence.push(markers[j]);next++}
   else if(markers[j].number>=next||markers[j].number===1)break
  }
  if(sequence.length>=best.length)best=sequence
 }
 const source=best.length?best:markers
 return source.map((m,i)=>({request_number:String(m.number),request_text:body.slice(m.end,source[i+1]?.index??body.length)
  .replace(/\b(?:ANSWER|RESPONSE)\s*:[\s\S]*$/,'')
  .replace(/(?:^|\n)\s*(?:Certificate\s+of\s+Service|Respectfully\s+submitted)[\s\S]*$/i,'')
  .replace(/\s+/g,' ').trim(),confidence:0.95})).filter(r=>r.request_text.length>2)
}
