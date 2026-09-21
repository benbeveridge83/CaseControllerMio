// Cross-tab messages are invalidation hints, never trusted case data. Supabase
// verifies versions before a clean tab refreshes. Other devices use focus/poll.
import {isDisplayPreferenceKey} from './mioCloudStore.js'
export function createMioCloudSync({store,win=window,Channel=globalThis.BroadcastChannel,channelName='mio-cloud-saved-v320',debounceMs=1000,quietAfterReadyMs=8000,minAutoReloadGapMs=120000,reloadGuardKey='mioAutoReloadAtV321'}){
  let dirtyDraft=false,running=false,closed=false,reloading=false,timer,readyAt=0
  const channel=typeof Channel==='function'?new Channel(channelName):null
  channel?.unref?.()
  const clean=()=>{
    const s=store.status(),doc=win.document
    return !closed&&!reloading&&s.phase==='ready'&&!s.pending&&!s.pausedPending&&!dirtyDraft&&!doc.hidden&&
      !doc.querySelector('[role="dialog"],dialog[open]')&&
      !doc.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]')
  }
  // A tab that just opened already read the newest records, and repeated refreshes
  // are never worth losing a window to. The guard lives in sessionStorage so a
  // reload chain cannot loop every few seconds.
  const readGuard=()=>{try{return Number(win.sessionStorage?.getItem(reloadGuardKey)||0)||0}catch{return 0}}
  const writeGuard=at=>{try{win.sessionStorage?.setItem(reloadGuardKey,String(at))}catch{}}
  const readySince=()=>{
    if(store.status().phase!=='ready'){readyAt=0;return 0}
    if(!readyAt)readyAt=Date.now()
    return readyAt
  }
  const needsReload=status=>{
    if(status.reloadRequired)return true
    const keys=Array.isArray(status.changedKeys)?status.changedKeys:null
    // Only case records need a reload. A filter, expanded row, or column width
    // changed in another tab rebases on write and never reloads this window.
    return keys?keys.some(key=>!isDisplayPreferenceKey(key)):true
  }
  async function check(){
    if(closed||running||reloading||store.status().phase!=='ready'||win.document.hidden)return
    const owner=store.status().owner;running=true
    try{
      const changed=await store.checkRemoteChanges()
      if(!changed||owner!==store.status().owner||!clean()||!needsReload(store.status()))return
      // Measure readiness before "now": the first check that discovers readiness must
      // not treat its own timestamp as a future change.
      const readyAtMs=readySince()
      const now=Date.now(),notBefore=Math.max(readyAtMs+Math.max(0,quietAfterReadyMs),readGuard()+Math.max(0,minAutoReloadGapMs))
      if(notBefore>now){scheduleAfter(notBefore-now);return}
      reloading=true;writeGuard(now);win.location.reload()
    }catch{/* Offline/read failures never cause a reload or change local state. */}
    finally{running=false}
  }
  const scheduleAfter=delayMs=>{clearTimeout(timer);timer=setTimeout(()=>void check(),Math.max(0,Number(delayMs)||0));timer.unref?.()}
  const schedule=()=>scheduleAfter(debounceMs)
  const edit=()=>{dirtyDraft=true}
  win.addEventListener('input',edit,true);win.addEventListener('change',edit,true)
  win.addEventListener('focus',schedule);win.addEventListener('online',schedule)
  win.document.addEventListener('visibilitychange',schedule)
  if(channel)channel.onmessage=({data})=>{
    if(data?.type==='saved'&&data.owner===store.status().owner)schedule()
  }
  const unsubscribe=store.subscribeSaved(({owner})=>{try{channel?.postMessage({type:'saved',owner})}catch{}})
  const poll=setInterval(schedule,60000);poll.unref?.()
  return{check,close(){
    closed=true;clearTimeout(timer);clearInterval(poll);unsubscribe();channel?.close()
    win.removeEventListener('input',edit,true);win.removeEventListener('change',edit,true)
    win.removeEventListener('focus',schedule);win.removeEventListener('online',schedule)
    win.document.removeEventListener('visibilitychange',schedule)
  }}
}
