import React,{useState,useEffect,useCallback} from 'react'
import {PortalContent} from './ClientPortal.jsx'
import {staffPortalApi} from './staffPortalApi.js'

export default function StaffClientView({matterId,api=staffPortalApi}){
 const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[editDiscovery,setEditDiscovery]=useState(false),[pending,setPending]=useState(false)
 const reload=useCallback(async()=>{
  const state=await api('staff_client_view',{matter_id:matterId})
  if(state.matter.id!==matterId)throw new Error('The client view returned a different matter. Open it again from the matter dashboard.')
  return state
 },[matterId,api])
 useEffect(()=>{let active=true;setSnapshot(null);setError('');setEditDiscovery(false);setPending(false);reload().then(state=>{if(active)setSnapshot(state)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[reload])
 const clientApi=useCallback(async(action,body={})=>{
  const mutation=editDiscovery&&['discovery_save','discovery_upload_begin','discovery_upload_complete','discovery_upload_cancel','discovery_rename_file'].includes(action)
  const result=await api(mutation?'staff_client_discovery_action':'staff_client_action',{...body,matter_id:matterId,client_action:action,...(mutation?{edit_on_behalf:true}:{})})
  if(action==='intake_submit')setNotice('Your test intake was submitted. You can review it in Mio’s intake submissions.')
  return result
 },[api,matterId,editDiscovery])
 return <main className="portal-shell"><header className="portal-brand"><div><small>BEVERIDGE LAW FIRM</small><h1>Client portal</h1></div><button disabled={pending} onClick={()=>window.close()}>Close client view</button></header>
  {error&&<p className="portal-error" role="alert">{error}</p>}
  {notice&&<p className="portal-notice" role="status">{notice}</p>}
  {!snapshot&&!error&&<p>Opening client view…</p>}
  {snapshot&&<><section className="portal-card portal-client-context"><h2>{snapshot.matter.name}</h2><p>{snapshot.matter.client_name} · {snapshot.viewer.email}</p><p className="portal-notice" role="status">{editDiscovery?'Editing discovery on behalf of '+snapshot.matter.client_name+' · Your changes save to the client’s records. Signing, payments and intake remain read-only.':snapshot.viewer.can_submit_intake?'Test client view — you can try answers, uploads, and intake.':'Preview mode · Discovery controls are disabled here. Your client can answer and upload when signed into their own portal. To help them directly, enable discovery editing below.'}</p>{!snapshot.viewer.can_submit_intake&&<button className="portal-edit-discovery" disabled={pending} aria-pressed={editDiscovery} onClick={()=>setEditDiscovery(v=>!v)}>{editDiscovery?'Finish editing discovery':'Edit discovery on behalf of client'}</button>}{pending&&<p role="status">Finish saving or cancel pending uploads before leaving edit mode.</p>}<button disabled={pending} onClick={async()=>{try{setSnapshot(await reload());setError('')}catch(e){setError(e.message)}}}>Refresh client view</button></section>
   <PortalContent key={matterId} snapshot={snapshot} api={clientApi} draftOwner={snapshot.viewer.email} staffView allowDiscoveryEditing={editDiscovery} onDiscoveryPending={setPending} allowTestSubmission={snapshot.viewer.can_submit_intake} onRefresh={async()=>setSnapshot(await reload())}/>
  </>}
  <footer>Questions? Contact office@beveridgelawfirm.com.</footer>
 </main>
}
