import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {observeMioAuth} from '../src/mioAuthStartup.js'
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}

test('auth initialization settles before subscriber registration; callback never returns a promise',async()=>{
  const init=deferred(),calls=[],seen=[],errors=[];let callback
  const auth={getSession(){calls.push('getSession');return init.promise},onAuthStateChange(fn){calls.push('subscribe');callback=fn;return{data:{subscription:{unsubscribe(){calls.push('unsubscribe')}}}}}}
  const stop=observeMioAuth(auth,{onSession:s=>seen.push(s),onError:e=>errors.push(e),timeoutMs:1000})
  assert.deepEqual(calls,['getSession'])
  init.resolve({data:{session:{user:{id:'a'}}},error:null});await delay(5)
  assert.deepEqual(calls,['getSession','subscribe']);assert.equal(seen[0].user.id,'a')
  assert.equal(callback('SIGNED_OUT',null),undefined);assert.equal(seen.length,1)
  await delay(5);assert.equal(seen[1],null);assert.deepEqual(errors,[]);stop()
  assert.equal(calls.at(-1),'unsubscribe')
})
test('StrictMode cleanup ignores late initialization and does not leave subscribers',async()=>{
  const init=deferred();let subscriptions=0,deliveries=0
  const auth={getSession:()=>init.promise,onAuthStateChange(){subscriptions++;return{data:{subscription:{unsubscribe(){}}}}}}
  const stop=observeMioAuth(auth,{onSession:()=>deliveries++,onError:()=>deliveries++,timeoutMs:10})
  stop();init.resolve({data:{session:null}});await delay(20)
  assert.equal(subscriptions,0);assert.equal(deliveries,0)
})
test('unmount cancels deferred auth events',async()=>{
  let callback;const seen=[]
  const auth={getSession:async()=>({data:{session:null}}),onAuthStateChange(fn){callback=fn;return{data:{subscription:{unsubscribe(){}}}}}}
  const stop=observeMioAuth(auth,{onSession:s=>seen.push(s),onError:assert.fail})
  await delay(5);callback('SIGNED_IN',{user:{id:'late'}});stop();await delay(5)
  assert.deepEqual(seen,[null])
})
test('stalled or failed auth reports error without inventing a session; late recovery is allowed',async()=>{
  const init=deferred(),seen=[],errors=[]
  const auth={getSession:()=>init.promise,onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}
  const stop=observeMioAuth(auth,{onSession:s=>seen.push(s),onError:e=>errors.push(e),timeoutMs:5})
  await delay(15);assert.equal(errors.length,1);assert.match(errors[0].message,/timed out/);assert.deepEqual(seen,[])
  init.resolve({data:{session:{user:{id:'recovered'}}}});await delay(5);assert.equal(seen[0].user.id,'recovered');stop()
  const failure=[]
  const cleanup=observeMioAuth({...auth,getSession:async()=>({error:new Error('Network unavailable')})},{onSession:assert.fail,onError:e=>failure.push(e)})
  await delay(5);assert.match(failure[0].message,/Network unavailable/);cleanup()
})
test('release uses fixed Supabase SDK without an opt-in legacy or no-op lock',()=>{
  const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'))
  assert.equal(lock.packages['node_modules/@supabase/auth-js'].version,'2.108.2')
  assert.equal(lock.packages['node_modules/@supabase/supabase-js'].version,'2.108.2')
  const client=fs.readFileSync('src/supabaseClient.js','utf8')
  assert.doesNotMatch(client,/\block\s*:/)
  const startup=fs.readFileSync('src/mioAuthStartup.js','utf8')
  assert.doesNotMatch(startup,/localStorage|sessionStorage|removeItem|refreshSession\(/)
  const boundary=fs.readFileSync('src/MioCloudBoundary.jsx','utf8')
  assert.match(boundary,/await store.prepare\(id\)/)
  assert.match(boundary,/!current.pending&&!current.pausedPending/)
})
