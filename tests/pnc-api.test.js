// Execute the real server handler with mocked Supabase/provider boundaries.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as crypto from 'node:crypto'
import * as model from '../src/mioPncModel.js'
import * as config from '../src/mioSupabasePublic.js'
const raw=fs.readFileSync('lib/pnc.js','utf8').replace(/^import .*\n/gm,'').replace('export default async function','async function')
const mid='00000000-0000-4000-8000-000000000001',uid='owner',clone=x=>JSON.parse(JSON.stringify(x))
function fixture(){
 const f={user:{id:uid,email:'test@beveridgelawfirm.com',email_confirmed_at:'2026-01-01'},transactions:[],requests:[],providerCalls:[],failProvider:false,signComplete:false,testMode:false}
 const w={matter_id:mid,user_id:uid,client_id:'client',creation_key:'key',config:{consult_fee:125,retainer:5000,signature_pdf_path:'templates/test.pdf',signature_pdf_fields:'[{"semantic":"client_name","type":"text","page":0,"x":10,"y":20,"width":100,"height":20}]'},state:{},revision:0}
 const m={id:mid,client_id:'client',name:'Example PNC',matter_type:'Divorce',matter_status:model.PNC_STATUS,clients:{id:'client',first_name:'Example',last_name:'Person',email:'example@invalid.test'}}
 const tables={mio_pnc_workflows:[w],matters:[m],lawpay_payment_requests:f.requests,lawpay_transactions:[],lawpay_settings:[{id:1,operating_page_url:'https://secure.lawpay.com/operating',trust_page_url:'https://secure.lawpay.com/trust'}],mio_client_intake_requests:[]}
 function from(table){let filters=[],mutation=null,max=Infinity;const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},or(){return q},order(){return q},limit(n){max=n;return q},update(v){mutation={type:'update',v};return q},insert(v){mutation={type:'insert',v};return q},async single(){return execute(true,true)},async maybeSingle(){return execute(true,false)},then(resolve,reject){return Promise.resolve(execute(false,false)).then(resolve,reject)}}
  function execute(single,required){let rows=(tables[table]||[]).filter(r=>filters.every(fn=>fn(r))).slice(0,max);if(mutation?.type==='update'){rows.forEach(r=>Object.assign(r,clone(mutation.v)))}if(mutation?.type==='insert'){rows=[clone(mutation.v)];(tables[table]||=[]).push(...rows)}if(single&&required&&!rows[0])return {data:null,error:{message:'No matching row'}};return {data:clone(single?rows[0]||null:rows),error:null}}
  return q
 }
 const db={from,storage:{from:()=>({async download(){return {data:{arrayBuffer:async()=>new ArrayBuffer(4)},error:null}}})},auth:{getUser:async()=>({data:{user:f.user},error:null})},functions:{async invoke(name,{body}){if(name==='pnc-payment-status')return {data:{ok:true,transactions:f.transactions},error:null};assert.equal(name,'lawpay-gateway');assert.equal(body.action,'create_link');f.requests.push({...body,id:'request-'+f.requests.length,created_by:uid,payment_url:body.payment_page_url+'?amount='+body.amount_cents,created_at:'2026-01-01'});return {data:{url:f.requests.at(-1).payment_url},error:null}}}}
 const provider=async(url,options)=>{f.providerCalls.push({url,options});if(f.failProvider)throw Error('Synthetic provider outage');if(url.includes('/v1/document/properties'))return {ok:true,json:async()=>({documentId:'doc',status:f.signComplete?'Completed':'InProgress'})};if(url.includes('/v1/document/send'))return {ok:true,json:async()=>({documentId:'doc'})};return {ok:true,json:async()=>({})}}
 const args={createClient:()=>db,randomBytes:crypto.randomBytes,randomUUID:crypto.randomUUID,createHash:crypto.createHash,...model,...config,fetch:provider,process:{env:{SUPABASE_URL:'https://db.invalid',SUPABASE_ANON_KEY:'public-test-only',boldsignapi:'test-only'}}}
 const handler=new Function(...Object.keys(args),raw+'\nreturn pncHandler')(...Object.values(args))
 f.w=w;f.m=m;f.tables=tables;f.call=async(action,body={},headers={authorization:'Bearer test-only',host:'example.invalid'})=>{let response;const res={setHeader(){},status(n){res.code=n;return res},json(data){response={code:res.code,body:data};return response}};await handler({method:'POST',query:{integration:'pnc'},body:{action,matter_id:mid,...body},headers},res);return response};return f
}
test('server denies anonymous and client-portal users',async()=>{const f=fixture();assert.equal((await f.call('list',{},{})).code,401);f.user.email='client@example.invalid';assert.equal((await f.call('list')).code,403)})
test('create consult link is operating, correctly denominated and reusable',async()=>{const f=fixture();const a=await f.call('prepare_consult');assert.equal(a.code,200);assert.equal(f.requests[0].account_key,'operating');assert.equal(f.requests[0].amount_cents,12500);assert.equal(new URL(a.body.workflow.state.consult_request.url).searchParams.get('amount'),'125.00');assert.equal((await f.call('prepare_consult')).code,200);assert.equal(f.requests.length,1);assert.equal(f.providerCalls.length,0)})
test('stale settings and post-link amount edits are rejected',async()=>{const f=fixture();assert.equal((await f.call('save',{revision:9,config:{consult_fee:1}})).code,409);await f.call('prepare_consult');assert.equal((await f.call('save',{revision:f.w.revision,config:{consult_fee:250}})).code,409);assert.equal(f.w.config.consult_fee,125)})
test('signature needs confirmation, is idempotent and sends the mapped PDF',async()=>{const f=fixture();f.m.matter_status=model.CONSULT_STATUS;assert.equal((await f.call('prepare_engagement')).code,200);assert.equal(f.requests[0].account_key,'trust');assert.equal((await f.call('send_signature')).code,400);assert.equal(f.w.state.signature_sending,undefined);assert.equal((await f.call('send_signature',{confirmed:true})).code,200);assert.equal(f.w.state.signature.id,'doc');assert.equal((await f.call('send_signature',{confirmed:true})).code,200);const calls=f.providerCalls.filter(x=>x.url.includes('/v1/document/send'));assert.equal(calls.length,1);const form=calls[0].options.body;assert.equal(form.get('Title'),'Fee agreement - Beveridge Law Firm');assert.equal(form.get('Signers[0].EmailAddress'),'example@invalid.test');assert.equal(form.get('Signers[0].FormFields[0].Type'),'TextBox');assert.equal(form.get('Signers[0].FormFields[0].Value'),'Example Person')})
test('partial and absent provider receipts cannot advance, even with stale paid badge',async()=>{const f=fixture();f.m.matter_status=model.CONSULT_STATUS;await f.call('prepare_engagement');await f.call('send_signature',{confirmed:true});f.signComplete=true;f.w.state.retainer={status:'paid'};assert.equal((await f.call('advance',{confirmed:true})).code,409);assert.equal(f.m.matter_status,model.CONSULT_STATUS);const r=f.requests[0];f.transactions=[{gateway_transaction_id:'tx',reference:r.reference,account_key:'trust',currency:'USD',amount_cents:100000,status:'processing'}];assert.equal((await f.call('advance',{confirmed:true})).code,409);f.transactions[0].amount_cents=500000;assert.equal((await f.call('advance',{confirmed:true})).code,200);assert.equal(f.m.matter_status,model.CLIENT_STATUS)})
test('missing request and changed amount fail closed',async()=>{const f=fixture();f.m.matter_status=model.CONSULT_STATUS;f.w.state={signature:{id:'sign',status:'signed'},retainer:{status:'paid'}};f.signComplete=true;assert.equal((await f.call('advance',{confirmed:true})).code,409);await f.call('prepare_engagement');f.requests[0].amount_cents=100;f.transactions=[{gateway_transaction_id:'tx',reference:f.requests[0].reference,account_key:'trust',currency:'USD',amount_cents:100,status:'paid'}];assert.equal((await f.call('advance',{confirmed:true})).code,409)})
test('provider outage cannot satisfy final gate',async()=>{const f=fixture();f.m.matter_status=model.CONSULT_STATUS;await f.call('prepare_engagement');f.w.state.signature={id:'sign',status:'signed'};const r=f.requests[0];f.transactions=[{gateway_transaction_id:'tx',reference:r.reference,account_key:'trust',currency:'USD',amount_cents:500000,status:'paid'}];f.failProvider=true;assert.equal((await f.call('advance',{confirmed:true})).code,409);assert.equal(f.w.state.signature.status,'unverified')})
test('email retries need review and calendar retries reuse transaction ID',async()=>{const f=fixture();const a=await f.call('claim_delivery',{kind:'calendar'}),b=await f.call('claim_delivery',{kind:'calendar'});assert.equal(a.body.workflow.state.calendar_delivery.reference,b.body.workflow.state.calendar_delivery.reference);assert.equal((await f.call('claim_delivery',{kind:'consult'})).code,200);assert.equal((await f.call('claim_delivery',{kind:'consult'})).code,409);assert.equal((await f.call('reset_delivery',{kind:'consult',confirmed:true})).code,200);assert.equal((await f.call('claim_delivery',{kind:'consult'})).code,200)})
test('outbound credit never counts as incoming retainer',()=>{const r={id:'r',reference:'ref',amount_cents:500000,account_key:'trust'};const t={gateway_transaction_id:'credit',reference:'ref',amount_cents:500000,account_key:'trust',currency:'USD',transaction_type:'CREDIT',status:'COMPLETED'};assert.notEqual(model.paymentEvidence([t],r).status,'paid')})

