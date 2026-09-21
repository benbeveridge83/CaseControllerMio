// Attribution rules for provider charges that arrived without a Mio invoice reference
// (payments taken directly in LawPay rather than through a Mio payment link). Pure rules
// only: nothing here writes money, reads a database, or guesses a matter from a payer name.
// A trust charge may only ever become a trust-ledger entry for the matter a human selected,
// an operating charge may never touch a trust balance, and an undetermined account is
// refused rather than assumed.
import { completedPayment, lawPayAccountLabel, transactionAccountKey } from './mioFinanceReview.js'

export const ATTRIBUTION_DECISIONS = ['matter', 'pnc', 'neither']
const trustKeys = new Set(['trust', 'echeck_trust', 'clientcredit_trust'])
const operatingKeys = new Set(['operating', 'echeck_operating'])
export const MONEY_OUT_TYPES = ['REFUND', 'REVERSAL', 'CHARGEBACK']

export function lawPayTransactionId(tx = {}) {
  return String(tx?.gateway_transaction_id || tx?.id || '').trim()
}
export function transactionMoneyOut(tx = {}) {
  return MONEY_OUT_TYPES.includes(String(tx?.transaction_type || tx?.type || '').toUpperCase())
}
export function accountKind(key) {
  const value = String(key || '').trim().toLowerCase()
  return trustKeys.has(value) ? 'trust' : operatingKeys.has(value) ? 'operating' : ''
}

export function lawPayAttributionEntry({ transaction = {}, decision = '', matter = null, pnc = null, reason = '', actor = '', occurredAt = '' } = {}) {
  const id = lawPayTransactionId(transaction)
  if (!id) return { ok: false, error: 'This LawPay transaction has no stable provider ID, so it cannot be attributed.' }
  if (!ATTRIBUTION_DECISIONS.includes(decision)) return { ok: false, error: 'Choose whether this payment belongs to a matter, to a PNC, or to neither.' }
  if (!completedPayment(transaction.status)) return { ok: false, error: 'Only a completed LawPay transaction can be attributed. Pending or void charges are left alone.' }
  const account = transactionAccountKey(transaction)
  const kind = accountKind(account)
  const label = lawPayAccountLabel(transaction)
  const at = occurredAt || new Date().toISOString()
  const base = { gateway_transaction_id: id, decision, account, account_label: label, amount: Math.round(Number(transaction.amount_cents) || 0) / 100, money_out: transactionMoneyOut(transaction), attributed_by: String(actor || ''), attributed_at: at }
  if (decision === 'neither') {
    if (!String(reason || '').trim()) return { ok: false, error: 'Say why this payment belongs to neither, so the decision is reviewable later.' }
    return { ok: true, entry: null, record: { ...base, reason: String(reason).trim() }, matter: null }
  }
  if (!matter?.id) return { ok: false, error: decision === 'pnc' ? 'Select the PNC this payment belongs to.' : 'Select the matter this payment belongs to.' }
  if (decision === 'pnc' && !pnc?.id) return { ok: false, error: 'Associate a PNC only when the payment is that PNC consultation fee or retainer.' }
  if (!kind) return { ok: false, error: `Mio reported the deposit account as "${label}", so it cannot tell trust money from operating money. Confirm the LawPay charge, rescan, and attribute it again.` }
  const record = { ...base, matter_id: String(matter.id), matter_name: String(matter.name || ''), client_id: String(matter.client_id || ''), pnc_workflow_id: decision === 'pnc' ? String(pnc.id) : '', pnc_kind: decision === 'pnc' ? String(pnc.kind || '') : '' }
  // Operating money never moves a client trust balance, and a trust deposit is the only
  // thing this screen may add to one. An operating charge is recorded for accounting
  // attribution and shown in matter accounting, not posted as a trust deposit.
  if (kind === 'operating') {
    return { ok: true, entry: null, operating: true, record: { ...record, entry_kind: 'operating_association', note: 'Operating payment recorded for attribution; operating money never moves trust.' }, matter }
  }
  // A refund, reversal, or chargeback takes money back out of the client's trust balance.
  const out = base.money_out
  const entry = {
    id: crypto?.randomUUID ? crypto.randomUUID() : `lawpay-attribution-${id}-${Date.now()}`,
    matter_id: String(matter.id),
    client_id: String(matter.client_id || ''),
    date: String(transaction.occurred_at || at).slice(0, 10),
    direction: out ? 'out' : 'in',
    transaction_type: out ? 'refund' : 'lawpay',
    amount: base.amount,
    payer_payee: String(transaction.payer_name || transaction.payer_email || ''),
    reference: String(transaction.reference || '').trim(),
    memo: `${out ? 'LawPay refund attributed to' : 'Digital payment through LawPay attributed to'} ${String(matter.name || 'this matter')}${decision === 'pnc' ? ` (PNC ${pnc.kind || 'payment'})` : ''}`,
    lawpay_transaction_id: id,
    payment_request_id: String(transaction.raw?.mio_payment_request_id || ''),
    source: 'Mio LawPay attribution',
    attribution_key: id,
    created_at: at
  }
  return { ok: true, entry, record: { ...record, entry_kind: out ? 'trust_refund' : 'trust_deposit' }, matter }
}
// A charge that already produced a trust-ledger row must never be posted twice, even if
// the same window is open on two devices. The provider ID is the identity, not the amount.
export function duplicateLawPayAttribution(rows = [], transaction = {}) {
  const id = lawPayTransactionId(transaction)
  if (!id) return false
  return (rows || []).some((row) => String(row?.lawpay_transaction_id || row?.attribution_key || '') === id)
}
export function lawPayAttributionState(records = [], transaction = {}) {
  const id = lawPayTransactionId(transaction)
  if (!id) return 'undecided'
  return (records || []).some((record) => String(record?.gateway_transaction_id || '') === id) ? 'attributed' : 'undecided'
}
export function lawPayAttributionSummary(record = {}, { matterName = '', pncLabel = '' } = {}) {
  if (!record || !record.decision) return ''
  const account = record.account_label || 'Account not reported'
  if (record.decision === 'neither') return `${account} - decided: neither (${record.reason || 'reason not recorded'})`
  const destination = record.decision === 'pnc' ? pncLabel || record.matter_name || 'PNC' : matterName || record.matter_name || 'Matter'
  const what = record.entry_kind === 'trust_deposit' ? 'trust deposit' : record.entry_kind === 'trust_refund' ? 'trust refund' : 'operating record'
  return `${account} - ${what} - ${destination}`
}
