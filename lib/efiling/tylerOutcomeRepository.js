// Tyler ECF5 filing receipts and e-service result persistence (SERVER + UI).
//
// The same repository is used two ways:
//   * a service-role client for recordReceipt / recordServiceResult (server-only
//     writes; the browser never inserts these rows), and
//   * the caller's own client for listReceipts / listServiceResults, so Supabase
//     RLS scopes reads to the caller's matters and cross-matter access is denied.
import { classifyTylerFilingState, TYLER_RECEIPT_KIND, TYLER_SERVICE_OUTCOME } from './tylerFilingOutcome.js'

export function createSupabaseTylerOutcomeRepository(client) {
  if (!client?.from) throw new Error('A Supabase client is required.')

  async function recordReceipt({ ownerId, matterId, submissionId = null, kind, storagePath, sha256, fileName = null }) {
    if (!Object.values(TYLER_RECEIPT_KIND).includes(kind)) throw new Error('Unknown receipt kind.')
    if (!ownerId || !matterId || !storagePath || !/^[a-f0-9]{64}$/.test(sha256 || '')) throw new Error('Incomplete filing receipt.')
    const { data, error } = await client.from('mio_efiling_filing_receipts').insert({
      owner_id: ownerId, matter_id: matterId, submission_id: submissionId || null,
      kind, storage_path: storagePath, sha256, file_name: fileName,
    }).select().single()
    if (error) throw new Error(error.message || 'Failed to record filing receipt.')
    return data
  }

  async function recordServiceResult({ ownerId, matterId, submissionId = null, serviceContactId, outcome }) {
    if (!TYLER_SERVICE_OUTCOME.includes(outcome)) throw new Error('Unknown service delivery outcome.')
    if (!ownerId || !matterId || !serviceContactId) throw new Error('Incomplete service result.')
    const { data, error } = await client.from('mio_efiling_service_results').insert({
      owner_id: ownerId, matter_id: matterId, submission_id: submissionId || null,
      service_contact_id: serviceContactId, outcome,
    }).select().single()
    if (error) throw new Error(error.message || 'Failed to record service result.')
    return data
  }

  async function listReceipts(ownerId, matterId) {
    const { data, error } = await client.from('mio_efiling_filing_receipts')
      .select('id,submission_id,kind,storage_path,sha256,file_name,received_at')
      .eq('owner_id', ownerId).eq('matter_id', matterId)
      .order('received_at', { ascending: false })
    if (error) {
      if (error.code === 'PGRST205') return []
      throw new Error(error.message)
    }
    return data || []
  }

  async function listServiceResults(ownerId, matterId) {
    const { data, error } = await client.from('mio_efiling_service_results')
      .select('id,submission_id,service_contact_id,outcome,recorded_at')
      .eq('owner_id', ownerId).eq('matter_id', matterId)
      .order('recorded_at', { ascending: false })
    if (error) {
      if (error.code === 'PGRST205') return []
      throw new Error(error.message)
    }
    return data || []
  }

  return Object.freeze({ recordReceipt, recordServiceResult, listReceipts, listServiceResults })
}

/**
 * Combine a submission, its receipts and its service results into a single
 * classified outcome for the matter UI.
 */
export function classifyTylerOutcome({ submission, receipts = [], serviceResults = [] } = {}) {
  const served = (serviceResults || []).some((r) => r?.outcome === 'delivered')
  return Object.freeze({
    state: classifyTylerFilingState({ submission, serviceDelivered: served }),
    receipts: Object.freeze((receipts || []).map((r) => Object.freeze({ ...r }))),
    serviceResults: Object.freeze((serviceResults || []).map((r) => Object.freeze({ ...r }))),
  })
}