test('confirmed consultation resend records both recipients and preserves the first send',async()=>{
 const f=fixture(),first=await f.call('claim_delivery',{kind:'consult',recipient:f.m.clients.email,subject:'Consultation',body:'First message'})
 const reference=first.body.workflow.state.consult_delivery.reference
 assert.equal((await f.call('record_delivery',{kind:'consult',status:'sent',reference})).code,200)
 f.m.clients.email='corrected@example.test'
 assert.equal((await f.call('claim_delivery',{kind:'consult',recipient:f.m.clients.email})).code,409)
 const second=await f.call('claim_delivery',{kind:'consult',resend:true,previous_reference:reference,recipient:f.m.clients.email,subject:'Consultation again',body:'Second message'})
 assert.equal(second.code,200)
 const next=second.body.workflow.state.consult_delivery.reference
 assert.notEqual(next,reference)
 assert.equal((await f.call('record_delivery',{kind:'consult',status:'sent',reference})).code,409,'Late completion cannot mark a new attempt sent')
 assert.equal((await f.call('record_delivery',{kind:'consult',status:'sent',reference:next})).code,200)
 assert.deepEqual(f.w.state.email_history.map(x=>[x.recipient,x.status]),[['example@invalid.test','sent'],['corrected@example.test','sent']])
 assert.equal(f.w.state.email_history[0].body,'First message')
})

