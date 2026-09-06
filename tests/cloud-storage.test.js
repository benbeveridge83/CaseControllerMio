import {chunkRows} from './cloud-chunk-fixture.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createMioCloudStore,isAppKey,isNativeKey} from '../src/mioCloudStore.js'
import {transformMioCloudPersistence} from '../mio-v277-cloud-persistence.js'
function fixture(local={},initial=[]) {
 const disk=new Map(Object.entries(local)),rows=new Map(initial.map(r=>[r.user_id+'|'+r.key,{...r}])),recoveries=[]
 let clock=0
 const faults={read:false,write:false,archive:false,readback:false},writes=[]
 const nativeStorage={getItem:k=>disk.get(k)??null,setItem(k,v){disk.set(k,v)},removeItem:k=>disk.delete(k),key:i=>[...disk.keys()][i]??null,get length(){return disk.size}}
 const client={from(table){
  const q={table,mode:'read',filters:[],start:0,end:Infinity,select(){return this},eq(k,v){this.filters.push(r=>r[k]===v);return this},neq(k,v){this.filters.push(r=>r[k]!==v);return this},in(k,v){this.filters.push(r=>v.includes(r[k]));return this},order(){return this},range(a,b){this.start=a;this.end=b;return this},insert(data){this.mode='insert';this.data=data;return this},upsert(data,options){this.mode='upsert';this.data=data;this.options=options;return this},then(resolve,reject){return Promise.resolve().then(()=>{
    if(table==='case_mio_user_state'){
      if(this.mode==='read'){if(faults.read)return{data:null,error:{message:'offline'}};return{data:[...rows.values()].filter(r=>this.filters.every(f=>f(r))).sort((a,b)=>a.key.localeCompare(b.key)).slice(this.start,this.end+1),error:null}}
      for(const r of this.data){const key=r.user_id+'|'+r.key;if(!this.options?.ignoreDuplicates||!rows.has(key))rows.set(key,{...r,updated_at:String(++clock)})}return{error:null}
    }
    if(this.mode==='insert'){if(faults.archive)return{error:{message:'archive failed'}};const inserted=this.data.map(r=>({...r,id:String(++clock)}));recoveries.push(...inserted);return{data:inserted,error:null}}
    if(faults.readback)return{data:[],error:null}
    return{data:recoveries.filter(r=>this.filters.every(f=>f(r))),error:null}
  }).then(resolve,reject)}};return q
 },async rpc(name,p){if(name==='mio_cloud_state_read_chunks_v297'){if(faults.read)return{error:{message:'offline'}};return{data:chunkRows([...rows.values()],p),error:null}};writes.push(p);if(faults.write)return{error:{message:'offline'}}
   const key=p.p_user_id+'|'+p.p_key,old=rows.get(key)
   if(old?.raw_value===p.p_raw&&!p.p_delete)return{data:old,error:null}
   if(!!old!==p.p_expected_exists||(old&&old.updated_at!==p.p_expected_at))return{error:{code:'40001',message:'stale'}}
   if(p.p_delete){rows.delete(key);return{data:{key:p.p_key,deleted:true},error:null}}
   const row={user_id:p.p_user_id,key:p.p_key,raw_value:p.p_raw,updated_at:String(++clock)};rows.set(key,row);return{data:row,error:null}
 }}
 const store=createMioCloudStore({client,nativeStorage,delay:60000,origin:'https://test.invalid'})
 return{store,rows,disk,recoveries,faults,writes,client}
}
const row=(key,value,user='a')=>({user_id:user,key,raw_value:value,updated_at:'old'})
test('registers app keys and excludes authentication and local leases',()=>{
 for(const k of ['caseControllerDocuments','caseMioDraftingTemplates','matterColumnWidths','taskPriority:12'])assert.ok(isAppKey(k))
 for(const k of ['sb-test-auth-token','msal.account','caseMioSupabaseSessionV1','caseMioBackgroundLeaseV258:poll']){assert.ok(isNativeKey(k));assert.equal(isAppKey(k),false)}
 assert.equal(isAppKey('__mio_live_state_snapshot__'),false)
})
test('cloud is loaded before defaults; no browser mirroring',async()=>{
 const f=fixture({caseMioDraftingTemplates:'old local'},[row('caseMioDraftingTemplates','cloud')])
 await f.store.prepare('a');assert.equal(f.store.storage.getItem('caseMioDraftingTemplates'),'cloud')
 f.store.storage.setItem('caseMioDraftingTemplates','default');assert.equal(f.store.status().pending,0)
 f.store.activate();f.store.storage.setItem('caseMioDraftingTemplates','edited');assert.equal(await f.store.flushAll(),true)
 assert.equal(f.rows.get('a|caseMioDraftingTemplates').raw_value,'edited');assert.equal(f.disk.get('caseMioDraftingTemplates'),'old local')
})
test('failed reads do not enable defaults or writes',async()=>{
 const f=fixture();f.faults.read=true;await assert.rejects(f.store.prepare('a'));f.store.activate()
 assert.equal(await f.store.saveNow('caseMioTest','default'),false);assert.equal(f.writes.length,0)
})
test('failed saves remain pending only in RAM and retry',async()=>{
 const f=fixture();await f.store.prepare('a');f.store.activate();f.faults.write=true
 assert.equal(await f.store.saveNow('caseMioTest','important'),false);assert.equal(f.store.status().pending,1);assert.equal(f.disk.size,0)
 f.faults.write=false;assert.equal(await f.store.flushAll(),true);assert.equal(f.rows.get('a|caseMioTest').raw_value,'important')
})
test('migration archives and reads back before removing exact local values',async()=>{
 const f=fixture({caseMioTest:'older',caseMioMissing:'only local','sb-token':'secret'},[row('caseMioTest','newer')])
 await f.store.prepare('a');const result=await f.store.migrateLegacy()
 assert.equal(result.conflicts,1);assert.equal(f.rows.get('a|caseMioTest').raw_value,'newer');assert.equal(f.rows.get('a|caseMioMissing').raw_value,'only local')
 assert.equal(f.disk.size,1);assert.equal(f.disk.get('sb-token'),'secret');assert.equal(f.recoveries.length,2)
})
for(const failure of ['archive','readback'])test(`migration retains local data when ${failure} fails`,async()=>{
 const f=fixture({caseMioTest:'irreplaceable'});await f.store.prepare('a');f.faults[failure]=true
 await assert.rejects(f.store.migrateLegacy());assert.equal(f.disk.get('caseMioTest'),'irreplaceable')
})
test('account switch cannot save prior-account pending data into new account',async()=>{
 const f=fixture();await f.store.prepare('a');f.store.activate();f.store.stage('caseMioTest','account a')
 await f.store.prepare('b');f.store.activate();await f.store.flushAll();assert.equal(f.rows.has('b|caseMioTest'),false);assert.equal(f.store.status().pausedPending,1)
 await f.store.prepare('a');f.store.activate();await f.store.flushAll();assert.equal(f.rows.get('a|caseMioTest').raw_value,'account a')
})
test('stale edits cannot silently replace another tab',async()=>{
 const f=fixture({},[row('caseMioTest','original')]);await f.store.prepare('a');f.store.activate()
 f.rows.set('a|caseMioTest',{...row('caseMioTest','other tab'),updated_at:'new'})
 assert.equal(await f.store.saveNow('caseMioTest','my edit'),false);assert.equal(f.store.status().conflicts,1);assert.equal(f.rows.get('a|caseMioTest').raw_value,'other tab')
 assert.equal(await f.store.preservePending(),true);assert.equal(f.recoveries[0].raw_value,'my edit');assert.equal(f.rows.get('a|caseMioTest').raw_value,'other tab')
})
test('latest edit wins serialized in-flight save and remains pending until acknowledged',async()=>{
 const f=fixture();await f.store.prepare('a');f.store.activate()
 let release;const normal=f.client.rpc;f.client.rpc=async(...args)=>{await new Promise(r=>{release=r});return normal(...args)}
 f.store.stage('caseMioTest','first');const flushing=f.store.flushAll();await new Promise(r=>setImmediate(r))
 f.store.stage('caseMioTest','second');release();await flushing;assert.equal(f.store.status().pending,1)
 f.client.rpc=normal;await f.store.flushAll();assert.equal(f.rows.get('a|caseMioTest').raw_value,'second')
})
test('cloud preload paginates beyond the first 250 rows',async()=>{
 const f=fixture({},Array.from({length:501},(_,i)=>row('caseMioTest'+String(i).padStart(4,'0'),String(i))))
 await f.store.prepare('a');assert.equal(f.store.records().length,501)
})
test('app snapshots never export auth, browser clears are prohibited',async()=>{
 const f=fixture({'sb-test-auth-token':'secret'},[row('caseMioTest','value')]);await f.store.prepare('a');f.store.activate()
 assert.deepEqual(f.store.snapshot(),{caseMioTest:'value'});assert.throws(()=>f.store.storage.clear())
 assert.throws(()=>f.store.storage.setItem('unregisteredData','value'));assert.equal(f.disk.size,1)
})
test('transform disables legacy persistence, dangerous clearing, and snapshot overwrite',()=>{
 const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8'),out=transformMioCloudPersistence(source)
 assert.ok(out.includes('const localStorage = mioStorage'));assert.ok(out.includes('mioCloudStore.saveNow'))
 assert.equal(out.includes('window.localStorage'),false);assert.equal(out.includes('localStorage.clear()'),false)
 assert.equal(out.includes("from('case_mio_user_state').upsert"),false)
 assert.throws(()=>transformMioCloudPersistence('different app'))
})
