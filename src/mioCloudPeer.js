// Same-origin, same-account RAM handoff. No case data is persisted to browser disk.
// An offer is not permission to hydrate: mioCloudRead verifies every version in Supabase.
export function createCloudPeer({getSnapshot, channelName='case-mio-cloud-handoff-v301', Channel=globalThis.BroadcastChannel}) {
  if (typeof Channel !== 'function') return {request:async()=>[],close(){}}
  const channel=new Channel(channelName), id=globalThis.crypto.randomUUID(), pending=new Map()
  channel.unref?.()
  const send=message=>{try{channel.postMessage({...message,sender:id,protocol:301})}catch{}}
  channel.onmessage=({data:m})=>{
    if(!m || m.protocol!==301 || m.sender===id || typeof m.owner!=='string')return
    const s=getSnapshot()
    if(!s?.owner || s.owner!==m.owner)return
    if(m.type==='request' && s.ready)send({type:'offer',owner:s.owner,requestId:m.requestId,to:m.sender})
    else if(m.type==='take' && m.to===id && s.ready){
      const rows=s.rows()
      send({type:'snapshot',owner:s.owner,requestId:m.requestId,to:m.sender,rows})
    }else if(m.to===id){
      const p=pending.get(m.requestId)
      if(!p || p.owner!==m.owner)return
      if(m.type==='offer' && !p.peer){p.peer=m.sender;send({type:'take',owner:p.owner,requestId:m.requestId,to:m.sender})}
      else if(m.type==='snapshot' && p.peer===m.sender && Array.isArray(m.rows))p.finish(m.rows)
    }
  }
  return {
    request(owner,{signal,timeoutMs=1200}={}){
      if(signal?.aborted || getSnapshot()?.owner!==owner)return Promise.resolve([])
      return new Promise(resolve=>{
        const requestId=globalThis.crypto.randomUUID()
        let timer
        const abort=()=>finish([])
        const finish=rows=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(requestId);resolve(getSnapshot()?.owner===owner?rows:[])}
        pending.set(requestId,{owner,finish,peer:''})
        signal?.addEventListener('abort',abort,{once:true})
        timer=setTimeout(abort,timeoutMs)
        send({type:'request',owner,requestId})
      })
    },
    close(){for(const p of pending.values())p.finish([]);channel.close()}
  }
}