test('email history preserves legacy sent information without inventing recipient',async()=>{
 const f=fixture();f.w.state.consult_delivery={status:'sent',at:'2026-10-01T12:00:00Z',reference:'legacy-send'}
 const r=await f.call('claim_delivery',{kind:'consult',resend:true,previous_reference:'legacy-send',recipient:f.m.clients.email,subject:'Resend'})
 assert.equal(r.code,200)
 assert.equal(f.w.state.email_history[0].legacy,true)
 assert.equal(f.w.state.email_history[0].at,'2026-10-01T12:00:00Z')
 assert.equal(f.w.state.email_history[0].recipient,null)
})

test('claim rejects a stale recipient and stale resend confirmation',async()=>{
 const f=fixture();assert.equal((await f.call('claim_delivery',{kind:'consult',recipient:'old@example.test'})).code,409)
 f.w.state.consult_delivery={status:'sent',reference:'latest'}
 assert.equal((await f.call('claim_delivery',{kind:'consult',resend:true,previous_reference:'older',recipient:f.m.clients.email})).code,409)
 assert.equal(f.w.state.consult_delivery.reference,'latest')
})

test('retry review keeps uncertain attempt in history and issues a new reference',async()=>{
 const f=fixture(),a=await f.call('claim_delivery',{kind:'consult',recipient:f.m.clients.email})
 const reference=a.body.workflow.state.consult_delivery.reference
 await f.call('reset_delivery',{kind:'consult',confirmed:true})
 assert.equal(f.w.state.email_history[0].status,'unknown')
 assert.equal((await f.call('record_delivery',{kind:'consult',reference,status:'sent'})).code,409)
 const b=await f.call('claim_delivery',{kind:'consult',recipient:f.m.clients.email})
 assert.notEqual(b.body.workflow.state.consult_delivery.reference,reference)
 assert.equal(f.w.state.email_history.length,2)
})

test('reused LawPay link reflects corrected payer email without making another request',async()=>{
 const f=fixture();await f.call('prepare_consult');f.requests[0].payment_url+='&email=wrong%40example.test';f.m.clients.email='corrected@example.test'
 const r=await f.call('prepare_consult')
 assert.equal(f.requests.length,1)
 assert.equal(new URL(r.body.workflow.state.consult_request.url).searchParams.get('email'),'corrected@example.test')
})

test('resend never includes an expired intake link; existing intake can be omitted',async()=>{
 const f=fixture();f.w.config.include_intake=true;f.w.config.intake_template={id:'form',questions:[{id:'q'}]};f.w.state.intake={id:'old-intake',url:'https://example.invalid/#client-intake/old',expires_at:'2020-01-01T00:00:00Z'}
 const blocked=await f.call('prepare_consult');assert.equal(blocked.code,409);assert.match(blocked.body.error,/intake link.*expired/i)
 assert.equal(f.requests.length,0)
 const saved=await f.call('save',{revision:f.w.revision,config:{include_intake:false}});assert.equal(saved.code,200)
 assert.equal((await f.call('prepare_consult')).code,200)
 assert.equal(f.w.state.intake.id,'old-intake','Omitting the intake preserves its existing record')
})
