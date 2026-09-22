import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react'
import {supabase} from './supabaseClient'
import {observeMioAuth} from './mioAuthStartup.js'
import {mioCloudStore as store} from './mioCloudRuntime.js'
import MioCloudStatus from './MioCloudStatus.jsx'
import MioStartupScreen from './MioStartupScreen.jsx'
const panel={maxWidth:780,margin:'32px auto',padding:24,fontFamily:'system-ui',background:'#fff',color:'#172033',border:'1px solid #cbd5e1',borderRadius:12,lineHeight:1.6}
export default function MioCloudBoundary({children}) {
  useSyncExternalStore(store.subscribe,store.getVersion)
  const [boot,setBoot]=useState({loading:true,user:null,error:''}),[legacy,setLegacy]=useState(null),[busy,setBusy]=useState(false)
  const latest=useRef(0),user=useRef(undefined),status=store.status()
  const [retryAttempt,setRetryAttempt]=useState(0)
  useEffect(()=>{
    let alive=true
    setBoot(current=>({...current,loading:true,error:''}))
    async function change(session){
      const id=session?.user?.id||null;if(user.current===id)return
      user.current=id;const ticket=++latest.current
      setBoot({loading:true,user:session?.user||null,error:''});setLegacy(null)
      try{await store.prepare(id);if(!alive||ticket!==latest.current)return
        const rows=id?store.legacyEntries():[]
        if(rows.length)setLegacy(rows.map(r=>({key:r.key,bytes:new Blob([r.raw_value]).size})))
        setBoot({loading:false,user:session?.user||null,error:''})
      }catch(error){if(alive&&ticket===latest.current)setBoot({loading:false,user:session?.user||null,error:error.message||String(error)})}
    }
    const stop=observeMioAuth(supabase.auth,{
      onSession:session=>{if(alive)void change(session)},
      onError:error=>{if(alive)setBoot({loading:false,user:null,error:error.message||String(error)})}
    })
    return()=>{alive=false;stop();user.current=undefined;latest.current++}
  },[retryAttempt])
  function retryLoad(){
    const current=store.status()
    // A timed-out auth client needs a fresh initialization, not another call
    // queued behind the same failed startup. Never reload over pending edits.
    if(!boot.user&&!current.pending&&!current.pausedPending){window.location.reload();return}
    setRetryAttempt(value=>value+1)
  }
  async function migrate(){setBusy(true);try{const result=await store.migrateLegacy();if(result.remaining)throw new Error('An older Mio tab is still changing browser records. Close that tab, then retry.');setLegacy(null);setBoot(b=>({...b,error:''}))}catch(error){setBoot(b=>({...b,error:error.message||String(error)}))}finally{setBusy(false)}}
  function reload(){if(!store.status().pending&&!store.status().pausedPending&&window.confirm('Save any open form first. Reload the latest saved data now?'))window.location.reload()}
  async function preserve(){if(!window.confirm('Save any open form first. Back up pending cloud edits to recovery, then reload the latest saved records? Recovery copies are not applied automatically.'))return;setBusy(true);try{if(await store.preservePending()){if(!store.status().pausedPending)window.location.reload()}}catch(error){alert(error.message||String(error))}finally{setBusy(false)}}
  async function useCloud(key){if(!window.confirm('Back up this pending edit and use the newer cloud version? After resolving pending items, choose Refresh saved data to update the workspace.'))return;setBusy(true);try{await store.useCloudVersion(key)}catch(error){alert(error.message||String(error))}finally{setBusy(false)}}
  if(boot.loading)return <MioStartupScreen heading="Preparing your workspace" message="Editing is paused until your saved records are verified." progress={status.loadProgress||{}} action={{label:'Retry loading',onClick:retryLoad}} />
  if(legacy)return <main style={panel}><h1>Preserve older browser records</h1><p>Mio found {legacy.length} records ({(legacy.reduce((n,r)=>n+r.bytes,0)/1048576).toFixed(2)} MB) in this browser. Older versions did not label these records by account.</p><p><strong>Confirm these belong to {boot.user?.email}.</strong> Close other Mio tabs before continuing.</p><p>Every browser record will first be copied to Supabase and read back for verification. Missing cloud records will be imported. Existing cloud records will not be replaced; differing browser versions will be kept in recovery.</p><details><summary>Record names and sizes</summary>{legacy.map(r=><div key={r.key}>{r.key}: {(r.bytes/1024).toFixed(1)} KB</div>)}</details>{boot.error&&<p role="alert">{boot.error}</p>}<button disabled={busy} onClick={migrate}>{busy?'Preserving and verifying...':'These are my records: preserve in Supabase and continue'}</button>{' '}<button disabled={busy} onClick={()=>{setLegacy(null);setBoot(b=>({...b,error:''}))}}>Use cloud only; leave old browser copies untouched</button></main>
  if(boot.error)return <main style={panel}><h1>Cloud data could not be loaded</h1><p role="alert">{boot.error}</p><p>No browser records were deleted and no empty defaults replaced your cloud data.</p><button onClick={retryLoad}>Retry</button></main>
  const waiting=!!boot.user&&status.phase!=='ready'
  return <>{waiting&&<MioStartupScreen heading="Preparing your workspace" message={status.phase==='preserving'?'Saving your unsaved edits before reloading.':'Applying your saved records before editing is enabled.'} action={{label:'Retry loading',disabled:busy||!!status.pending||!!status.pausedPending,onClick:()=>window.location.reload()}} />}<div data-mio-cloud-phase={status.phase} data-mio-cloud-pending={status.pending} key={boot.user?.id||'login'} style={waiting?{display:'none'}:undefined}>{children}</div>{boot.user&&!waiting&&<MioCloudStatus status={status} busy={busy} onRetry={()=>void store.flushAll()} onPreserve={preserve} onUseCloud={useCloud} onReload={reload}/>}</>
}
