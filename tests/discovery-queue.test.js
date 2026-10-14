import test from 'node:test'
import assert from 'node:assert/strict'
import { runAnalysisQueue, discoveryApiError } from '../src/discovery/analysisQueue.js'

const requests=Array.from({length:25},(_,i)=>({id:`r${i+1}`,type:'roggs',number:String(i+1),request:`Identify witness ${i+1}.`,response:''}))
const good=r=>({results:[{id:r.id,assessment:'proper'}]})
const failure=(code='AI_INVALID_RESULT',status=502)=>Object.assign(new Error('Synthetic analysis failure.'),{code,status,retryable:true})
const options={retryDelayMs:1,timeoutMs:1000}

test('25 requests: three completed remain untouched and a bad fourth cannot block the other 21',async()=>{
  const calls=[],accepted=[],states=[]
  const run=await runAnalysisQueue({...options,requests,completedIds:['r1','r2','r3'],analyze:async(r,{attempt,retry})=>{
    calls.push([r.id,attempt]);if(r.id==='r4'){if(attempt===2)assert.equal(retry.reason,'AI_INVALID_RESULT');throw failure()}return good(r)
  },onResult:r=>accepted.push(r.id),onState:s=>states.push(s)})
  assert.equal(run.phase,'attention');assert.equal(run.analyzed,24);assert.equal(run.remaining,1)
  assert.deepEqual(Object.keys(run.failures),['r4']);assert.equal(accepted.length,21)
  assert.equal(calls.length,23);assert.deepEqual(calls.slice(0,3),[['r4',1],['r4',2],['r5',1]])
  assert.equal(states.filter(s=>s.phase==='retrying').length,1)
  const retried=[]
  const resumed=await runAnalysisQueue({...options,requests,completedIds:['r1','r2','r3',...accepted],failures:run.failures,analyze:async r=>{retried.push(r.id);return good(r)}})
  assert.deepEqual(retried,['r4']);assert.equal(resumed.phase,'completed');assert.equal(resumed.remaining,0);assert.deepEqual(resumed.failures,{})
})

test('a transient gateway error retries once and completes without manual intervention',async()=>{
  let calls=0
  const run=await runAnalysisQueue({...options,requests:requests.slice(0,2),analyze:async r=>{if(++calls===1)throw failure('AI_GATEWAY');return good(r)}})
  assert.equal(calls,3);assert.equal(run.phase,'completed');assert.equal(run.analyzed,2)
})

test('authentication and server configuration errors pause instead of retrying the whole document',async()=>{
  for(const status of [401,403,503]){
    let calls=0
    const error=discoveryApiError({status,headers:new Headers()},{error:'Sign in or configure the service.',code:status===503?'AI_CONFIGURATION':'AUTH_REQUIRED',retryable:false})
    const run=await runAnalysisQueue({...options,requests,analyze:async()=>{calls++;throw error}})
    assert.equal(calls,1);assert.equal(run.phase,'paused');assert.equal(run.remaining,25)
  }
})

test('stop aborts an active call promptly, ignores late answers and resumes only unfinished requests',async()=>{
  const abort=new AbortController(),accepted=[];let release,started
  const ready=new Promise(resolve=>{started=resolve})
  const running=runAnalysisQueue({...options,requests:requests.slice(0,3),signal:abort.signal,onResult:r=>accepted.push(r.id),analyze:async r=>{
    if(r.id==='r1')return good(r)
    started();return new Promise(resolve=>{release=()=>resolve(good(r))})
  }})
  await ready;abort.abort();const stopped=await running
  release();await Promise.resolve()
  assert.equal(stopped.phase,'stopped');assert.equal(stopped.analyzed,1);assert.deepEqual(accepted,['r1'])
  const calls=[]
  const resumed=await runAnalysisQueue({...options,requests:requests.slice(0,3),completedIds:accepted,analyze:async r=>{calls.push(r.id);return good(r)}})
  assert.deepEqual(calls,['r2','r3']);assert.equal(resumed.phase,'completed')
})

test('stop during retry backoff never sends the next attempt',async()=>{
  const abort=new AbortController();let calls=0
  const run=await runAnalysisQueue({...options,retryDelayMs:10000,requests,signal:abort.signal,analyze:async()=>{calls++;throw failure()},onState:s=>{if(s.phase==='retrying')abort.abort()}})
  assert.equal(run.phase,'stopped');assert.equal(calls,1)
})

test('hung calls time out, are bounded to two attempts, and do not block later requests',async()=>{
  let calls=0
  const run=await runAnalysisQueue({...options,timeoutMs:5,requests:requests.slice(0,2),analyze:async r=>{calls++;return r.id==='r1'?new Promise(()=>{}):good(r)}})
  assert.equal(calls,3);assert.equal(run.analyzed,1);assert.equal(run.failures.r1.code,'CLIENT_TIMEOUT')
})

test('mismatched or missing results are never counted as analyzed',async()=>{
  const run=await runAnalysisQueue({...options,requests:requests.slice(0,1),analyze:async()=>({results:[{id:'other'}]})})
  assert.equal(run.analyzed,0);assert.equal(run.remaining,1);assert.equal(run.failures.r1.code,'AI_INVALID_RESULT')
})

test('non-JSON gateway failures and rate limits retain actionable metadata',async()=>{
  const error=discoveryApiError({status:502,headers:new Headers()},null)
  assert.equal(error.code,'AI_GATEWAY');assert.equal(error.retryable,true);assert.match(error.message,/502/)
  const limited=discoveryApiError({status:429,headers:new Headers({'Retry-After':'60'})},{error:'Try later.',code:'AI_RATE_LIMIT',retryable:true})
  assert.equal(limited.retryAfterSeconds,60)
  let calls=0
  const run=await runAnalysisQueue({...options,requests,analyze:async()=>{calls++;throw limited}})
  assert.equal(run.phase,'paused');assert.equal(calls,1);assert.equal(run.remaining,25)
})

test('stopping a retry preserves the last unresolved failure until a result is accepted',async()=>{
  const abort=new AbortController(),prior={message:'Prior invalid result.',code:'AI_INVALID_RESULT',attempt:2,retryable:true}
  const run=await runAnalysisQueue({...options,requests:requests.slice(0,1),failures:{r1:prior},signal:abort.signal,analyze:async()=>new Promise(()=>{}),onState:s=>{if(s.current)abort.abort()}})
  assert.equal(run.phase,'stopped');assert.equal(run.analyzed,0);assert.deepEqual(run.failures.r1,prior)
})

test('HTTP-date rate limits pause instead of retrying before the provider allows it',async()=>{
  const retryDate=new Date(Date.now()+120000).toUTCString()
  const error=discoveryApiError({status:429,headers:new Headers({'Retry-After':retryDate})},null)
  assert.ok(error.retryAfterSeconds>=118)
  let calls=0
  const run=await runAnalysisQueue({...options,requests,analyze:async()=>{calls++;throw error}})
  assert.equal(run.phase,'paused');assert.equal(calls,1)
})
