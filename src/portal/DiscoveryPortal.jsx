import React,{useState,useEffect,useRef,useCallback} from 'react'
export const RFP_OPTIONS=['No items have been identified - after a diligent search - that are responsive to the request.','The requested items are being served on the requesting party in this response','The requested items were attached to a prior response',"The documents exist but I'm not producing them - I'll specify in the comment why",'I am not sure / need attorney help']
const label=t=>({production:'Production requests',interrogatories:'Interrogatories',disclosures:'Disclosures',admissions:'Admissions'}[t]||t)
const empty={client_answer:'',client_comments:'',rfp_status:'',needs_help:false,version:0}
const size=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.ceil(n/1024)+' KB'
export function DiscoveryRequest({set,request,api,matterId,readOnly=false,onSaved,onDirty,onFile}){
 const initial=set.answers.find(a=>a.request_id===request.id)||empty
 const [value,setValue]=useState(initial),[state,setState]=useState('Saved'),[error,setError]=useState(''),[files,setFiles]=useState(()=>set.files.filter(f=>f.request_id===request.id)),[uploading,setUploading]=useState(''),[comparison,setComparison]=useState(null)
 const current=useRef(initial),version=useRef(initial.version||0),dirty=useRef(false),running=useRef(false),timer=useRef(null),mounted=useRef(true),apiRef=useRef(api);apiRef.current=api
 const notify=useRef({onSaved,onDirty});notify.current={onSaved,onDirty}
 const flush=useCallback(async()=>{
  if(running.current||!dirty.current||readOnly)return
  running.current=true;clearTimeout(timer.current)
  try{
   while(dirty.current){
    const draft=current.current;dirty.current=false;if(mounted.current){setState('Saving…');setError('')}
    const saved=await apiRef.current('discovery_save',{matter_id:matterId,set_id:set.id,request_id:request.id,version:version.current,answer:draft})
    version.current=saved.answer.version;notify.current.onSaved?.(request.id,saved.answer)
    if(mounted.current)setState(dirty.current?'Saving…':'Saved')
   }
   notify.current.onDirty?.(request.id,false)
  }catch(e){dirty.current=true;if(mounted.current){setError(e.message);setState('Not saved')}}finally{running.current=false}
 },[matterId,set.id,request.id,readOnly])
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(timer.current);void flush()}},[flush])
 useEffect(()=>{const stop=e=>{if(dirty.current||running.current||uploading){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',stop);return()=>window.removeEventListener('beforeunload',stop)},[uploading])
 function change(patch){const next={...current.current,...patch};current.current=next;dirty.current=true;setValue(next);setState('Waiting to save…');notify.current.onDirty?.(request.id,true);clearTimeout(timer.current);timer.current=setTimeout(flush,650)}
 async function upload(selected){
  if(readOnly)return;setError('');notify.current.onDirty?.(request.id,true)
  try{for(const file of Array.from(selected||[])){
   setUploading('Uploading '+file.name+'…')
   const intent=await apiRef.current('discovery_upload_begin',{matter_id:matterId,set_id:set.id,request_id:request.id,filename:file.name,size:file.size})
   const form=new FormData();form.append('cacheControl','3600');form.append('',new Blob([file],{type:intent.content_type}),file.name)
   const response=await fetch(intent.url,{method:'PUT',body:form});if(!response.ok)throw new Error('Upload failed for '+file.name+'. Please try again.')
   const result=await apiRef.current('discovery_upload_complete',{matter_id:matterId,set_id:set.id,request_id:request.id,file_id:intent.file_id})
   setFiles(rows=>[...rows,result.file])
   onFile?.(result.file)
  }}catch(e){setError(e.message)}finally{setUploading('');if(!dirty.current&&!running.current)notify.current.onDirty?.(request.id,false)}
 }
 return <div className="discovery-answer">
  {request.attorney_comments&&<aside className="discovery-guidance"><strong>Your attorney’s instructions</strong><p>{request.attorney_comments}</p></aside>}
  {!request.client_must_respond&&<p className="portal-notice">No response required, but you may add information below.</p>}
  {set.discovery_type==='production'&&<><label>Which best describes your response?<select disabled={readOnly} value={value.rfp_status||''} onChange={e=>change({rfp_status:e.target.value})}><option value="">Choose a response</option>{RFP_OPTIONS.map(v=><option key={v}>{v}</option>)}</select></label>
   <div className="discovery-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!uploading)void upload(e.dataTransfer.files)}}><strong>Documents for request {request.request_number}</strong><p>Drop files here, or choose files from your device.</p><label className="discovery-file-label">Choose files<input type="file" multiple disabled={readOnly||!!uploading} accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip" onChange={e=>{void upload(e.target.files);e.target.value=''}}/></label><small>PDFs, photos, Word, Excel, text or ZIP · up to 25 MB per file · multiple files allowed</small>{uploading&&<p role="status">{uploading}</p>}</div>
   {files.map(f=><div className="portal-row" key={f.id}><span>✓ {f.filename}<small>{size(f.size_bytes)} · Uploaded for this request</small></span><button type="button" onClick={async()=>{try{const result=await apiRef.current('discovery_download',{matter_id:matterId,set_id:set.id,request_id:request.id,file_id:f.id});window.open(result.url,'_blank','noopener,noreferrer')}catch(e){setError(e.message)}}}>Download</button></div>)}
  </>}
  <label>{set.discovery_type==='production'?'Your explanation / where these documents can be found':'Your answer'}<textarea rows="5" disabled={readOnly} value={value.client_answer||''} onChange={e=>change({client_answer:e.target.value})} placeholder={set.discovery_type==='admissions'?'Admit, deny, or unsure — explain in your own words.':'Type your answer in your own words. If you do not know, tell us what you need help with.'}/></label>
  <label>Comments or questions for your attorney<textarea rows="2" disabled={readOnly} value={value.client_comments||''} onChange={e=>change({client_comments:e.target.value})}/></label>
  <label className="discovery-check"><input type="checkbox" disabled={readOnly} checked={!!value.needs_help} onChange={e=>change({needs_help:e.target.checked})}/>I need help with this request</label>
  <p className="discovery-save" role="status">{readOnly?'Staff preview — answers are read-only':state==='Saved'?'✓ Saved · Your attorney can see your saved answers.':state}</p>
  {error&&<div role="alert" className="portal-error"><p>{error}</p><button onClick={()=>void flush()}>Retry save</button><button onClick={async()=>{try{const result=await apiRef.current('discovery_list',{matter_id:matterId});setComparison(result.sets.find(s=>s.id===set.id)?.answers.find(a=>a.request_id===request.id)||empty)}catch(e){setError(e.message)}}}>Compare saved answer</button>{comparison&&<><p>Currently saved: {comparison.client_answer||'(No answer)'}<br/>{comparison.client_comments}</p><button onClick={()=>{version.current=comparison.version||0;setComparison(null);void flush()}}>Keep my answer and retry</button></>}</div>}
 </div>
}
export default function DiscoveryPortal({matterId,api,readOnly=false,onPending}){
 const [sets,setSets]=useState([]),[selected,setSelected]=useState(''),[open,setOpen]=useState(''),[page,setPage]=useState(1),[loading,setLoading]=useState(true),[error,setError]=useState(''),[filter,setFilter]=useState(''),[dirty,setDirty]=useState({})
 const reload=useCallback(async()=>{const result=await api('discovery_list',{matter_id:matterId});setSets(result.sets||[]);setSelected(v=>result.sets.some(s=>s.id===v)?v:result.sets[0]?.id||'');return result},[matterId,api])
 useEffect(()=>{let active=true;setLoading(true);reload().catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[reload])
 const active=sets.find(s=>s.id===selected),requests=active?.requests||[],filtered=requests.filter(r=>[r.request_number,r.request_text].join(' ').toLowerCase().includes(filter.toLowerCase())),pages=Math.max(1,Math.ceil(filtered.length/10)),pending=Object.values(dirty).some(Boolean)
 const pendingRef=useRef(false);pendingRef.current=pending
 useEffect(()=>{onPending?.(pending)},[pending,onPending])
 useEffect(()=>{const timer=setInterval(()=>{if(!pendingRef.current)void reload().catch(e=>setError(e.message))},15000);return()=>clearInterval(timer)},[reload])
 const saved=(id,answer)=>setSets(rows=>rows.map(s=>s.id!==selected?s:{...s,answers:[...s.answers.filter(a=>a.request_id!==id),answer]}))
 const changeDirty=(id,flag)=>setDirty(d=>({...d,[id]:flag}))
 const uploaded=file=>setSets(rows=>rows.map(s=>s.id===selected?{...s,files:[...s.files,file]}:s))
 const answered=r=>active.answers.some(a=>a.request_id===r.id&&(a.client_answer?.trim()||a.rfp_status))||active.files.some(f=>f.request_id===r.id)
 return <section className="discovery-portal"><div className="portal-card discovery-intro"><small>WORK WITH YOUR ATTORNEY</small><h2>Respond to discovery</h2><p>Answer the requests below and attach any requested documents. Your work saves automatically and your attorney can review it as you go. There is no submit button.</p><button disabled={pending} onClick={()=>reload().catch(e=>setError(e.message))}>Refresh requests</button>{pending&&<small>Keep this page open while your changes save.</small>}</div>
 {error&&<p role="alert" className="portal-error">{error}</p>}{loading?<p>Loading discovery…</p>:!sets.length?<div className="portal-card">Your attorney has not assigned discovery requests yet.</div>:<>
 <nav className="discovery-set-tabs" aria-label="Discovery sets">{sets.map(s=><button aria-pressed={selected===s.id} disabled={pending&&selected!==s.id} key={s.id} onClick={()=>{setSelected(s.id);setOpen('');setPage(1);setFilter('')}}><strong>{label(s.discovery_type)}</strong><small>{s.requests.length} requests</small></button>)}</nav>
 {active&&<><section className="portal-card"><h2>{active.title}</h2>{active.client_response_due&&<p>Client response target: {active.client_response_due}</p>}<div className="discovery-guidance"><strong>Instructions from your attorney</strong><p>{active.client_instructions||'Please answer in your own words. Ask us if you need help.'}</p></div><p>{requests.filter(r=>r.client_must_respond&&answered(r)).length} of {requests.filter(r=>r.client_must_respond).length} requested responses started · You can return and keep working.</p><label>Find a request<input disabled={pending} value={filter} onChange={e=>{setFilter(e.target.value);setPage(1)}} placeholder="Search by number or words in the request"/></label></section>
 {filtered.slice((page-1)*10,page*10).map((r,i)=><article className="portal-card discovery-request" key={r.id}><button className="discovery-request-heading" disabled={pending} aria-expanded={open===r.id||(open===''&&i===0)} onClick={()=>setOpen(open===r.id||(open===''&&i===0)?'closed':r.id)}><span className="discovery-number">{r.request_number}</span><span><strong>Request {r.request_number}</strong><span className="discovery-request-text">{r.request_text}</span><small>{!r.client_must_respond?'Optional response':answered(r)?'Response started':'Needs your response'} · {open===r.id||(open===''&&i===0)?'Collapse':'Open request'}</small></span></button>{(open===r.id||(open===''&&i===0))&&<DiscoveryRequest set={active} request={r} matterId={matterId} api={api} readOnly={readOnly} onSaved={saved} onDirty={changeDirty} onFile={uploaded}/>}</article>)}
 <div className="portal-actions"><button disabled={page<=1||pending} onClick={()=>{setPage(p=>p-1);setOpen('')}}>Previous</button><span>Page {page} of {pages}</span><button disabled={page>=pages||pending} onClick={()=>{setPage(p=>p+1);setOpen('')}}>Next</button></div></>}
 </>}
 </section>
}
