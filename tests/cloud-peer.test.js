import test from 'node:test'
import assert from 'node:assert/strict'
import {createCloudPeer} from '../src/mioCloudPeer.js'
test('same-account RAM handoff, different-account isolation, cancellation and fallback',async()=>{
 const channelName='mio-test-'+crypto.randomUUID()
 const owner={id:'A'},rows=[{key:'caseMioExample',raw_value:'saved-only',updated_at:'version'}]
 const source=createCloudPeer({channelName,getSnapshot:()=>({owner:owner.id,ready:true,rows:()=>rows})})
 const target=createCloudPeer({channelName,getSnapshot:()=>({owner:'A',ready:false,rows:()=>[]})})
 const other=createCloudPeer({channelName,getSnapshot:()=>({owner:'B',ready:false,rows:()=>[]})})
 try{
  assert.deepEqual(await target.request('A'),rows)
  assert.deepEqual(await other.request('B',{timeoutMs:20}),[])
  const controller=new AbortController();controller.abort()
  assert.deepEqual(await target.request('A',{signal:controller.signal}),[])
  owner.id='B'
  assert.deepEqual(await target.request('A',{timeoutMs:20}),[])
 }finally{source.close();target.close();other.close()}
})
test('unsupported browser falls back without persistent storage',async()=>{
 const peer=createCloudPeer({Channel:null,getSnapshot:()=>({owner:'A'})})
 assert.deepEqual(await peer.request('A'),[]);peer.close()
})
