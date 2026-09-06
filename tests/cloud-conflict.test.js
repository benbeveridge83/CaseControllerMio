import test from 'node:test'
import assert from 'node:assert/strict'
import {createMioCloudStore} from '../src/mioCloudStore.js'
import {chunkRows} from './cloud-chunk-fixture.js'

// Synthetic data only. No sign-in, production reads, or network writes.
function fixture(code='PT409') {
  const row={user_id:'account-a',key:'caseMioConflictTest',raw_value:'current cloud value',updated_at:'2026-09-05T00:00:00Z'}
  const recoveries=[],writes=[]
  let fail=true
  const client={
    from(table) {
      const filters=[]; let inserted=null,start=0,end=Infinity
      return {select(){return this},eq(k,v){filters.push(r=>r[k]===v);return this},neq(k,v){filters.push(r=>r[k]!==v);return this},in(k,v){filters.push(r=>v.includes(r[k]));return this},order(){return this},range(a,b){start=a;end=b;return this},insert(items){inserted=items;return this},then(resolve,reject){return Promise.resolve().then(()=>{
        let data
        if(table==='case_mio_user_state')data=[row]
        else if(inserted){data=inserted.map((r,i)=>({...r,id:String(recoveries.length+i+1)}));recoveries.push(...data)}
        else data=recoveries
        return {data:data.filter(r=>filters.every(f=>f(r))).slice(start,end+1),error:null}
      }).then(resolve,reject)}}
    },
    async rpc(name,p) {
      if(name==='mio_cloud_state_read_chunks_v297')return{data:chunkRows([row],p),error:null}
      writes.push(p)
      if(fail&&p.p_key===row.key)return{data:null,error:{code,message:'Cloud version conflict'},status:code==='PGRST003'?504:409}
      return{data:{key:p.p_key,raw_value:p.p_raw,updated_at:'2026-09-06T00:00:00Z'},error:null}
    },
  }
  const nativeStorage={length:0,key:()=>null,getItem:()=>null,setItem(){throw Error('Unexpected app disk write')},removeItem(){throw Error('Unexpected app disk deletion')}}
  return{store:createMioCloudStore({client,nativeStorage,origin:'https://synthetic.invalid',delay:60000}),row,writes,recoveries,allowWrites(){fail=false}}
}
for(const code of ['PT409','40001'])test(code+' stops repeated saves and preserves the exact pending edit',async()=>{
  const f=fixture(code),key=f.row.key
  await f.store.prepare('account-a');f.store.activate()
  assert.equal(await f.store.saveNow(key,'my unsaved edit'),false)
  assert.equal(f.store.status().pending,1);assert.equal(f.store.status().conflicts,1)
  for(let i=0;i<5;i++)assert.equal(await f.store.flushAll(),false)
  assert.equal(await f.store.saveNow(key,'my newer unsaved edit'),false)
  assert.equal(f.writes.length,1,'the stale record must not be resubmitted')
  assert.equal(f.store.storage.getItem(key),'my newer unsaved edit')
  assert.equal(f.row.raw_value,'current cloud value')
  assert.equal(await f.store.saveNow('caseMioOtherRecord','independent edit'),true,'a conflict must not block unrelated records')
  assert.equal(f.writes.length,2)
  assert.equal(await f.store.preservePending(),true)
  assert.equal(f.recoveries.length,1);assert.equal(f.recoveries[0].raw_value,'my newer unsaved edit')
  assert.equal(f.store.status().pending,0);assert.equal(f.store.status().conflicts,0)
  assert.equal(f.row.raw_value,'current cloud value','preserving must not overwrite the winning cloud version')
})
test('a temporary pool failure remains retryable and does not become a permanent conflict',async()=>{
  const f=fixture('PGRST003')
  await f.store.prepare('account-a');f.store.activate()
  assert.equal(await f.store.saveNow(f.row.key,'edit'),false)
  assert.equal(f.store.status().pending,1);assert.equal(f.store.status().conflicts,0)
  f.allowWrites();assert.equal(await f.store.flushAll(),true)
  assert.equal(f.writes.length,2);assert.equal(f.store.status().pending,0)
})
