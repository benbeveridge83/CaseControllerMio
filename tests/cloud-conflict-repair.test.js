// Synthetic data only. No sign-in, production reads, or network writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createMioCloudStore} from '../src/mioCloudStore.js'
import {mergeMioRecordLists,repairMioCloudConflict} from '../src/mioCloudConflictRepair.js'
import {chunkRows} from './cloud-chunk-fixture.js'
const list=(...rows)=>JSON.stringify(rows)
function fixture(initial=[]) {
  const rows=new Map(initial.map(row=>[row.key,{user_id:'a',...row}])),recoveries=[],writes=[]
  let clock=0
  const client={
    from(table){
      const query={table,filters:[],start:0,end:Infinity,mode:'read',select(){return this},eq(k,v){this.filters.push(r=>r[k]===v);return this},neq(k,v){this.filters.push(r=>r[k]!==v);return this},in(k,v){this.filters.push(r=>v.includes(r[k]));return this},order(){return this},range(a,b){this.start=a;this.end=b;return this},insert(data){this.mode='insert';this.data=data;return this},then(resolve,reject){return Promise.resolve().then(()=>{
        if(this.mode==='insert'){const inserted=this.data.map((r,i)=>({...r,id:String(recoveries.length+i+1)}));recoveries.push(...inserted);return{data:inserted,error:null}}
        if(this.table==='case_mio_browser_recovery')return{data:recoveries.filter(r=>this.filters.every(f=>f(r))),error:null}
        return{data:[...rows.values()].filter(r=>this.filters.every(f=>f(r))).sort((a,b)=>a.key.localeCompare(b.key)).slice(this.start,this.end+1),error:null}
      }).then(resolve,reject)}}
      return query
    },
    async rpc(name,p){
      if(name==='mio_cloud_state_read_chunks_v297')return{data:chunkRows([...rows.values()].map(r=>({...r,user_id:'a'})),p),error:null}
      writes.push(p)
      const old=rows.get(p.p_key)
      if(p.p_delete){if(!old)return{error:{code:'PT409',message:'already deleted'}};rows.delete(p.p_key);return{data:{key:p.p_key,deleted:true},error:null}}
      if(!!old!==p.p_expected_exists||(old&&old.updated_at!==p.p_expected_at))return{error:{code:'PT409',message:'stale write'}}
      const stored={user_id:'a',key:p.p_key,raw_value:p.p_raw,updated_at:String(++clock)}
      rows.set(p.p_key,stored);return{data:stored,error:null}
    },
  }
  const nativeStorage={length:0,key:()=>null,getItem:()=>null,setItem(){throw new Error('Unexpected app disk write')},removeItem(){throw new Error('Unexpected app disk deletion')}}
  return{client,rows,recoveries,writes,async open(){const store=createMioCloudStore({client,origin:'https://test.invalid',delay:60000,nativeStorage});await store.prepare('a');store.activate();return store}}
}
test('a write whose value is already in the cloud is not reported as unsaved',()=>{
  assert.equal(repairMioCloudConflict({baselineRaw:'one',localRaw:'two',deleting:false,remoteRaw:'two'}),null)
  assert.equal(repairMioCloudConflict({baselineRaw:'one',localRaw:'two',deleting:false,remoteRaw:'three'}),undefined)
  assert.equal(repairMioCloudConflict({baselineRaw:null,localRaw:null,deleting:true,remoteRaw:null}),null)
  assert.equal(repairMioCloudConflict({baselineRaw:'one',localRaw:null,deleting:true,remoteRaw:'three'}),undefined)
})
test('rows added by each tab are merged and a shared row keeps its conflict',()=>{
  assert.deepEqual(JSON.parse(mergeMioRecordLists(list(),list({id:'b',value:2}),list({id:'a',value:1}))).map(row=>row.id),['a','b'])
  assert.equal(mergeMioRecordLists(list({id:'a',value:1}),list({id:'a',value:2}),list({id:'a',value:3})),null,'two edits of one row must stay a conflict')
  assert.equal(mergeMioRecordLists(list({id:'a',value:1}),list(),list({id:'a',value:2})),null,'an edit racing a deletion must stay a conflict')
})
test('a deletion from another tab survives while this tab adds its own row',()=>{
  assert.deepEqual(JSON.parse(mergeMioRecordLists(list({id:'a'},{id:'b'}),list({id:'a'},{id:'c'}),list({id:'a'}))).map(row=>row.id),['a','c'])
  assert.deepEqual(JSON.parse(mergeMioRecordLists(list(),list(),list({id:'a'}))).map(row=>row.id),['a'],'a row added elsewhere is adopted')
})
test('values that cannot be matched up keep the strict conflict check',()=>{
  assert.equal(mergeMioRecordLists(list(),list({name:'no id'}),list({id:'a'})),null)
  assert.equal(mergeMioRecordLists(list(),list({id:'a'},{id:'a'}),list({id:'b'})),null,'duplicate ids cannot be matched up')
  assert.equal(mergeMioRecordLists('{"value":1}','{"value":2}','{"value":3}'),null,'objects are not merged here')
  assert.equal(mergeMioRecordLists(list({id:'a'},{id:'b'}),list({id:'b'},{id:'a'}),list({id:'a'},{id:'b'})),null,'a reorder is a real difference')
})
test('two tabs saving the same value finish quietly instead of reporting an unsaved item',async()=>{
  const key='caseMioLitigationPlacements',value=list({id:'p1'},{id:'p2'})
  const f=fixture([{key,raw_value:list({id:'p1'}),updated_at:'first'}])
  const first=await f.open(),second=await f.open()
  assert.equal(await first.saveNow(key,value),true)
  assert.equal(await second.saveNow(key,value),true,'the second tab wanted exactly what the cloud already holds')
  assert.equal(second.status().pending,0);assert.equal(second.status().conflicts,0);assert.equal(second.status().error,'')
  assert.equal(second.status().reloadRequired,false,'nothing was merged, so no refresh is needed')
  assert.equal(f.rows.get(key).raw_value,value)
})
test('rows added by another tab are merged into this tab and never dropped',async()=>{
  const key='caseMioLitigationPlacements'
  const f=fixture([{key,raw_value:list(),updated_at:'first'}])
  const first=await f.open(),second=await f.open()
  assert.equal(await first.saveNow(key,list({id:'p1'})),true)
  assert.equal(await second.saveNow(key,list({id:'p2'})),true,'each tab only added its own row')
  assert.deepEqual(JSON.parse(f.rows.get(key).raw_value).map(row=>row.id),['p1','p2'])
  assert.equal(second.status().pending,0);assert.equal(second.status().conflicts,0);assert.equal(second.status().error,'')
  assert.equal(second.status().reloadRequired,true,'the merged value needs a refresh before this window writes again')
  assert.throws(()=>second.stage(key,list({id:'p2'})),/reload/i,'a stale component write must not overwrite the merged value')
})
test('a genuine clash between two edits of one row still stops and asks',async()=>{
  const key='caseMioLitigationPlacements'
  const f=fixture([{key,raw_value:list({id:'p1',value:'original'}),updated_at:'first'}])
  const first=await f.open(),second=await f.open()
  assert.equal(await first.saveNow(key,list({id:'p1',value:'from the other tab'})),true)
  assert.equal(await second.saveNow(key,list({id:'p1',value:'from this tab'})),false)
  assert.equal(second.status().pending,1);assert.equal(second.status().conflicts,1)
  assert.equal(f.rows.get(key).raw_value,list({id:'p1',value:'from the other tab'}),'the winning edit is untouched')
  assert.equal(second.storage.getItem(key),list({id:'p1',value:'from this tab'}),'the pending edit is kept in this tab')
  assert.equal(await second.preservePending(),true)
  assert.equal(f.recoveries[0].raw_value,list({id:'p1',value:'from this tab'}))
  assert.equal(second.status().pending,0);assert.equal(second.status().conflicts,0)
})
