// Service-only outbox adapter. Must be instantiated with the secret-key
// Supabase client in a server function, never in a browser bundle.
export function createSupabaseTylerOutbox(serviceClient) {
 if(!serviceClient?.rpc || !serviceClient?.from) throw new Error('Server-side Supabase client required.')
 async function invoke(name,args) {
  const {data,error}=await serviceClient.rpc(name,args)
  if(error) throw new Error(error.message || name+' failed.')
  return data
 }
 return {
  async loadExisting(intent) {
   const {data,error}=await serviceClient.from('mio_efiling_outbox')
    .select('state,envelope_id,filing_ids,fingerprint,matter_id')
    .eq('owner_id',intent.ownerId).eq('environment',intent.environment)
    .eq('idempotency_key',intent.idempotencyKey).maybeSingle()
   if(error) throw new Error(error.message||'Cannot check previous filing.')
   if(!data) return null
   if(data.fingerprint!==intent.fingerprint || data.matter_id!==intent.matterId)
    throw new Error('Conflicting filing request ID.')
   if(data.state==='confirmed' && data.envelope_id && data.filing_ids?.length)
    return {environment:intent.environment,envelopeId:data.envelope_id,filingIds:data.filing_ids}
   // Reserved/uncertain is intentionally not an existing success; reserveOnce
   // will return acquired=false, and the network call will be blocked.
   return null
  },
  async reserveOnce(intent) {
   return invoke('mio_reserve_efiling_outbound_v1',{
    p_owner_id:intent.ownerId,p_matter_id:intent.matterId,
    p_environment:intent.environment,p_idempotency_key:intent.idempotencyKey,
    p_fingerprint:intent.fingerprint,
   })
  },
  async registerSubmission(intentAndReceipt) {
   return invoke('mio_confirm_efiling_outbound_v1',{
    p_owner_id:intentAndReceipt.ownerId,p_environment:intentAndReceipt.environment,
    p_idempotency_key:intentAndReceipt.idempotencyKey,
    p_fingerprint:intentAndReceipt.fingerprint,
    p_envelope_id:intentAndReceipt.envelopeId,p_filing_ids:intentAndReceipt.filingIds,
    p_draft_id:intentAndReceipt.draftId||null,
   })
  },
  async markUncertain(intent) {
   return invoke('mio_mark_efiling_outbound_uncertain_v1',{
    p_owner_id:intent.ownerId,p_environment:intent.environment,
    p_idempotency_key:intent.idempotencyKey,
   })
  },
 }
}
