// Service-role-only adapter; never import into browser code.
// Called after a cryptographically verified Tyler outbound response.
// The related HTTP submitter remains intentionally DISABLED.
export function createSupabaseTylerSubmissionRegistrar(serviceClient) {
 if (!serviceClient?.rpc) throw new Error('Server-side Supabase client is required.')
 return async function registerSubmission({
   ownerId,matterId,environment,envelopeId,filingId,draftId,
 }) {
   if(!ownerId || !matterId || !['stage','production'].includes(environment) ||
      !envelopeId || !filingId) throw new Error('Incomplete verified Tyler filing reference.')
   const {data,error}=await serviceClient.rpc('mio_register_efiling_submission_v1',{
     p_owner_id:ownerId,p_matter_id:String(matterId),p_environment:environment,
     p_envelope_id:envelopeId,p_filing_id:filingId,p_draft_id:draftId||null,
   })
   if(error) throw new Error(error.message||'Tyler submission registration failed.')
   if(!data) throw new Error('Tyler submission registration returned no ID.')
   return {submissionId:data}
 }
}
