// Cross-tab messages are invalidation hints, never trusted case data. Supabase
// verifies versions before a clean tab refreshes. Other devices use focus/poll.
export function createMioCloudSync({store,win=window,Channel=globalThis.BroadcastChannel,channelName='mio-cloud-saved-v320',debounceMs=1000}){
  let dirtyDraft=false,running=false,closed=false,reloading=false,timer
  const channel=typeof Channel==='function'?new Channel(channelName):null
  channel?.unref?.()
  const clean=()=>{
    const s=store.status(),doc=win.document
    return !closed&&!reloading&&s.phase==='ready'&&!s.pending&&!s.pausedPending&&!dirtyDraft&&!doc.hidden&&
      !doc.querySelector('[role="dialog"],dialog[open]')&&
      !doc.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]')
  }
  async function check(){
    if(closed||running||reloading||store.status().phase!=='ready'||win.document.hidden)return
    const owner=store.status().owner;running=true
    try{
      const changed=await store.checkRemoteChanges()
      if(changed&&owner===store.status().owner&&clean()){reloading=true;win.location.reload()}
    }catch{/* Offline/read failures never cause a reload or change local state. */}
    finally{running=false}
  }
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void check(),debounceMs);timer.unref?.()}
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
