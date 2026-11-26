const normalized=text=>String(text||'').toLowerCase().replace(/\s+/g,' ').trim()
export function requestHasWork(request,protectedIds=[]){
 return protectedIds.includes(request.id)||request.client_must_respond===false||request.needs_help||
 ['client_answer','client_comments','attorney_comments','attorney_response','rfp_status','rfp_upload_notes'].some(k=>String(request[k]||'').trim())||
 ['uploaded_files','attachments'].some(k=>Array.isArray(request[k])&&request[k].length>0)||
 !!request.phase_responses||!!request.responses_by_phase
}
export function buildReextractionPlan(set,items,{requestId='',protectedIds=[],idFactory=()=>crypto.randomUUID()}={}){
 if(!items.length)throw new Error('No individual requests were extracted. Nothing was changed.')
 const existing=set.requests||[],target=requestId?existing.find(r=>r.id===requestId):null
 if(requestId&&!target)throw new Error('This request is no longer in the set.')
 const old=target?[target]:existing,used=new Set();let reused=0
 const replacements=items.map((item,index)=>{
  const match=target&&items.length===1?target:old.find(r=>!used.has(r.id)&&normalized(r.request_text)===normalized(item.request_text))||(!target&&items.length===old.length?old.find(r=>!used.has(r.id)&&String(r.request_number)===String(item.request_number)):null)
  if(match){used.add(match.id);reused++;return {...match,request_number:String(item.request_number||index+1),request_text:item.request_text,extraction_review_note:undefined}}
  return {id:idFactory(),request_number:String(item.request_number||index+1),request_text:item.request_text,request_type:set.discovery_type,client_must_respond:true,attorney_comments:'',client_answer:'',client_comments:'',rfp_status:'',rfp_upload_notes:'',uploaded_files:[],needs_help:false,status:'Needs client answer'}
 })
 const retained=old.filter(r=>!used.has(r.id)&&requestHasWork(r,protectedIds)).map(r=>({...r,extraction_review_note:'Prior request retained because it has answers, notes, files, or a response setting. Review it against the newly extracted requests.'}))
 const requests=target?existing.flatMap(r=>r.id===target.id?[...replacements,...retained]:[r]):[...replacements,...retained]
 return {set_id:set.id,request_id:requestId,baseline:JSON.stringify(existing),requests,extracted_count:items.length,reused_count:reused,retained_count:retained.length,original_count:old.length}
}
export function applyReextractionPlan(set,plan,now=new Date().toISOString()){
 if(set.id!==plan.set_id||JSON.stringify(set.requests||[])!==plan.baseline)throw new Error('The requests changed while this preview was open. Rerun extraction to review the latest version.')
 return {...set,requests:plan.requests,updated_at:now,extraction_history:[...(set.extraction_history||[]),{at:now,request_id:plan.request_id||null,previous_requests:set.requests||[],extracted_count:plan.extracted_count}]}
}
