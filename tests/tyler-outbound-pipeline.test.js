import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareTylerFilingIntent,validateTylerReviewReceipt,createTylerOutboundCoordinator} from '../lib/efiling/tylerOutboundPipeline.js'
import {createSupabaseTylerSubmissionRegistrar} from '../lib/efiling/tylerSubmissionRegistrar.js'
import {inspectTylerWsSecurityEnvelope} from '../lib/efiling/tylerWsSecurityInspection.js'
const draft={id:'d-1',matterId:'matter-1',documentId:'doc-1',courtLocationId:'court-1',causeNumber:'123-F',filingCode:'Motion',filingMode:'efile_only',paymentAccountId:'a-1',serviceContacts:[]}
const args={draft,ownerId:'owner-1',environment:'stage',idempotencyKey:'request-1'}
test('deterministic outbound preflight excludes source document and secrets',()=>{
 const prepared=prepareTylerFilingIntent(args)
 assert.equal(prepared.matterId,'matter-1')
 assert.equal(prepared.fingerprint,prepareTylerFilingIntent(args).fingerprint)
 assert.equal(prepared.documentId,'doc-1')
 assert.equal(Object.hasOwn(prepared,'documentUrl'),false)
})
test('service requires an email recipient and missing identifiers block request',()=>{
 assert.throws(()=>prepareTylerFilingIntent({...args,draft:{...draft,filingMode:'efile_and_serve'}}),/recipient/)
 assert.throws(()=>prepareTylerFilingIntent({...args,draft:{...draft,filingCode:''}}),/Filing code/)
 assert.throws(()=>prepareTylerFilingIntent({...args,environment:'productionX'}),/environment/)
})
test('a client boolean alone cannot enable sending',async()=>{
 let sent=0
 const s=createTylerOutboundCoordinator({enabled:false,transport:{submitVerified:async()=>{sent++}},registerSubmission:async()=>{},loadExisting:async()=>null})
 await assert.rejects(()=>s.submit(args),/disabled/)
 assert.equal(sent,0)
})
test('outgoing transport needs a durable once-only reservation',async()=>{
 const s=createTylerOutboundCoordinator({enabled:true,transport:{submitVerified:async()=>({})},registerSubmission:async()=>{},loadExisting:async()=>null})
 await assert.rejects(()=>s.submit(args),/durable idempotency/)
})
test('a result must be verified and real, not mock IDs',()=>{
 assert.throws(()=>validateTylerReviewReceipt({environment:'stage',envelopeId:'abc',filingId:'def'},'stage'),/cryptographic/)
 assert.throws(()=>validateTylerReviewReceipt({environment:'production',signatureVerified:true,sourceVerified:true,envelopeId:'abc',filingId:'def'},'stage'),/environment/)
 assert.throws(()=>validateTylerReviewReceipt({environment:'stage',signatureVerified:true,sourceVerified:true,envelopeId:'mock-1',filingId:'def'},'stage'),/Mock/)
})
test('verified result registers owner/matter and does not replay a previously known submission',async()=>{
 let sent=0,registered=null
 const transport={reserveOnce:async i=>({fingerprint:i.fingerprint,acquired:true}),submitVerified:async()=>{sent++;return {environment:'stage',signatureVerified:true,sourceVerified:true,envelopeId:'e1',filingId:'f1'}}}
 const s=createTylerOutboundCoordinator({enabled:true,transport,registerSubmission:async x=>{registered=x},loadExisting:async()=>null})
 const value=await s.submit(args)
 assert.equal(value.envelopeId,'e1')
 assert.equal(registered.ownerId,'owner-1')
 assert.equal(registered.matterId,'matter-1')
 assert.equal(sent,1)
 const existing=createTylerOutboundCoordinator({enabled:true,transport,registerSubmission:async()=>{},loadExisting:async()=>({submissionId:'existing-id'})})
 assert.equal((await existing.submit(args)).existing,true)
 assert.equal(sent,1)
})
test('ambiguous network errors forbid automatic resend and skip ledger registration',async()=>{
 let registered=0
 const transport={reserveOnce:async i=>({fingerprint:i.fingerprint,acquired:true}),submitVerified:async()=>{throw Error('timeout')}}
 const s=createTylerOutboundCoordinator({enabled:true,transport,registerSubmission:async()=>registered++,loadExisting:async()=>null})
 await assert.rejects(()=>s.submit(args),/uncertain; reconcile/)
 assert.equal(registered,0)
})
test('Supabase registrar writes only through verified server-side RPC',async()=>{
 const calls=[]
 const rpc=async(name,params)=>{calls.push({name,params});return {data:'uuid-1',error:null}}
 const register=createSupabaseTylerSubmissionRegistrar({rpc})
 const r=await register({ownerId:'o',matterId:'m',environment:'stage',envelopeId:'e',filingId:'f'})
 assert.deepEqual(r,{submissionId:'uuid-1'})
 assert.equal(calls[0].name,'mio_register_efiling_submission_v1')
 assert.equal(calls[0].params.p_matter_id,'m')
})
test('WS-Security inspector explicitly refuses to certify an unsigned SOAP request',()=>{
 assert.throws(()=>inspectTylerWsSecurityEnvelope('<Envelope/>'),/SOAP 1.1/)
 const xml='<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body/></s:Envelope>'
 assert.throws(()=>inspectTylerWsSecurityEnvelope(xml),/WS-Security/)
})
