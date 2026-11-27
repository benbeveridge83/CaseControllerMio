import {collectAnnotations} from '../discovery/drafts.js'
export const analysisType=type=>({production:'rfp',interrogatories:'roggs',disclosures:'rfd',admissions:'rfa'}[type])
export const responseTitle=type=>({production:'Responses to Requests for Production',interrogatories:'Answers to Interrogatories',disclosures:'Responses to Requests for Disclosure',admissions:'Responses to Requests for Admission'}[type]||'Discovery responses')
export const clientResponseText=answer=>[answer?.rfp_status,answer?.client_answer].filter(value=>value?.trim()).join('\n\n')
export const readyFileIds=(set,id)=>set.files.filter(f=>f.request_id===id&&f.status==='ready').map(f=>f.id).sort()
const text=(value,max=50000)=>{if(typeof value!=='string'||value.length>max)throw new Error('Response or objection text is missing or too long.');return value}
export function normalizeResponseReview(value={}){
 if(!['pending','client','attorney'].includes(value.response_mode)||!['draft','approved'].includes(value.status))throw new Error('Choose a response source and review status.')
 const drafts={}
 for(const kind of ['objection','privilege'])if(value.drafts?.[kind]){const d=value.drafts[kind];drafts[kind]={text:text(d.text,20000),selected:d.selected===true,origin:d.origin==='ai'?'ai':'manual',strength:Number.isInteger(d.strength)&&d.strength>=0&&d.strength<=100?d.strength:null,strengthSource:d.strengthSource==='ai'?'ai':'manual',strengthReason:text(d.strengthReason||'',3000)}}
 const result={response_mode:value.response_mode,attorney_response:text(value.attorney_response||''),status:value.status,request_text:text(value.request_text||'',50000),file_ids:Array.isArray(value.file_ids)?value.file_ids.filter(id=>typeof id==='string').slice(0,500).sort():[],drafts,analysis:value.analysis&&typeof value.analysis==='object'?value.analysis:null,analysis_context:value.analysis_context&&typeof value.analysis_context==='object'?value.analysis_context:null}
 if(JSON.stringify(result).length>120000)throw new Error('This review is too large. Shorten the notes and analysis.')
 return result
}
export function reviewProblems(set,request,entry){
 const answer=set.answers.find(a=>a.request_id===request.id),v=entry?.review,problems=[]
 if(!v||v.status!=='approved')problems.push('not approved')
 if(v&&v.request_text!==request.request_text)problems.push('request changed')
 if(entry&&(entry.client_version||0)!==(answer?.version||0))problems.push('client answer changed')
 if(set.files.some(f=>f.request_id===request.id&&f.status==='uploading'))problems.push('client upload not confirmed')
 if(v&&JSON.stringify([...(v.file_ids||[])].sort())!==JSON.stringify(readyFileIds(set,request.id)))problems.push('client uploads changed')
 if(v){
  if(v.response_mode==='pending')problems.push('response source not chosen')
  const response=v.response_mode==='client'?clientResponseText(answer):v.attorney_response||''
  if(!response.trim()&&!['objection','privilege'].some(kind=>v.drafts?.[kind]?.selected&&v.drafts[kind].text?.trim()))problems.push('no response or selected objection')
  if(/\[[^\]]+\]/.test(response))problems.push('response has unfinished placeholders')
  try{collectAnnotations([{id:request.id}],{[request.id]:v.drafts})}catch(e){problems.push(e.message)}
 }
 return problems
}
export function responseAssembly(set,{working=false}={}){
 const pending=[],drafts={}
 const requests=set.requests.map(request=>{
  const entry=(set.reviews||[]).find(v=>v.request_id===request.id),problems=reviewProblems(set,request,entry),answer=set.answers.find(a=>a.request_id===request.id)
  if(problems.length)pending.push({number:request.request_number,problems})
  else drafts[request.id]=entry.review.drafts||{}
  return {id:request.id,type:analysisType(set.discovery_type),number:request.request_number,request:request.request_text,response:problems.length?'[ATTORNEY REVIEW NEEDED — '+problems.join('; ')+']':entry.review.response_mode==='client'?clientResponseText(answer):entry.review.attorney_response}
 })
 if(!requests.length)throw new Error('This set has no requests to assemble.')
 if(!working&&pending.length)throw new Error('Review and save approval for request(s) '+pending.map(r=>r.number).join(', ')+'. A working draft is available with clearly marked placeholders.')
 return {requests,...collectAnnotations(requests,drafts),pending}
}
