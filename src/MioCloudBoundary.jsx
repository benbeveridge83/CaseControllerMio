import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react'
import {supabase} from './supabaseClient'
import {observeMioAuth} from './mioAuthStartup.js'
import {mioCloudStore as store} from './mioCloudRuntime.js'
const panel={maxWidth:780,margin:'32px auto',padding:24,fontFamily:'system-ui',background:'#fff',color:'#172033',border:'1px solid #cbd5e1',borderRadius:12,lineHeight:1.6}
export default function MioCloudBoundary({children}) {
  useSyncExternalStore(store.subscribe,store.getVersion)
  const [boot,setBoot]=useState({loading:true,user:null,error:''}),[legacy,setLegacy]=useState(null),[busy,setBusy]=useState(false),[summary,setSummary]=useState(null),[details,setDetails]=useState(false)
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
  async function migrate(){setBusy(true);try{const result=await store.migrateLegacy();setSummary(result);if(result.remaining)throw new Error('An older Mio tab is still changing browser records. Close that tab, then retry.');setLegacy(null);setBoot(b=>({...b,error:''}))}catch(error){setBoot(b=>({...b,error:error.message||String(error)}))}finally{setBusy(false)}}
  async function preserve(){setBusy(true);try{if(await store.preservePending())window.location.reload()}catch(error){alert(error.message||String(error))}finally{setBusy(false)}}
  if(boot.loading)return <main style={panel}><h1>Loading Mio from Supabase</h1><p>Cloud data must load before edits are enabled.</p><p role="status">{status.loadProgress?.phase==='reading' ? 'Loaded '+status.loadProgress.loaded+' of '+status.loadProgress.total+' saved records.'+(status.loadProgress.reused ? ' Reused '+status.loadProgress.reused+' unchanged records from an open tab.' : ' Reading cloud records in parallel.') : status.loadProgress ? 'Reading the saved-record list from Supabase...' : 'Checking your sign-in session...'}</p><small>Cloud startup 304.1 - sign-in recovery / cloud-verified tab reuse</small><br /><button onClick={retryLoad}>Retry loading</button></main>
  if(legacy)return <main style={panel}><h1>Preserve older browser records</h1><p>Mio found {legacy.length} records ({(legacy.reduce((n,r)=>n+r.bytes,0)/1048576).toFixed(2)} MB) in this browser. Older versions did not label these records by account.</p><p><strong>Confirm these belong to {boot.user?.email}.</strong> Close other Mio tabs before continuing.</p><p>Every browser record will first be copied to Supabase and read back for verification. Missing cloud records will be imported. Existing cloud records will not be replaced; differing browser versions will be kept in recovery.</p><details><summary>Record names and sizes</summary>{legacy.map(r=><div key={r.key}>{r.key}: {(r.bytes/1024).toFixed(1)} KB</div>)}</details>{boot.error&&<p role="alert">{boot.error}</p>}<button disabled={busy} onClick={migrate}>{busy?'Preserving and verifying...':'These are my records: preserve in Supabase and continue'}</button>{' '}<button disabled={busy} onClick={()=>{setLegacy(null);setBoot(b=>({...b,error:''}))}}>Use cloud only; leave old browser copies untouched</button></main>
  if(boot.error)return <main style={panel}><h1>Cloud data could not be loaded</h1><p role="alert">{boot.error}</p><p>No browser records were deleted and no empty defaults replaced your cloud data.</p><button onClick={retryLoad}>Retry</button></main>
  const waiting=!!boot.user&&status.phase!=='ready'
  return <>{waiting&&<main style={panel}><h1>Preparing your Mio workspace</h1><p>{status.phase==='preserving'?'Preserving unsaved edits before reloading.':'Cloud state is loaded. Waiting for workspace initialization before enabling changes.'}</p><button disabled={busy||!!status.pending||!!status.pausedPending} onClick={()=>window.location.reload()}>Retry loading</button></main>}<div key={boot.user?.id||'login'} style={waiting?{display:'none'}:undefined}>{children}</div>{boot.user&&!waiting&&<aside aria-live="polite" style={{position:'fixed',bottom:12,right:12,zIndex:2147483000,maxWidth:600,background:status.pending?'#fff7ed':'#f0fdf4',color:'#172033',border:'1px solid #94a3b8',padding:10,borderRadius:8,fontFamily:'system-ui',fontSize:13}}><button onClick={()=>setDetails(v=>!v)}>{status.pending?`${status.pending} changes not saved to Supabase`:'Mio state: saved to Supabase'}</button>{status.pending>0&&<><p><strong>Keep this tab open.</strong> Unsaved edits exist only in memory, not browser disk storage.</p>{status.error&&<p role="alert">{status.error}</p>}<button onClick={()=>void store.flushAll()}>Retry save</button>{' '}<button disabled={busy} onClick={preserve}>Preserve pending edits in cloud recovery and reload</button></>}{details&&<div><p>This indicator covers Mio application state, not external-provider actions, separate uploads, or the legacy embedded discovery portal.</p><p>Browser-only exceptions are sign-in sessions, temporary redirects, expiring tab locks, and chosen-folder permission handles. A handle is not a copy of a document.</p>{summary&&<p>{summary.archived} older records were preserved. {summary.conflicts} differed from cloud records and remain in recovery, not active state.</p>}<p>Recovery copies: Supabase table <code>case_mio_browser_recovery</code>.</p></div>}</aside>}</>
}
