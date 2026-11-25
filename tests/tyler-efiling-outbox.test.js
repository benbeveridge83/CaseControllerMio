import test from 'node:test'
import assert from 'node:assert/strict'
import {createSupabaseTylerOutbox} from '../lib/efiling/tylerOutboxRepository.js'

const intent={ownerId:'owner',matterId:'matter',environment:'stage',idempotencyKey:'key',fingerprint:'a'.repeat(64)}
function makeClient({previous=null}={}) {
 const calls=[]
 const client={
  rpc: async(name,args)=>{
   calls.push({name,args})
   if(name==='mio_reserve_efiling_outbound_v1')return {data:{acquired:true,fingerprint:intent.fingerprint},error:null}
   return {data:{confirmed:true},error:null}
  },
  from:table=>{
   assert.equal(table,'mio_efiling_outbox')
   const filters=[]
   const q={select:()=>q,eq:(field,value)=>{filters.push([field,value]);return q},
    maybeSingle:async()=>{calls.push({name:'lookup',filters});return {data:previous,error:null}}}
   return q
  },
 }
 return {calls,outbox:createSupabaseTylerOutbox(client)}
}
test('outbox reserves exactly once with original owner and matter',async()=>{
 const {calls,outbox}=makeClient()
 const first=await outbox.reserveOnce(intent)
 assert.equal(first.acquired,true)
 assert.equal(calls[0].args.p_owner_id,'owner')
 assert.equal(calls[0].args.p_fingerprint,intent.fingerprint)
 const prior=await outbox.loadExisting(intent)
 assert.equal(prior,null)
 assert.deepEqual(calls[1].filters,[['owner_id','owner'],['environment','stage'],['idempotency_key','key']])
})
test('confirmed outbox avoids another external submission',async()=>{
 const {outbox}=makeClient({previous:{state:'confirmed',envelope_id:'e',filing_id:'f',fingerprint:intent.fingerprint,matter_id:'matter'}})
 assert.deepEqual(await outbox.loadExisting(intent),{environment:'stage',envelopeId:'e',filingId:'f'})
})
test('outbox cannot silently reuse a request ID with different fingerprint',async()=>{
 const {outbox}=makeClient({previous:{state:'confirmed',envelope_id:'e',filing_id:'f',fingerprint:'b'.repeat(64),matter_id:'matter'}})
 await assert.rejects(()=>outbox.loadExisting(intent),/Conflicting/)
})
test('confirmed status and uncertainty use separate service-only RPCs',async()=>{
 const {calls,outbox}=makeClient()
 await outbox.registerSubmission({...intent,envelopeId:'e',filingId:'f',draftId:'d'})
 await outbox.markUncertain(intent)
 assert.equal(calls[0].name,'mio_confirm_efiling_outbound_v1')
 assert.equal(calls[0].args.p_draft_id,'d')
 assert.equal(calls[1].name,'mio_mark_efiling_outbound_uncertain_v1')
})
