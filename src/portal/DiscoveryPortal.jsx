import {openPortalDownload} from './portalDownloads.js'
import React,{useState,useEffect,useRef,useCallback} from 'react'
import {descriptiveFilename,descriptiveFolder,fileStem,fileExtension} from './discoveryFileNames.js'
import {createDiscoveryAutosave,browserDraftStorage,browserDraftWriter} from './discoveryAutosave.js'
export const RFP_OPTIONS=['No items have been identified - after a diligent search - that are responsive to the request.','The requested items are being served on the requesting party in this response','The requested items were attached to a prior response',"The documents exist but I'm not producing them - I'll specify in the comment why",'I am not sure / need attorney help']
const label=t=>({production:'Production requests',interrogatories:'Interrogatories',disclosures:'Disclosures',admissions:'Admissions'}[t]||t)
const empty={client_answer:'',client_comments:'',rfp_status:'',needs_help:false,version:0}
const size=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.ceil(n/1024)+' KB'
export function DiscoveryRequest({set,request,api,matterId,readOnly=false,draftOwner='',signInUrl='/?client-portal=1&portal-tab=discovery',onSaved,onDirty,onFile,onFileRemoved,onSaveState}){
 const initial=set.answers.find(a=>a.request_id===request.id)||empty
 const [view,setView]=useState(null),[files,setFiles]=useState(()=>set.files.filter(f=>f.request_id===request.id&&f.status!=='uploading')),[comparison,setComparison]=useState(null),[uploadError,setUploadError]=useState(''),[rename,setRename]=useState(null),[renaming,setRenaming]=useState(false)
 const [uploads,setUploads]=useState(()=>set.files.filter(f=>f.request_id===request.id&&f.status==='uploading').map(f=>({id:f.id,filename:f.filename,file:null,intent:{file_id:f.id},uploaded:true,phase:'failed',error:'This upload has not been confirmed. Finish uploading or choose the original file again.'})))
 const apiRef=useRef(api);apiRef.current=api
 const notify=useRef({onSaved,onDirty,onFile,onFileRemoved,onSaveState});notify.current={onSaved,onDirty,onFile,onFileRemoved,onSaveState}
 const renameRef=useRef(rename);renameRef.current=rename
 const uploadsRef=useRef(uploads),uploadRunning=useRef(false),controllerRef=useRef(null)
 function publish(snapshot=controllerRef.current?.getSnapshot()){
  if(!snapshot)return
  const queuePending=!readOnly&&(uploadsRef.current.length>0||!!renameRef.current)
  notify.current.onDirty?.(request.id,!readOnly&&(snapshot.pending||queuePending))
  notify.current.onSaveState?.(request.id,{status:snapshot.status,pending:!readOnly&&(snapshot.pending||queuePending),error:snapshot.error,uploadError:uploadsRef.current.some(f=>f.phase==='failed'),confirmed:snapshot.status==='saved'})
 }
 if(!controllerRef.current)controllerRef.current=createDiscoveryAutosave({initial,scope:{owner:draftOwner,matterId,setId:set.id,requestId:request.id},storage:browserDraftStorage(),writer:browserDraftWriter(),readOnly,save:({answer,version})=>apiRef.current('discovery_save',{matter_id:matterId,set_id:set.id,request_id:request.id,version,answer})})
 const controller=controllerRef.current
 controller.setCallbacks({onChange:snapshot=>{setView(snapshot);publish(snapshot)},onSaved:answer=>notify.current.onSaved?.(request.id,answer),onPending:()=>publish()})
 const state=view||controller.getSnapshot(),value=state.value,error=state.error||uploadError
 useEffect(()=>{controller.start();const online=()=>{void controller.online();const failed=uploadsRef.current.filter(f=>f.phase==='failed'&&![401,403,409].includes(f.errorStatus));if(failed.length)void processUploads(failed)};const background=()=>{if(document.visibilityState==='hidden')void controller.flush()};const stop=e=>{if(controller.getSnapshot().pending||uploadsRef.current.length||renameRef.current){e.preventDefault();e.returnValue=''}};window.addEventListener('online',online);window.addEventListener('beforeunload',stop);document.addEventListener('visibilitychange',background);return()=>{window.removeEventListener('online',online);window.removeEventListener('beforeunload',stop);document.removeEventListener('visibilitychange',background);controller.dispose()}},[controller])
 useEffect(()=>{if(initial.version)controller.acceptServer(initial)},[controller,initial.version,initial.client_answer,initial.client_comments,initial.rfp_status,initial.needs_help])
 const readyFiles=JSON.stringify(set.files.filter(f=>f.request_id===request.id&&f.status!=='uploading'))
 useEffect(()=>setFiles(JSON.parse(readyFiles)),[readyFiles])
 const change=patch=>controller.update(patch)
 function updateUploads(next){uploadsRef.current=next;setUploads([...next]);publish()}
 async function processUploads(entries){
  if(readOnly||uploadRunning.current)return
  uploadRunning.current=true;setUploadError('')
  try{for(const entry of entries){
   entry.phase='uploading';entry.error='';updateUploads(uploadsRef.current)
   try{
    if(!entry.intent)entry.intent=await apiRef.current('discovery_upload_begin',{matter_id:matterId,set_id:set.id,request_id:request.id,filename:entry.filename,original_filename:entry.file.name,folder_name:entry.folder_name||'',relative_path:entry.relative_path||'',size:entry.file.size})
    if(!entry.uploaded){
     if(!entry.file)throw new Error('Choose the original file again to finish this upload.')
     const form=new FormData();form.append('cacheControl','3600');form.append('',new Blob([entry.file],{type:entry.intent.content_type}),entry.filename)
     const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),120000)
     try{const response=await fetch(entry.intent.url,{method:'PUT',body:form,signal:abort.signal});if(!response.ok&&response.status!==409)throw Object.assign(new Error('The file upload did not finish. Retry when connected.'),{status:response.status});entry.uploaded=true}finally{clearTimeout(timeout)}
    }
    const result=await apiRef.current('discovery_upload_complete',{matter_id:matterId,set_id:set.id,request_id:request.id,file_id:entry.intent.file_id})
    if(result.file?.status!=='ready')throw new Error('The server has not confirmed this upload.')
    setFiles(rows=>[...rows.filter(f=>f.id!==result.file.id),result.file]);notify.current.onFile?.(result.file);updateUploads(uploadsRef.current.filter(item=>item.id!==entry.id))
   }catch(e){entry.phase='failed';entry.errorStatus=Number(e.status)||0;entry.error=e.name==='AbortError'?'The upload timed out. Retry when connected.':e.message;updateUploads(uploadsRef.current)}
  }}finally{uploadRunning.current=false;publish()}
 }
 function upload(selected){
  if(readOnly||uploadRunning.current)return
  const batch=crypto.randomUUID(),entries=Array.from(selected||[]).map(file=>{const path=String(file.webkitRelativePath||'').split('/');return {id:crypto.randomUUID(),batch,filename:file.name,name:fileStem(file.name),folder_name:path.length>1?path[0]:'',relative_path:path.length>1?path.slice(1).join('/'):'',file,phase:'naming',uploaded:false}})
  if(!entries.length)return
  updateUploads([...uploadsRef.current,...entries]);setUploadError('')
 }
 function editUpload(entry,patch){Object.assign(entry,patch);updateUploads(uploadsRef.current)}
 function startNamedUploads(){
  if(readOnly||uploadRunning.current)return
  const entries=uploadsRef.current.filter(f=>f.phase==='naming')
  try{for(const entry of entries){entry.filename=descriptiveFilename(entry.name,entry.file.name);if(entry.relative_path)entry.folder_name=descriptiveFolder(entry.folder_name)}
   for(const entry of entries)entry.phase='waiting'
   updateUploads(uploadsRef.current);void processUploads(entries)
  }catch(e){setUploadError(e.message)}
 }
 function editRename(value){renameRef.current=value;setRename(value);publish()}
 async function saveRename(){
  if(readOnly||renaming||!renameRef.current)return
  const draft=renameRef.current;setRenaming(true);setUploadError('')
  try{const filename=descriptiveFilename(draft.name,draft.file.original_filename||draft.file.filename),result=await apiRef.current('discovery_rename_file',{matter_id:matterId,set_id:set.id,request_id:request.id,file_id:draft.file.id,filename,expected_filename:draft.file.filename})
   if(result.file?.status!=='ready'||result.file.filename!==filename)throw new Error('The new file name could not be confirmed. Please retry.')
   setFiles(rows=>rows.map(f=>f.id===result.file.id?result.file:f));notify.current.onFile?.(result.file);editRename(null)
  }catch(e){setUploadError(e.message)}finally{setRenaming(false)}
 }
 async function cancelUpload(entry){try{if(entry.intent?.file_id)await apiRef.current('discovery_upload_cancel',{matter_id:matterId,set_id:set.id,request_id:request.id,file_id:entry.intent.file_id});notify.current.onFileRemoved?.(entry.intent?.file_id);updateUploads(uploadsRef.current.filter(item=>item.id!==entry.id));setUploadError('')}catch(e){setUploadError(e.message)}}
 function downloadDraft(){const url=URL.createObjectURL(new Blob([controller.downloadDraft()],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='discovery-request-'+request.request_number+'-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
 return <div className="discovery-answer">
  {request.attorney_comments&&<aside className="discovery-guidance"><strong>Your attorney’s instructions</strong><p>{request.attorney_comments}</p></aside>}
  {!request.client_must_respond&&<p className="portal-notice">No response required, but you may add information below.</p>}
  {set.discovery_type==='production'&&<><label>Which best describes your response?<select disabled={readOnly} value={value.rfp_status||''} onChange={e=>change({rfp_status:e.target.value})}><option value="">Choose a response</option>{RFP_OPTIONS.map(v=><option key={v}>{v}</option>)}</select></label>
   <div className="discovery-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!uploadRunning.current)upload(e.dataTransfer.files)}}><strong>Documents for request {request.request_number}</strong><p>Choose files or a folder. Next, review and name each document before uploading.</p><label className="discovery-file-label">Choose files<input type="file" multiple disabled={readOnly||uploads.some(f=>f.phase==='uploading')} accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip" onChange={e=>{upload(e.target.files);e.target.value=''}}/></label><label className="discovery-file-label">Choose a folder<input type="file" multiple webkitdirectory="" directory="" disabled={readOnly||uploads.some(f=>f.phase==='uploading')} onChange={e=>{upload(e.target.files);e.target.value=''}}/></label><small>Folder selection is available on supported devices. Otherwise choose multiple files or a ZIP.</small><small>PDFs, photos, Word, Excel, text or ZIP · up to 25 MB per file · multiple files allowed</small></div>
   {uploads.some(f=>f.phase==='naming')&&<section className="discovery-upload-review" aria-label="Name documents before uploading"><h3>Name your documents</h3><p>Give each file a name your attorney will recognize. For example: <strong>Tax return – 2025.pdf</strong> or <strong>Bank statements – January 2026.pdf</strong>. File types stay the same.</p>
    {Array.from(new Set(uploads.filter(f=>f.phase==='naming'&&f.relative_path).map(f=>f.batch))).map(batch=>{const first=uploads.find(f=>f.batch===batch);return <label key={batch}>Folder name<input maxLength={180} value={first.folder_name} placeholder="Tax returns – 2023 to 2025" onInput={e=>{for(const entry of uploadsRef.current.filter(f=>f.batch===batch))entry.folder_name=e.target.value;updateUploads(uploadsRef.current)}}/></label>})}
    {uploads.filter(f=>f.phase==='naming').map(entry=><div className="discovery-name-row" key={entry.id}><small>Original: {entry.relative_path||entry.file.name}</small><label>Document name<input value={entry.name} maxLength={175} placeholder="Tax return – 2025" onInput={e=>editUpload(entry,{name:e.target.value})}/><small>File type: {fileExtension(entry.file.name)||'(unsupported)'} · {size(entry.file.size)}</small></label><button type="button" onClick={()=>void cancelUpload(entry)}>Remove from upload</button></div>)}
    <button type="button" onClick={startNamedUploads}>Upload named documents</button><p>These files are not uploaded until you click Upload named documents.</p>
   </section>}
   {uploads.filter(entry=>entry.phase!=='naming').map(entry=><div key={entry.id} className={entry.phase==='failed'?'portal-error':'portal-notice'} role={entry.phase==='failed'?'alert':'status'}><strong>{entry.filename}</strong><p>{entry.phase==='uploading'?'Uploading — not yet saved online.':entry.error||'Waiting to upload.'}</p>{entry.phase==='failed'&&<>{[401,403].includes(entry.errorStatus)&&<p><a href={signInUrl}>Sign in again to finish this upload</a></p>}<button disabled={readOnly} onClick={()=>void processUploads([entry])}>{entry.file?'Retry upload':'Finish upload'}</button><button disabled={readOnly} onClick={()=>void cancelUpload(entry)}>Cancel pending upload</button></>}</div>)}
   {files.map(f=><div className="portal-row discovery-uploaded-file" key={f.id}><span>✓ {f.filename}{f.folder_name&&<small>Folder: {f.folder_name}{f.relative_path?.includes('/')?' / '+f.relative_path.split('/').slice(0,-1).join('/'):''}</small>}<small>{size(f.size_bytes)} · Uploaded for this request</small>{f.original_filename&&f.original_filename!==f.filename&&<small>Original: {f.original_filename}</small>}</span><div className="portal-actions"><button type="button" disabled={readOnly||!!rename} onClick={()=>{setUploadError('');editRename({file:f,name:fileStem(f.filename)})}}>Rename</button><button type="button" onClick={async()=>{try{const result=await apiRef.current('discovery_download',{matter_id:matterId,set_id:set.id,request_id:request.id,file_id:f.id});window.open(result.url,'_blank','noopener,noreferrer')}catch(e){setUploadError(e.message)}}}>Download</button></div>{rename?.file.id===f.id&&<div className="discovery-rename"><label>Document name<input disabled={renaming} value={rename.name} maxLength={175} placeholder="Tax return – 2025" onInput={e=>editRename({...rename,name:e.target.value})}/><small>The {fileExtension(f.original_filename||f.filename)} file type stays the same.</small></label><button type="button" disabled={renaming} onClick={()=>void saveRename()}>{renaming?'Saving name…':'Save name'}</button><button type="button" disabled={renaming} onClick={()=>{editRename(null);setUploadError('')}}>Cancel rename</button></div>}</div>)}
  </>}
  <label>{set.discovery_type==='production'?'Your explanation / where these documents can be found':'Your answer'}<textarea rows="5" onBlur={()=>void controller.flush()} disabled={readOnly} value={value.client_answer||''} onChange={e=>change({client_answer:e.target.value})} placeholder={set.discovery_type==='admissions'?'Admit, deny, or unsure — explain in your own words.':'Type your answer in your own words. If you do not know, tell us what you need help with.'}/></label>
  <label>Comments or questions for your attorney<textarea rows="2" onBlur={()=>void controller.flush()} disabled={readOnly} value={value.client_comments||''} onChange={e=>change({client_comments:e.target.value})}/></label>
  <label className="discovery-check"><input type="checkbox" disabled={readOnly} checked={!!value.needs_help} onChange={e=>change({needs_help:e.target.checked})}/>I need help with this request</label>
  <p className={'discovery-save '+(['error','auth','conflict'].includes(state.status)?'is-unsaved':'')} role="status">{readOnly?'Staff preview — answers are read-only':state.status==='saved'?'✓ Saved online · Your attorney can see your saved answers.':state.status==='empty'?'No answer entered yet. Your changes will save automatically.':state.status==='pending'?'Changes pending · Saving automatically…':state.status==='saving'?'Saving online…':state.status==='conflict'?'Not saved online · Compare with the newer saved answer.':state.status==='auth'?'Not saved online · Please sign in again.':'Not saved online · Retrying when connected.'}</p>
  {state.recovered&&<p className="portal-notice">Recovered your unsaved answer from this device.</p>}
  {state.pending&&state.backupAvailable&&<small>Unsaved text is backed up on this device until the server confirms saving.</small>}
  {state.pending&&state.backupWarning&&<p className="portal-error">{state.backupWarning}</p>}
  {error&&<div role="alert" className="portal-error"><p>{error}</p>{state.pending&&<><button onClick={()=>void controller.retry()}>Retry save</button><button onClick={downloadDraft}>Download my unsaved draft</button><button onClick={async()=>{try{const result=await apiRef.current('discovery_list',{matter_id:matterId});setComparison(result.sets.find(s=>s.id===set.id)?.answers.find(a=>a.request_id===request.id)||empty)}catch(e){setUploadError(e.message)}}}>Compare saved answer</button>{state.status==='auth'&&<p><a href={signInUrl}>Sign in again, then return to this request</a></p>}</>}{comparison&&<div><strong>Currently saved online</strong><p>{comparison.client_answer||'(No written answer)'}</p><p>{comparison.client_comments}</p><p>{comparison.rfp_status}</p><button onClick={()=>{const version=comparison.version||0;setComparison(null);void controller.keepMine(version)}}>Keep my answer and retry</button></div>}</div>}

 </div>
}
export default function DiscoveryPortal({matterId,api,readOnly=false,onPending,draftOwner='',signInUrl}){
 const [sets,setSets]=useState([]),[selected,setSelected]=useState(''),[open,setOpen]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[filter,setFilter]=useState(''),[dirty,setDirty]=useState({}),[saveStates,setSaveStates]=useState({})
 const reload=useCallback(async()=>{const result=await api('discovery_list',{matter_id:matterId});setSets(result.sets||[]);setSelected(v=>result.sets.some(s=>s.id===v)?v:result.sets[0]?.id||'');return result},[matterId,api])
 useEffect(()=>{let active=true;setLoading(true);reload().catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[reload])
 const active=sets.find(s=>s.id===selected),requests=active?.requests||[],pending=Object.values(dirty).some(Boolean)
 const required=r=>r.client_must_respond!==false
 const ordered=[...requests].sort((a,b)=>String(a.request_number).localeCompare(String(b.request_number),undefined,{numeric:true}))
 const filtered=ordered.filter(r=>[r.request_number,r.request_text].join(' ').toLowerCase().includes(filter.toLowerCase()))
 const requiredRequests=ordered.filter(required),optionalRequests=ordered.filter(r=>!required(r))
 const defaultOpen=requiredRequests.find(r=>filtered.some(item=>item.id===r.id))?.id||'closed'
 const expandedId=open===''?defaultOpen:open
 const pendingRef=useRef(false);pendingRef.current=pending
 useEffect(()=>{onPending?.(pending)},[pending,onPending])
 useEffect(()=>{const timer=setInterval(()=>{if(!pendingRef.current)void reload().catch(e=>setError(e.message))},15000);return()=>clearInterval(timer)},[reload])
 const saved=(id,answer)=>setSets(rows=>rows.map(s=>s.id!==selected?s:{...s,answers:[...s.answers.filter(a=>a.request_id!==id),answer]}))
 const changeDirty=(id,flag)=>setDirty(d=>d[id]===flag?d:{...d,[id]:flag})
 const reportSave=(id,state)=>setSaveStates(rows=>JSON.stringify(rows[id])===JSON.stringify(state)?rows:{...rows,[id]:state})
 const removedFile=id=>setSets(rows=>rows.map(s=>s.id===selected?{...s,files:s.files.filter(f=>f.id!==id)}:s))
 const uploaded=file=>setSets(rows=>rows.map(s=>s.id===selected?{...s,files:[...s.files.filter(f=>f.id!==file.id),file]}:s))
 const answered=r=>active.answers.some(a=>a.request_id===r.id&&(a.client_answer?.trim()||a.rfp_status))||active.files.some(f=>f.request_id===r.id&&f.status==='ready')
 function card(r){
  const needsAnswer=required(r),expanded=expandedId===r.id,started=answered(r)
  return <article className={'portal-card discovery-request '+(needsAnswer?'discovery-required':'discovery-optional')+(expanded?' is-open':'')} key={r.id} data-request-number={r.request_number}>
   <button className="discovery-request-heading" disabled={pending} aria-expanded={expanded} onClick={()=>setOpen(expanded?'closed':r.id)}>
    <span className="discovery-number">{r.request_number}</span><span className="discovery-request-main">
     <span className="discovery-card-top"><strong>Request {r.request_number}</strong><span className={'discovery-requirement '+(needsAnswer?'is-required':'is-optional')}>{needsAnswer?'Answer required':'No answer required'}</span></span>
     <span className="discovery-request-text">{r.request_text}</span>
     <span className="discovery-card-action">{expanded?'− Close request':needsAnswer?(started?'Continue your answer →':'Open and answer →'):'View / add information →'}{active.files.some(f=>f.request_id===r.id&&f.status==='uploading')?<span className="discovery-upload-pending">Upload not confirmed</span>:started&&<span className="discovery-started">Response started</span>}</span>
    </span>
   </button>
   {expanded&&<DiscoveryRequest key={draftOwner+'|'+r.id+'|'+readOnly} draftOwner={draftOwner} signInUrl={signInUrl} onSaveState={reportSave} onFileRemoved={removedFile} set={active} request={r} matterId={matterId} api={api} readOnly={readOnly} onSaved={saved} onDirty={changeDirty} onFile={uploaded}/>}
  </article>
 }
 const unsaved=Object.values(saveStates).some(s=>['error','auth','conflict'].includes(s.status)||s.uploadError)||active?.files.some(f=>f.status==='uploading')
 const confirmed=Object.values(saveStates).some(s=>s.confirmed)||active?.answers.some(a=>a.version>0)||active?.files.some(f=>f.status==='ready')
 return <section className="discovery-portal">
  <header className="discovery-intro"><div><small>YOUR CASE · DISCOVERY</small><h2>Respond to discovery</h2><p>Start with the requests marked <strong>Answer required</strong>. Your answers and uploads save automatically for your attorney to review.</p></div><button disabled={pending} onClick={()=>reload().catch(e=>setError(e.message))}>Refresh requests</button>{pending&&<p className="discovery-pending" role="status">Saving your work — keep this page open.</p>}</header>
  {error&&<p role="alert" className="portal-error">{error}</p>}
  {loading?<p>Loading discovery…</p>:!sets.length?<div className="portal-card">Your attorney has not assigned discovery requests yet.</div>:<>
   <nav className="discovery-set-tabs" aria-label="Discovery sets">{sets.map(s=><button aria-pressed={selected===s.id} disabled={pending&&selected!==s.id} key={s.id} onClick={()=>{setSelected(s.id);setOpen('');setFilter('');setSaveStates({});setDirty({})}}><strong>{label(s.discovery_type)}</strong><small>{s.requests.length} requests · {s.requests.filter(required).length} answer required</small></button>)}</nav>
   {active&&<>
    <section className="portal-card discovery-set-overview">{active.source_document&&<aside className="discovery-source-document"><div><strong>Original discovery document</strong><small>{active.source_document.filename}</small></div><button type="button" onClick={async()=>{try{openPortalDownload(await api('discovery_source_download',{matter_id:matterId,set_id:active.id}))}catch(e){setError(e.message)}}}>Download original requests</button></aside>}<div className="discovery-set-heading"><div><small>ASSIGNED REQUESTS</small><h2>{active.title}</h2></div>{active.client_response_due&&<span className="discovery-due">Your response target<strong>{new Date(active.client_response_due+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</strong></span>}</div>
     <div className="discovery-summary"><div className="summary-required"><strong>{requiredRequests.length}</strong><span>answer required</span></div><div className="summary-optional"><strong>{optionalRequests.length}</strong><span>no answer required</span></div><div><strong>{requiredRequests.filter(answered).length} / {requiredRequests.length}</strong><span>required responses started</span></div></div>
     <div className="discovery-guidance"><strong>Instructions from your attorney</strong><p>{active.client_instructions||'Please answer in your own words. Ask us if you need help.'}</p></div>
     <div className="discovery-search"><label>Find a request<input disabled={pending} value={filter} onChange={e=>{setFilter(e.target.value);setOpen('')}} placeholder="Search by number or words in the request"/></label><p role="status">{filter?'Showing '+filtered.length+' of '+requests.length+' requests':'Showing all '+requests.length+' requests'}<small>Original request numbers are preserved. No requests are hidden on another page.</small></p></div>
    </section>
    <div className={'discovery-columns'+(!optionalRequests.length?' has-only-required':!requiredRequests.length?' has-only-optional':'')}>
     <section className="discovery-column required-column" aria-label="Answer required requests"><header className="discovery-column-heading"><div><h3>Answer required</h3><p>Please respond to these requests.</p></div><span>{requiredRequests.length}</span></header><div className="discovery-column-content">{filtered.filter(required).length?filtered.filter(required).map(card):<p className="discovery-empty">{filter?'No matching requests in this column.':'No answers are required for this set. You can still open a request and add information.'}</p>}</div></section>
     <section className="discovery-column optional-column" aria-label="No answer required requests"><header className="discovery-column-heading"><div><h3>No answer required</h3><p>You may still open a request and add information.</p></div><span>{optionalRequests.length}</span></header><div className="discovery-column-content">{filtered.filter(r=>!required(r)).length?filtered.filter(r=>!required(r)).map(card):<p className="discovery-empty">{filter?'No matching requests in this column.':'All requests in this set require your response.'}</p>}</div></section>
    </div>
    <p className="discovery-list-end">{filtered.length} of {requests.length} requests shown · Numbered in original order within each column.</p>
   </>}
  </>}
  {!readOnly&&<aside className={'discovery-save-bar '+(unsaved?'has-problem':pending?'is-saving':'is-saved')} role="status"><strong>{unsaved?'Some work is not saved online':pending?'Saving your work online…':confirmed?'✓ Saved online':'Autosave is on'}</strong><span>{unsaved?'Keep this page open. Review the warning under the request and retry.':pending?'Wait for Saved online before closing.':confirmed?'Your saved answers are available when you sign in on another device.':'Answers save automatically. Files are saved only after the upload is confirmed.'}</span></aside>}
 </section>
}
