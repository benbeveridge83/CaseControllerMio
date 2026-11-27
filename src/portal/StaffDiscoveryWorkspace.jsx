import React,{useState,useRef,useEffect} from 'react'
import {REGIMES} from '../discovery/model.js'
import {DRAFTING_STRATEGIES} from '../discovery/strategy.js'
import {mergeAiDrafts} from '../discovery/drafts.js'
import {runAnalysisQueue} from '../discovery/analysisQueue.js'
import RequestReview from '../discovery/RequestReview.jsx'
import AnalysisProgress from '../discovery/AnalysisProgress.jsx'
import {clientResponseText,readyFileIds,reviewProblems,analysisType} from './discoveryResponseReview.js'
import {openPortalDownload} from './portalDownloads.js'
import '../discoveryObjections.css'

const initialReview=(set,r)=>{
 const saved=set.reviews.find(v=>v.request_id===r.id),answer=set.answers.find(a=>a.request_id===r.id)
 return {version:saved?.version||0,client_version:saved?.client_version??answer?.version??0,review:saved?.review||{response_mode:answer?.attorney_response?'attorney':'pending',attorney_response:answer?.attorney_response||'',status:'draft',request_text:r.request_text,file_ids:readyFileIds(set,r.id),drafts:{},analysis:null,analysis_context:null}}
}
export default function StaffDiscoveryWorkspace({setId,title,matterId,api}){
 const [open,setOpen]=useState(false),[workspace,setWorkspace]=useState(null),[edits,setEdits]=useState({}),[dirty,setDirty]=useState({}),[expanded,setExpanded]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[regime,setRegime]=useState(''),[level,setLevel]=useState('2'),[strategy,setStrategy]=useState(2),[context,setContext]=useState(''),[job,setJob]=useState({phase:'idle',failures:{}})
 const apiRef=useRef(api);apiRef.current=api
 const editsRef=useRef(edits),dirtyRef=useRef(dirty),workspaceRef=useRef(workspace),busyRef=useRef(''),abort=useRef(null),backupKey=useRef(''),mounted=useRef(true)
 editsRef.current=edits;dirtyRef.current=dirty;workspaceRef.current=workspace
 const pending=Object.values(dirty).some(Boolean),locked=!!busy
 function update(values,flags){editsRef.current=values;dirtyRef.current=flags;setEdits(values);setDirty(flags);if(backupKey.current){try{if(Object.values(flags).some(Boolean))window.localStorage.setItem(backupKey.current,JSON.stringify({edits:values,dirty:flags}));else window.localStorage.removeItem(backupKey.current)}catch{setError('These review edits could not be backed up on this device. Keep this page open and save the review.')}}}
 function change(id,patch){const current=editsRef.current[id];update({...editsRef.current,[id]:{...current,review:{...current.review,...patch,status:patch.status||'draft'}}},{...dirtyRef.current,[id]:true})}
 function rebase(id,patch){const current=editsRef.current[id],set=workspaceRef.current.set,r=set.requests.find(r=>r.id===id);update({...editsRef.current,[id]:{...current,client_version:set.answers.find(a=>a.request_id===id)?.version||0,review:{...current.review,...patch,status:'draft',request_text:r.request_text,file_ids:readyFileIds(set,id)}}},{...dirtyRef.current,[id]:true})}
 async function reload({restore=false}={}){
  setError('');const data=await apiRef.current('staff_discovery_workspace',{matter_id:matterId,set_id:setId});if(!mounted.current)return
  if(!restore&&(Object.values(dirtyRef.current).some(Boolean)||busyRef.current)){setNotice('New saved responses are available. Your current edits were kept; use Compare latest saved responses.');return}
  setWorkspace(data);workspaceRef.current=data
  const rows=Object.fromEntries(data.set.requests.map(r=>[r.id,initialReview(data.set,r)]));backupKey.current='caseMioDiscoveryReview:'+data.context.staff_id+':'+matterId+':'+setId
  let saved=null;if(restore&&data.context.staff_id){try{saved=JSON.parse(window.localStorage.getItem(backupKey.current)||'null')}catch{setError('The saved review backup could not be read. Keep any other working tab open.')}}
  if(saved?.edits&&saved?.dirty){for(const r of data.set.requests)if(saved.dirty[r.id]&&saved.edits[r.id])rows[r.id]=saved.edits[r.id];const flags=Object.fromEntries(data.set.requests.filter(r=>saved.dirty[r.id]).map(r=>[r.id,true]));update(rows,flags);if(Object.keys(flags).length)setNotice('Recovered unsaved attorney review edits from this device. Compare any changed client answers before approval.')}
  else update(rows,{})
 }
 async function compareLatest(){if(busyRef.current)return;lock('compare');setError('');try{const data=await apiRef.current('staff_discovery_workspace',{matter_id:matterId,set_id:setId});setWorkspace(data);workspaceRef.current=data;setNotice('Latest client answers and saved attorney reviews are loaded for comparison. Your unsaved edits are preserved. Re-adopt the client answer or revise your response before approving it again.')}catch(e){setError(e.message)}finally{lock('')}}
 function keepMyReview(id){const latest=workspaceRef.current.set.reviews.find(v=>v.request_id===id);const current=editsRef.current[id],set=workspaceRef.current.set,r=set.requests.find(r=>r.id===id);update({...editsRef.current,[id]:{...current,version:latest?.version||0,client_version:set.answers.find(a=>a.request_id===id)?.version||0,review:{...current.review,status:'draft',request_text:r.request_text,file_ids:readyFileIds(set,id)}}},{...dirtyRef.current,[id]:true})}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort()}},[])
 useEffect(()=>{if(open)void reload({restore:!workspace}).catch(e=>setError(e.message))},[open])
 useEffect(()=>{if(!open||!workspace)return;const timer=setInterval(()=>{if(!busyRef.current&&!Object.values(dirtyRef.current).some(Boolean))void reload().catch(e=>{if(mounted.current)setError(e.message)})},15000);return()=>clearInterval(timer)},[open,!!workspace])
 useEffect(()=>{const stop=e=>{if(Object.values(dirtyRef.current).some(Boolean)||busyRef.current){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',stop);return()=>window.removeEventListener('beforeunload',stop)},[])
 function lock(value){busyRef.current=value;setBusy(value)}
 async function save(ids){
  if(busyRef.current)return;lock('save');setError('');setNotice('')
  try{for(const id of ids){if(!dirtyRef.current[id])continue;const value=editsRef.current[id],result=await apiRef.current('staff_discovery_review_save',{matter_id:matterId,set_id:setId,request_id:id,client_version:value.client_version,review_version:value.version,review:value.review});if(!result.review?.version)throw new Error('The review save could not be confirmed. Your edits are still here.')
   update({...editsRef.current,[id]:result.review},{...dirtyRef.current,[id]:false})
  }setNotice('Attorney review saved separately from the client’s original answers.')}catch(e){setError(e.message)}finally{lock('')}
 }
 async function analyze(ids){
  if(busyRef.current)return;if(workspaceRef.current.context.personal_error){setError(workspaceRef.current.context.personal_error);return}if(!regime){setError('Select the filing-date rules regime before running objection analysis.');return}
  const s=workspaceRef.current.set,requests=s.requests.filter(r=>ids.includes(r.id)).map(r=>({id:r.id,type:analysisType(s.discovery_type),number:r.request_number})),controller=new AbortController();abort.current=controller;lock('analyze');setError('');setNotice('')
  try{await runAnalysisQueue({requests,signal:controller.signal,onState:state=>{if(mounted.current)setJob(state)},analyze:(r,{retry,signal})=>apiRef.current('staff_discovery_analyze',{matter_id:matterId,set_id:setId,request_id:r.id,regime,level,strategy,context,...(retry?{retry}:{})},{signal}),onResult:result=>{
   const current=editsRef.current[result.id];if(result.client_version!==undefined&&(result.client_version!==current.client_version||result.request_text!==current.review.request_text)){setError('The client answer or request changed during analysis. Save any draft edits, then refresh and compare before rerunning.');return}const drafts=mergeAiDrafts({[result.id]:current.review.drafts||{}},[result])[result.id]||{}
   change(result.id,{drafts,analysis:result,analysis_context:{regime,level,strategy,context}})
  }});setNotice('Analysis results are drafts. Edit and select only the objections or privileges you want, then save your review.')}catch(e){if(e.name!=='AbortError')setError(e.message)}finally{abort.current=null;lock('')}
 }
 async function assemble(working){
  if(busyRef.current)return;if(Object.values(dirtyRef.current).some(Boolean)){setError('Save your attorney review changes before assembling a document.');return}
  lock('assemble');setError('');setNotice('')
  try{const result=await apiRef.current('staff_discovery_assemble',{matter_id:matterId,set_id:setId,working});if(!result.draft||!result.url)throw new Error('The assembled draft could not be confirmed.');setWorkspace(w=>({...w,exports:[result.draft,...w.exports]}));openPortalDownload(result);setNotice('Word draft created and saved in this discovery set. Complete your response form before service.')}catch(e){setError(e.message)}finally{lock('')}
 }
 const s=workspace?.set,approved=s?s.requests.filter(r=>!dirty[r.id]&&!reviewProblems(s,r,edits[r.id]).length).length:0
 const responseTemplates=(workspace?.context.templates||[]).filter(t=>/responses?|answers?/i.test(t.name)&&/discovery|interrogator|production|disclos|admission/i.test(t.name))
 return <section className="portal-discovery-workspace"><div className="portal-row"><div><strong>{title}</strong><small>Review client answers · analyze objections · assemble responses</small></div><button disabled={pending||locked} onClick={()=>setOpen(v=>!v)}>{open?'Close response review':'Review & assemble responses'}</button></div>
 {open&&<div className="disco-workspace portal-response-review">
  {error&&<p role="alert" className="portal-error">{error}</p>}{notice&&<p role="status" className="portal-notice">{notice}</p>}
  {!workspace?<p>Loading responses and attorney review…</p>:<>
   <header className="portal-review-header"><div><h3>Attorney response review</h3><p>{approved} of {s.requests.length} requests reviewed and saved. Client originals stay separate.</p></div><button disabled={locked} onClick={async()=>{try{openPortalDownload(await apiRef.current('staff_discovery_source_download',{matter_id:matterId,set_id:setId}))}catch(e){setError(e.message)}}}>Download original discovery</button><button disabled={pending||locked} onClick={()=>void reload().catch(e=>setError(e.message))}>Refresh client answers</button><button disabled={locked} onClick={()=>void compareLatest()}>Compare latest saved responses</button></header>
   <p className="portal-notice">This creates an editable Word review draft using Mio’s existing exporter. {responseTemplates.length?'Response-related templates found: '+responseTemplates.map(t=>t.name).join(', ')+'.':'No interrogatory or production response template was found.'} Your custom caption, signature, service certificate and any verification can be supplied in your preferred response form. <a href="/#drafting" target="_blank" rel="noreferrer">Open Drafting Studio</a></p>
   {workspace.context.personal_error&&<p className="portal-error">{workspace.context.personal_error}</p>}<div className="portal-review-controls"><label>Rules regime<select aria-label="Response rules regime" value={regime} disabled={locked} onChange={e=>setRegime(e.target.value)}><option value="">Choose the applicable filing-date regime</option>{REGIMES.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label><label>Discovery control level<select value={level} disabled={locked} onChange={e=>setLevel(e.target.value)}>{['unknown','1','2','3'].map(v=><option key={v} value={v}>{v==='unknown'?'Not specified':v}</option>)}</select></label><label>Objection drafting threshold<select value={strategy} disabled={locked} onChange={e=>setStrategy(Number(e.target.value))}>{DRAFTING_STRATEGIES.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label><label>Relevant facts and court-ordered limits<textarea value={context} maxLength={12000} disabled={locked} onChange={e=>setContext(e.target.value)} rows="3"/></label><small>Uses the existing Discovery Objections engine and your confirmed saved rules/examples ({workspace.context.personal.rules.length} saved rules). AI suggestions are never selected automatically.</small></div>
   <div className="portal-actions"><button disabled={locked} onClick={()=>void analyze(s.requests.map(r=>r.id))}>Analyze objections for all requests</button><button disabled={locked||!pending} onClick={()=>void save(Object.keys(dirtyRef.current))}>Save all review changes</button><button disabled={locked||pending||approved!==s.requests.length} onClick={()=>void assemble(false)}>Assemble reviewed Word responses</button><button disabled={locked||pending} onClick={()=>void assemble(true)}>Download working draft with placeholders</button>{busy==='analyze'&&<button onClick={()=>abort.current?.abort()}>Stop analysis</button>}</div>
   {busy==='analyze'||job.phase!=='idle'?<AnalysisProgress job={job} total={job.total||s.requests.length} completed={job.analyzed||0} disabled={locked} onAnalyze={()=>void analyze(s.requests.filter(r=>!editsRef.current[r.id]?.review.analysis).map(r=>r.id))} onStop={()=>abort.current?.abort()}/>:null}
   {s.requests.map(r=>{
    const value=edits[r.id],review=value.review,answer=s.answers.find(a=>a.request_id===r.id),files=s.files.filter(f=>f.request_id===r.id),problems=reviewProblems(s,r,value),expandedRow=expanded===r.id
    return <article className="portal-attorney-request" key={r.id}><button className="portal-attorney-request-toggle" aria-expanded={expandedRow} onClick={()=>setExpanded(expandedRow?'':r.id)}><strong>Request {r.request_number}</strong><span>{dirty[r.id]?'Unsaved review':!problems.length?'Reviewed and saved':problems.includes('client answer changed')?'Client answer changed — review again':problems.includes('client uploads changed')?'New client upload — review again':'Needs attorney review'}</span></button>{expandedRow&&<>
     {((s.reviews.find(v=>v.request_id===r.id)?.version||0)!==value.version)&&<aside className="portal-error"><strong>Another saved attorney review is available.</strong><p>{s.reviews.find(v=>v.request_id===r.id)?.review.attorney_response||'(The saved review adopts the client answer or has no attorney response.)'}</p>{Object.entries(s.reviews.find(v=>v.request_id===r.id)?.review.drafts||{}).filter(([,d])=>d.selected).map(([kind,d])=><p key={kind}>{kind}: {d.text}</p>)}<button disabled={locked} onClick={()=>keepMyReview(r.id)}>Keep my changes for re-review</button></aside>}
     <div className="portal-original-answer"><h4>Client’s original answer</h4><p className="discovery-original">{clientResponseText(answer)||'(No answer yet)'}</p>{answer?.client_comments&&<p><strong>Client question/comment (not included in Word):</strong> {answer.client_comments}</p>}{answer?.needs_help&&<p className="portal-error">Client requested help.</p>}{files.map(f=><div className="portal-row" key={f.id}><span>{f.filename} · {f.status==='ready'?'Uploaded':'Upload not confirmed'}</span>{f.status==='ready'&&<button onClick={async()=>{try{openPortalDownload(await apiRef.current('staff_discovery_file_download',{matter_id:matterId,set_id:setId,request_id:r.id,file_id:f.id}))}catch(e){setError(e.message)}}}>Download client file</button>}</div>)}
      <div className="portal-actions"><button disabled={locked||!clientResponseText(answer)} onClick={()=>rebase(r.id,{response_mode:'client',attorney_response:''})}>Adopt client answer</button><button disabled={locked} onClick={()=>rebase(r.id,{response_mode:'attorney',attorney_response:review.attorney_response||clientResponseText(answer)})}>Write or modify attorney response</button></div>
      {review.response_mode==='client'&&<p className="portal-notice">Client answer chosen. Approve and save below to include it.</p>}{review.response_mode==='attorney'&&<label>Attorney response for assembly<textarea aria-label={'Attorney response for request '+r.request_number} value={review.attorney_response} maxLength={50000} disabled={locked} rows="5" onInput={e=>change(r.id,{attorney_response:e.target.value})}/></label>}
     </div>
     <button disabled={locked} onClick={()=>void analyze([r.id])}>Analyze objections for request {r.request_number}</button>
     <RequestReview request={{id:r.id,type:analysisType(s.discovery_type),number:r.request_number,request:r.request_text}} result={review.analysis} drafts={review.drafts} analysisError={job.failures?.[r.id]} disabled={locked} profile={workspace.context.personal} privilegePlacement="after_request" onChange={(kind,draft)=>{const next={...review.drafts};if(draft)next[kind]=draft;else delete next[kind];change(r.id,{drafts:next})}}/>
     {review.analysis_context&&<small>Analysis context: {REGIMES.find(v=>v.id===review.analysis_context.regime)?.label||review.analysis_context.regime}. Rerun analysis after changing the applicable facts or regime.</small>}
     <label className="discovery-check"><input type="checkbox" disabled={locked||review.response_mode==='pending'} checked={review.status==='approved'} onChange={e=>change(r.id,{status:e.target.checked?'approved':'draft'})}/>I reviewed this response and the selected objections; include them in assembly.</label>
     <button disabled={locked||!dirty[r.id]} onClick={()=>void save([r.id])}>Save review for request {r.request_number}</button>
    </>}</article>
   })}
   {workspace.exports.length>0&&<section className="portal-review-drafts"><h3>Saved response drafts</h3>{workspace.exports.map(d=><div className="portal-row" key={d.id}><span>{d.filename}<small>{new Date(d.created_at).toLocaleString()} · {d.kind}{d.outdated?' · Newer client answers, requests or review are available':' · Saved snapshot'}</small></span><button onClick={async()=>{try{openPortalDownload(await apiRef.current('staff_discovery_draft_download',{matter_id:matterId,set_id:setId,draft_id:d.id}))}catch(e){setError(e.message)}}}>Download saved draft</button></div>)}</section>}
   {pending&&<p role="status" className="portal-review-pending">Unsaved attorney review changes. Save them before assembling or leaving this page.</p>}
  </>}
 </div>}
 </section>
}
