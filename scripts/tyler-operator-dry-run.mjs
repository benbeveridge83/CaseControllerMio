// Operator dry run for the Tyler e-filing outcome surface, using synthetic data.
// No Tyler transport, no Supabase write, no network call. It exercises the
// non-Tyler validation surface (filing intent, fee authorization, service
// result, status classification) so an operator can confirm the plumbing
// without touching Tyler or a client matter.
import { prepareTylerFilingIntent } from '../lib/efiling/tylerOutboundPipeline.js'
import {
  validateTylerFeeAuthorization,
  validateTylerServiceResult,
  classifyTylerFilingState,
} from '../lib/efiling/tylerFilingOutcome.js'

const draft = {
  id: 'dry-run-1',
  matterId: 'synthetic-matter',
  documentId: 'synthetic-doc',
  courtLocationId: 'court-311',
  causeNumber: '2026-00000',
  filingCode: 'Motion',
  filingMode: 'efile_only',
  paymentAccountId: 'acct-synthetic',
  serviceContacts: [],
}

const plan = {
  paymentAccountId: 'acct-synthetic',
  maxFeeAmountCents: 35000,
  feeWaiver: false,
  billedToClient: true,
}

const feeQuote = {
  source: 'tyler_stage',
  verifiedByServer: true,
  paymentAccountId: 'acct-synthetic',
  feeAmountCents: 1500,
  quoteId: 'synthetic-quote',
}

const intent = prepareTylerFilingIntent({ draft, ownerId: 'synthetic-owner', environment: 'stage', idempotencyKey: 'dry-run-key-1' })
const fee = validateTylerFeeAuthorization({ feeQuote, plan })
const service = validateTylerServiceResult({ filingMode: draft.filingMode })
const state = classifyTylerFilingState({ submission: { status: 'submitted' } })

console.log(JSON.stringify({
  dryRun: true,
  sent: false,
  networkCallMade: false,
  intentFingerprint: intent.fingerprint,
  feeAuthorized: fee.authorized,
  feeAmountCents: fee.feeAmountCents,
  billedToClient: fee.billedToClient,
  serviceServed: service.served,
  classifiedState: state,
}, null, 2))
