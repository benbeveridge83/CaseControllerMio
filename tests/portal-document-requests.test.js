import test from 'node:test'
import assert from 'node:assert/strict'
import {documentAction} from '../lib/portal/documentRequests.js'
import {requirePortalSection} from '../lib/portal/settings.js'

function rowsDb(rows){return {from(){const filters=[];const query={select(){return query},eq(key,value){filters.push(r=>r[key]===value);return query},is(key,value){filters.push(r=>r[key]===value);return query},maybeSingle(){return Promise.resolve({data:rows.find(r=>filters.every(f=>f(r)))||null,error:null})}};return query}}}
const matter={id:'11111111-1111-1111-1111-111111111111',client_id:'22222222-2222-2222-2222-222222222222',clients:{email:'current@example.com'}}
test('document actions are blocked when this matter has document requests turned off',()=>{assert.throws(()=>requirePortalSection('document_list',{documents:false}),e=>e.status===403);assert.doesNotThrow(()=>requirePortalSection('document_list',{documents:true}))})
test('a previous client cannot access a request after the matter changes clients',async()=>{
 const db=rowsDb([{id:'request',matter_id:matter.id,client_id:'old',recipient_email:'previous@example.com',title:'Statements'}])
 await assert.rejects(documentAction(db,matter,{action:'document_download',request_id:'request',file_id:'file'}),e=>e.status===404)
 await assert.rejects(documentAction(db,matter,{action:'document_upload_begin',request_id:'request',original_filename:'report.pdf',filename:'Report',size:100}),e=>e.status===404)
})
