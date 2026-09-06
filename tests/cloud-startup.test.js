import test from 'node:test'
import assert from 'node:assert/strict'
import {cloudReadRequest,readMioCloudRows} from '../src/mioCloudRead.js'
import {createMioCloudStore,isAppKey} from '../src/mioCloudStore.js'
import {chunkRows} from './cloud-chunk-fixture.js'

function fixture(initial=[],settings={}) {
  const rows=initial.map(row=>({user_id:'account-a',updated_at:'original',...row}))
  const calls=[],writes=[],disk=new Map()
  const client={from(table){
    const state={table,columns:'*',filters:[],start:0,end:Infinity}
    return {select(columns){state.columns=columns;return this},eq(k,v){state.filters.push(r=>r[k]===v);return this},
      neq(k,v){state.filters.push(r=>r[k]!==v);return this},order(){return this},range(a,b){state.start=a;state.end=b;return this},
      abortSignal(s){state.signal=s;return this},then(resolve,reject){return Promise.resolve().then(()=>{
        calls.push(state)
        if(settings.fail)return {data:null,error:{message:'read denied'},status:settings.fail}
        const data=rows.filter(row=>state.filters.every(f=>f(row))).sort((a,b)=>a.key.localeCompare(b.key)).slice(state.start,state.end+1)
        return {status:200,data:data.map(r=>Object.fromEntries(state.columns.split(',').map(k=>[k,r[k]])))}
      }).then(resolve,reject)}
    }
  },rpc(name,p){
    if(name!=='mio_cloud_state_read_chunks_v297'){writes.push(p);return Promise.resolve({error:{message:'Unexpected write'}})}
    const state={rpc:name,...p}
    return {abortSignal(s){state.signal=s;return this},then(resolve,reject){return Promise.resolve().then(async()=>{
      calls.push(state)
      if(settings.fail)return {data:null,error:{message:'read denied'},status:settings.fail}
      if(settings.hook){const result=await settings.hook(state);if(result)return result}
      if(p.p_keys.length>(settings.maxBatch||4))return {data:null,error:{message:'gateway timeout'},status:504}
      let data=chunkRows(rows,p)
      if(settings.omit)data=data.filter(r=>r.key!==settings.omit)
      if(settings.corrupt)data=settings.corrupt(data)
      return {status:200,data,error:null}
    }).then(resolve,reject)}}
  }}
  const nativeStorage={get length(){return disk.size},key:i=>[...disk.keys()][i],getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)}
  const store=createMioCloudStore({client,nativeStorage,delay:60000})
  return {rows,client,calls,writes,disk,settings,store}
}
const row=(key,raw_value)=>({key,raw_value})
const load=f=>readMioCloudRows(f.client,'account-a',{isAppKey,timeoutMs:3000,retryDelayMs:0})

