import React,{useState} from 'react'
import {buildReextractionPlan} from './reextraction.js'
export default function DiscoveryReextract({set,request,onExtract,onApply}){
 const [open,setOpen]=useState(false),[source,setSource]=useState(set.document_id?'document':'saved'),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState(null),[notice,setNotice]=useState('')
 const label=request?'Rerun extraction for this request':'Rerun extraction for this set'
 async function extract(){setBusy(true);setError('');setPreview(null);try{const result=await onExtract(set.id,{requestId:request?.id||'',source,text});const plan=buildReextractionPlan(set,result.items,{requestId:request?.id||'',protectedIds:result.protectedIds});setPreview({...result,plan})}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <div style={{margin:'8px 0',textAlign:'left'}}>
 <button type="button" onClick={()=>{setOpen(v=>!v);setNotice('')}} aria-expanded={open}>{label}</button>
 {notice&&<p role="status">{notice}</p>}
 {open&&<section aria-label={label+' options'} style={{padding:12,marginTop:8,border:'1px solid #93b6d5',borderRadius:8,background:'#f6faff',color:'#173a58'}}>
  <p>{request?'Re-extract the matching numbered request from the original document, or split the text in this block into individual requests. Only this block is replaced.':'Re-extract the saved set without uploading the document again or creating a duplicate set.'}</p>
  <label>Extraction source <select disabled={busy} value={source} onChange={e=>{setSource(e.target.value);setPreview(null)}}>
   {set.document_id&&<option value="document">Original uploaded document{request?' — match this request number':''}</option>}
   <option value="saved">{request?'Text in this request block (split numbered items)':'Saved request text'}</option><option value="paste">Paste numbered source text</option>
  </select></label>
  {source==='paste'&&<label>Source text<textarea rows="6" value={text} disabled={busy} onChange={e=>{setText(e.target.value);setPreview(null)}} style={{width:'100%',boxSizing:'border-box'}}/></label>}
  <p>Extraction creates a preview first. Existing client answers, attorney notes, and files are preserved. Applying changes to a released set updates the client portal automatically.</p>
  <button type="button" disabled={busy} onClick={()=>void extract()}>{busy?'Extracting…':'Extract and preview'}</button>{' '}<button type="button" disabled={busy} onClick={()=>{setOpen(false);setPreview(null);setError('')}}>Cancel</button>
  {error&&<p role="alert" style={{color:'#9b2c1b'}}>{error}</p>}
  {preview&&<div><h4>Preview: {preview.plan.extracted_count} extracted request(s)</h4>
   <p>{preview.plan.reused_count} existing request record(s) matched. {preview.plan.retained_count} prior request(s) with work retained for review. A copy of the previous requests is kept in the set’s extraction history.</p>
   {preview.portalCheckUnavailable&&<p>Portal responses could not be checked. Previous items are being retained for review.</p>}
   <div style={{maxHeight:320,overflow:'auto',padding:8,background:'white',border:'1px solid #d3dfeb'}}>{preview.items.map((r,i)=><p key={i}><strong>Request {r.request_number}.</strong> {r.request_text}</p>)}</div>
   <button type="button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await onApply(set.id,preview.plan);setPreview(null);setOpen(false);setNotice('Extraction applied. Check Mio’s save status for cloud synchronization.')}catch(e){setError(e.message)}finally{setBusy(false)}}}>Apply extraction to {request?'this request':'this set'}</button>
  </div>}
 </section>}
 </div>
}
