import test from 'node:test'
import assert from 'node:assert/strict'
import {discoveryAction,discoveryList} from '../lib/portal/discovery.js'
import {requireStaffClientAction} from '../lib/portal/security.js'
const matter={id:'matter',client_id:'client',clients:{email:'client@example.com'}}
function fixture(){
 const tables={mio_portal_discovery_sets:[{id:'set',matter_id:'matter',client_id:'client',recipient_email:'client@example.com',source_set_id:'native',title:'RFP',discovery_type:'production',requests:[{id:'r',request_number:'1',request_text:'Produce statements',client_must_respond:false,attorney_comments:'Optional guidance'}]}],mio_portal_discovery_answers:[{set_id:'set',request_id:'r',client_answer:'Original client words',attorney_response:'PRIVATE attorney draft',version:2}],mio_portal_discovery_files:[]},calls=[]
 const db={
  from(table){
   let predicates=[],mode='select',payload
   const q={
    select(){return q},
    eq(k,v){predicates.push(r=>r[k]===v);return q},
    is(k,v){predicates.push(r=>(r[k]??null)===v);return q},
    in(k,v){predicates.push(r=>v.includes(r[k]));return q},
    order(){return q},maybeSingle(){q.one=true;return q},
    insert(v){mode='insert';payload=v;return q},update(v){mode='update';payload=v;return q},upsert(v){mode='upsert';payload=v;return q},
    then(resolve){
     let rows=tables[table]||[],matches=rows.filter(r=>predicates.every(p=>p(r)))
     if(mode==='insert'){rows.push(payload);tables[table]=rows}
     else if(mode==='update')matches.forEach(r=>Object.assign(r,payload))
     else if(mode==='upsert'){
      const existing=rows.find(r=>r.source_set_id===payload.source_set_id&&r.matter_id===payload.matter_id)
      if(existing)Object.assign(existing,payload);else rows.push(payload)
      tables[table]=rows
     }
     return Promise.resolve({data:q.one?matches[0]||null:matches,error:null}).then(resolve)
    }
   }
   return q
  },
  rpc:async(name,args)=>{calls.push([name,args]);return {data:{request_id:'r',client_answer:args.p_answer,version:3,attorney_response:'PRIVATE'}}},
  storage:{
   from(bucket){
    calls.push(['bucket',bucket])
    return {
     createSignedUploadUrl:async path=>{calls.push(['upload',path]);return {data:{signedUrl:'https://storage.example/upload'}}},
     info:async()=>({data:{size:100}}),
     createSignedUrl:async(path,ttl)=>{calls.push(['download',path,ttl]);return {data:{signedUrl:'https://storage.example/private'}}}
    }
   }
  }
 }
 return {db,tables,calls}
}
test('portal projection includes optional requests and excludes attorney drafts and storage paths',async()=>{const f=fixture(),out=await discoveryList(f.db,matter);assert.equal(out.sets[0].requests[0].client_must_respond,false);assert.equal(out.sets[0].answers[0].client_answer,'Original client words');assert.doesNotMatch(JSON.stringify(out),/PRIVATE|source_user_id|attorney_response|"path"/);assert.match(JSON.stringify(out),/Optional guidance/)})
test('another client association cannot see released sets or save their answers',async()=>{const f=fixture();assert.deepEqual(await discoveryList(f.db,{...matter,client_id:'other'}),{sets:[]});await assert.rejects(discoveryAction(f.db,{...matter,client_id:'other'},{action:'discovery_save',set_id:'set',request_id:'r',version:2,answer:{client_answer:'bad'}}),e=>e.status===404);assert.equal(f.calls.length,0)})
test('client answer save whitelists fields and returns no attorney draft',async()=>{const f=fixture(),r=await discoveryAction(f.db,matter,{action:'discovery_save',set_id:'set',request_id:'r',version:2,answer:{client_answer:'Changed',attorney_response:'overwrite',needs_help:true}});assert.equal(r.answer.client_answer,'Changed');assert.equal(r.answer.attorney_response,undefined);assert.equal(f.calls[0][1].p_version,2);assert.equal(f.calls[0][1].p_help,true);assert.equal(f.calls[0][1].attorney_response,undefined)})
test('uploads are scoped to one request in the private bucket, with file limits',async()=>{const f=fixture();for(const props of [{filename:'script.html',size:100},{filename:'a.pdf',size:26214401},{filename:'a.pdf',size:0}])await assert.rejects(discoveryAction(f.db,matter,{action:'discovery_upload_begin',set_id:'set',request_id:'r',...props}));const result=await discoveryAction(f.db,matter,{action:'discovery_upload_begin',set_id:'set',request_id:'r',filename:'sample.pdf',size:100});assert.equal(result.content_type,'application/pdf');assert.equal(f.tables.mio_portal_discovery_files[0].status,'uploading');assert.match(f.tables.mio_portal_discovery_files[0].path,/^matter\/set\/.+\/sample.pdf$/);assert(f.calls.some(c=>c[0]==='bucket'&&c[1]==='portal-discovery'))})
test('upload is not shown as ready until actual storage size is verified',async()=>{const f=fixture();f.tables.mio_portal_discovery_files.push({id:'f',set_id:'set',request_id:'r',path:'matter/set/f.pdf',filename:'f.pdf',size_bytes:101,status:'uploading'});await assert.rejects(discoveryAction(f.db,matter,{action:'discovery_upload_complete',set_id:'set',request_id:'r',file_id:'f'}),e=>e.status===409);assert.equal(f.tables.mio_portal_discovery_files[0].status,'uploading');f.tables.mio_portal_discovery_files[0].size_bytes=100;const r=await discoveryAction(f.db,matter,{action:'discovery_upload_complete',set_id:'set',request_id:'r',file_id:'f'});assert.equal(r.file.status,'ready');assert.equal(r.file.path,undefined)})
test('files cannot be downloaded through another request or before upload completion',async()=>{const f=fixture();f.tables.mio_portal_discovery_files.push({id:'f',set_id:'set',request_id:'r',path:'matter/set/f.pdf',status:'uploading'});await assert.rejects(discoveryAction(f.db,matter,{action:'discovery_download',set_id:'set',request_id:'r',file_id:'f'}),e=>e.status===409);f.tables.mio_portal_discovery_files[0].status='ready';f.tables.mio_portal_discovery_files[0].request_id='other';await assert.rejects(discoveryAction(f.db,matter,{action:'discovery_download',set_id:'set',request_id:'r',file_id:'f'}),e=>e.status===404);assert(!f.calls.some(c=>c[0]==='download'))})
test('attorney revision never rewrites the client answer',async()=>{const f=fixture();await discoveryAction(f.db,matter,{action:'staff_discovery_revision',set_id:'set',request_id:'r',attorney_response:'Attorney revision'},{staff:true});const a=f.tables.mio_portal_discovery_answers[0];assert.equal(a.client_answer,'Original client words');assert.equal(a.version,2);assert.equal(a.attorney_response,'Attorney revision')})
test('client view mutations are only enabled for the designated staff-owned test matter',()=>{for(const action of ['discovery_save','discovery_upload_begin','discovery_upload_complete']){assert.throws(()=>requireStaffClientAction(action,matter,{email:'ben@beveridgelawfirm.com'}),e=>e.status===403);assert.doesNotThrow(()=>requireStaffClientAction(action,{...matter,name:'Test - Ben Test Matter',case_type:'Test',notes:'MIO_CLIENT_PORTAL_TEST_V1',clients:{email:'ben@beveridgelawfirm.com'}},{email:'ben@beveridgelawfirm.com'}))}})
test('publication projects only client-facing fields and refuses cross-matter source data',async()=>{const f=fixture(),set={id:'native',matter_id:'other',title:'RFP',discovery_type:'production',requests:[{id:'r',request_text:'Text',private_notes:'secret',client_answer:'do not publish'}]};await assert.rejects(discoveryAction(f.db,matter,{action:'staff_discovery_publish',set},{staff:true,user:{id:'staff'}}));set.matter_id='matter';await discoveryAction(f.db,matter,{action:'staff_discovery_publish',set},{staff:true,user:{id:'staff'}});const saved=f.tables.mio_portal_discovery_sets[0];assert.equal(saved.requests[0].private_notes,undefined);assert.equal(saved.requests[0].client_answer,undefined)})
