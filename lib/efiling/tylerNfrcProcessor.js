// Authenticated notification pipeline. This function must ONLY be called by
// a server-side transport adapter AFTER Tyler's signed WS-Security token has
// been cryptographically checked using a trusted Stage/Production issuer.
import { createHash } from 'node:crypto'
import { parseTylerNfrcMetadata } from './tylerNfrcContract.js'
import { buildTylerNfrcSoapAcknowledgment } from './tylerNfrcResponse.js'

export async function processVerifiedTylerNotification({
  rawXml, environment, security, resolveStatus, recordReceipt,
}) {
  if (!security || security.signatureVerified !== true || security.trustedIssuer !== true ||
      security.timestampVerified !== true || security.replayChecked !== true) {
    throw new Error('Tyler callback security verification required.')
  }
  if (!['stage', 'production'].includes(environment)) throw new Error('Unknown EFM environment.')
  if (typeof resolveStatus !== 'function' || typeof recordReceipt !== 'function')
    throw new Error('Status resolver and persistent receipt recorder are required.')
  const parsed = parseTylerNfrcMetadata(rawXml)
  // The sample NFRC does not offer a reliable binary filing decision; a
  // configured Stage-tested status resolver must decide or return unknown.
  const status = await resolveStatus({metadata: parsed, environment})
  if (!['accepted','rejected','under_review','unknown'].includes(status)) {
    throw new Error('Status resolver did not return a recognized state.')
  }
  const payloadSha256 = createHash('sha256').update(rawXml, 'utf8').digest('hex')
  // Database RPC must atomically match the prior outbound filing and owner,
  // insert a unique (environment,message_id) receipt and update status.
  const recorded = await recordReceipt({
    environment, messageId: parsed.messageId, envelopeId: parsed.envelopeId,
    filingId: parsed.filingId, outcome: status,
    payloadSha256, comments: parsed.reviewerComments,
    completionDate: parsed.completionDate,
  })
  if (!recorded || !recorded.submission_id) throw new Error('Receipt was not durably persisted.')
  return {
    result: recorded,
    acknowledgment: buildTylerNfrcSoapAcknowledgment({messageId: parsed.messageId}),
  }
}

export function createSupabaseTylerReceiptRecorder(serviceClient) {
 if (!serviceClient?.rpc) throw new Error('Server-side Supabase client required.')
 return async ({environment,messageId,envelopeId,filingId,outcome,payloadSha256,comments,completionDate}) => {
   const {data,error} = await serviceClient.rpc('mio_record_efiling_callback_v1', {
     p_environment:environment, p_message_id:messageId, p_envelope_id:envelopeId,
     p_filing_id:filingId, p_outcome:outcome, p_payload_sha256:payloadSha256,
     p_comments:comments||null, p_completion_date:completionDate||null,
   })
   if(error) throw new Error(error.message || 'Failed to record Tyler callback.')
   return data
 }
}
