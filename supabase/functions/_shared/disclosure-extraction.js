// Shared by the browser and Edge Function: PDF pages are not discovery requests.
export function extractDisclosureRequests(rawText = '') {
 const text=String(rawText||'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ')
  .replace(/\bPage\s+\d+\s+of\s+\d+\b/gi,' ')
  .replace(/Electronically\s+Served\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?/gi,' ')
  .replace(/[\t ]+/g,' ').trim()
 if(!text)return []
 // Prefer the actual list heading over captions, legal instructions and certificates.
 const primary=[...text.matchAll(/\bmatters\s+to\s+be\s+disclosed\b\s*:?/gi)]
 const headings=primary.length?primary:[...text.matchAll(/\bdisclose\s+the\s+following\b\s*:?/gi)]
 let body=headings.length?text.slice(headings.at(-1).index+headings.at(-1)[0].length):text
 const tail=/(?:^|\n)\s*(?:certificate\s+of\s+service|respectfully\s+submitted|verification)\b/i.exec(body)
 // A certificate preceding the list must not hide the list when the heading is absent.
 const firstNumber=/(?:^|\s)1[.)]\s+(?=[A-Za-z(“"'])/.exec(body)
 if(tail&&firstNumber&&tail.index>firstNumber.index)body=body.slice(0,tail.index)
 const matches=[...body.matchAll(/(?:^|\s)([1-9]\d{0,2})[.)]\s+(?=[A-Za-z(“"'])/g)].map(m=>({number:Number(m[1]),index:m.index,end:m.index+m[0].length}))
 // Consecutive numbering prevents citations (194a.2), dates, and numbered subparts
 // from becoming top-level requests; lowercase words are equally valid list starts.
 let best=[]
 for(let i=0;i<matches.length;i++){
  if(matches[i].number!==1)continue
  const sequence=[matches[i]];let next=2
  for(let j=i+1;j<matches.length;j++){
   if(matches[j].number===next){sequence.push(matches[j]);next++}
   else if(matches[j].number>next)break
   else if(matches[j].number===1)break
  }
  if(sequence.length>=best.length)best=sequence
 }
 if(!best.length)return []
 return best.map((m,i)=>({request_number:String(m.number),request_text:body.slice(m.end,best[i+1]?.index??body.length).replace(/\b(?:RESPONSE|ANSWER)\s*:[\s\S]*$/i,'').replace(/\s+/g,' ').trim(),confidence:0.95})).filter(r=>r.request_text.length>2)
}