test('loads 501 keys and a 3.5MB record without any large-record REST request',async()=>{
  const f=fixture([...Array.from({length:501},(_,i)=>row('caseMioFixture'+String(i).padStart(4,'0'),String(i))),
    row('caseMioDraftingTemplates','x'.repeat(3500000)),row('__mio_live_state_snapshot__','obsolete'),row('sb-auth-token','secret')])
  const result=await load(f)
  assert.equal(result.length,502)
  assert.equal(result.find(r=>r.key==='caseMioDraftingTemplates').raw_value,'x'.repeat(3500000))
  assert.ok(f.calls.filter(c=>c.columns).every(c=>c.columns==='key'))
  assert.ok(f.calls.filter(c=>c.rpc).every(c=>c.p_keys.length<=4&&c.p_keys.length*c.p_chunk_chars<=262144&&!c.p_keys.includes('__mio_live_state_snapshot__')))
  assert.equal(f.writes.length,0);assert.equal(f.disk.size,0)
})
test('504s are retried as smaller groups without loading partial state',async()=>{
  const f=fixture(Array.from({length:9},(_,i)=>row('caseMioFixture'+i,String(i))),{maxBatch:1})
  assert.equal((await load(f)).length,9)
  assert.ok(f.calls.some(c=>c.p_keys?.length===4));assert.ok(f.calls.some(c=>c.p_keys?.length===1))
})
test('JSON-only legacy rows, Unicode, and empty strings reassemble exactly',async()=>{
  const content=('x\u{1F600}\u00e9').repeat(90000)
  const f=fixture([row('caseMioEmpty',''),{key:'caseMioLegacy',raw_value:null,json_value:{preserve:true}},row('caseMioUnicode',content)])
  await f.store.prepare('account-a')
  assert.equal(f.store.storage.getItem('caseMioEmpty'),'')
  assert.deepEqual(JSON.parse(f.store.storage.getItem('caseMioLegacy')),{preserve:true})
  assert.equal(f.store.storage.getItem('caseMioUnicode'),content)
})
test('missing records keep writes disabled; same-account retry recovers',async()=>{
  const f=fixture([row('caseMioImportant','original'),row('caseMioOther','other')],{omit:'caseMioImportant'})
  await assert.rejects(f.store.prepare('account-a'),/not returned/)
  f.store.activate();assert.equal(f.store.status().phase,'error')
  assert.equal(await f.store.saveNow('caseMioImportant','empty'),false);assert.equal(f.writes.length,0)
  assert.equal(f.store.records().length,0)
  delete f.settings.omit;await f.store.prepare('account-a');f.store.activate()
  assert.equal(f.store.status().phase,'ready');assert.equal(f.store.storage.getItem('caseMioImportant'),'original')
})
test('failed refresh preserves pending edits and previous values',async()=>{
  const f=fixture([row('caseMioImportant','original')]);await f.store.prepare('account-a');f.store.activate()
  f.store.stage('caseMioImportant','unsaved');f.settings.fail=401
  await assert.rejects(f.store.prepare('account-a'))
  assert.equal(f.store.storage.getItem('caseMioImportant'),'unsaved');assert.equal(f.store.status().pending,1)
  assert.equal(f.writes.length,0);assert.equal(f.disk.size,0)
})
test('progress reports completed records and pieces of a large record',async()=>{
  const f=fixture([row('caseMioLarge','x'.repeat(300000))]),progress=[]
  await readMioCloudRows(f.client,'account-a',{isAppKey,onProgress:p=>progress.push(p)})
  assert.ok(progress.some(p=>p.loaded===0&&p.characters>0));assert.equal(progress.at(-1).loaded,1)
})
test('a hung request is aborted and rejects instead of loading forever',async()=>{
  let signal
  const q={abortSignal(s){signal=s;return this},then(){}}
  await assert.rejects(cloudReadRequest(()=>q,{timeoutMs:5}),{code:'CLOUD_TIMEOUT'})
  assert.equal(signal.aborted,true)
})
test('account changes cancel stalled reads and ignore late old-account responses',async()=>{
  let release
  const f=fixture([row('caseMioPrivate','a-only'),{...row('caseMioPrivate','b-only'),user_id:'account-b'}],{hook:()=>new Promise(r=>{release=r})})
  const oldLoad=f.store.prepare('account-a');while(!release)await new Promise(r=>setImmediate(r))
  f.settings.hook=null;await f.store.prepare('account-b');await oldLoad
  assert.equal(f.store.storage.getItem('caseMioPrivate'),'b-only')
  release({status:200,data:[]});await new Promise(r=>setImmediate(r))
  assert.equal(f.store.storage.getItem('caseMioPrivate'),'b-only');assert.equal(f.writes.length,0)
})
test('permanent access failures are not retried',async()=>{
  const f=fixture([row('caseMioPrivate','secret')],{fail:403});await assert.rejects(load(f));assert.equal(f.calls.length,1)
})
test('malformed or truncated chunks never hydrate the workspace',async()=>{
  const f=fixture([row('caseMioImportant','original')],{corrupt:data=>data.map(r=>({...r,next_offset:r.next_offset+1}))})
  await assert.rejects(f.store.prepare('account-a'),/truncated|incomplete/)
  f.store.activate();assert.equal(f.store.status().phase,'error');assert.equal(f.store.records().length,0)
})
test('mid-read changes restart that record rather than combining different versions',async()=>{
  const f=fixture([row('caseMioLarge','a'.repeat(300000))]);let changed=false
  f.settings.hook=state=>{if(state.p_offset>0&&!changed){changed=true;f.rows[0].raw_value='b'.repeat(300000);f.rows[0].updated_at='new'} }
  assert.equal((await load(f))[0].raw_value,'b'.repeat(300000))
})
