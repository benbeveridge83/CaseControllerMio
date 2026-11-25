import React,{useState,useEffect,useCallback} from 'react'
import {PortalContent} from './ClientPortal.jsx'
import {staffPortalApi} from './staffPortalApi.js'

export default function StaffClientView({matterId,api=staffPortalApi}){
 const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const reload=useCallback(async()=>{
  const state=await api('staff_client_view',{matter_id:matterId})
  if(state.matter.id!==matterId)throw new Error('The client view returned a different matter. Open it again from the matter dashboard.')
  return state
 },[matterId,api])
 useEffect(()=>{let active=true;setSnapshot(null);setError('');reload().then(state=>{if(active)setSnapshot(state)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[reload])
 const clientApi=useCallback(async(action,body={})=>{
  const result=await api('staff_client_action',{...body,matter_id:matterId,client_action:action})
  if(action==='intake_submit')setNotice('Your test intake was submitted. You can review it in Mio’s intake submissions.')
  return result
 },[api,matterId])
 return <main className="portal-shell"><header className="portal-brand"><div><small>BEVERIDGE LAW FIRM</small><h1>Client portal</h1></div><button onClick={()=>window.close()}>Close client view</button></header>
  {error&&<p className="portal-error" role="alert">{error}</p>}
  {notice&&<p className="portal-notice" role="status">{notice}</p>}
  {!snapshot&&!error&&<p>Opening client view…</p>}
  {snapshot&&<><section className="portal-card"><h2>{snapshot.matter.name}</h2><p>{snapshot.matter.client_name} · {snapshot.viewer.email}</p><p className="portal-notice">{snapshot.viewer.can_submit_intake?'Test client view — try discovery answers, document uploads, and the sample intake form as the client.':'Staff client view — these are the client’s assigned forms, agreement and invoices. You can inspect discovery and open intake forms; discovery changes, submitting, signing and paying are disabled.'}</p><button onClick={async()=>{try{setSnapshot(await reload());setError('')}catch(e){setError(e.message)}}}>Refresh client view</button></section>
   <PortalContent key={matterId} snapshot={snapshot} api={clientApi} staffView allowTestSubmission={snapshot.viewer.can_submit_intake} onRefresh={async()=>setSnapshot(await reload())}/>
  </>}
  <footer>Questions? Contact office@beveridgelawfirm.com.</footer>
 </main>
}
