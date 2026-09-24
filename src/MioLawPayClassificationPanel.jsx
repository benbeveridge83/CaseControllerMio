// Matter Dashboard -> Finances: LawPay payment classification (V323).
//
// The three decisions are separate controls because they are separate questions: ownership,
// the actual deposit account, and what the transaction was. Nothing here derives an account
// from a payer, a matter or an invoice, and nothing here moves money by itself: the preview
// shows exactly what the gateway will record before the reviewer asks for it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { ACCOUNT_KEYS, accountFamily, accountProvenanceLabel, providerAccountOutcome } from './mioLawPayAccounts.js'
import {
  CATEGORIES, OTHER_REASONS, REVIEW_STATUS_LABELS, amountBreakdown, categoryById, categoryDirection, correctionPreview,
  duplicateClassification, existingEntryMatch, ledgerPlan, manualAccountVerification, postingEligibility,
  postingPreview, providerMoneyOut, refundResolutionRecord, refundReview, reviewStatus, suggestions, validateClassification,
} from './mioLawPayClassification.js'

const ACCOUNT_LABELS = {
  trust: 'IOLTA trust account',
  operating: 'Firm operating account',
  echeck_trust: 'eCheck IOLTA trust account',
  echeck_operating: 'eCheck firm operating account',
  clientcredit_trust: 'Client credit held in trust',
}
// Account wording and money formatting stay inside this panel: nothing else renders them, and a
// module that exports both a component and helpers breaks fast refresh.
function accountLabel(key) { return ACCOUNT_LABELS[String(key || '')] || String(key || 'unknown account') }
function money(cents) { return `$${(Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
const providerIdOf = (transaction) => String(transaction?.gateway_transaction_id || transaction?.id || '')

// The account decision has three states, and the reviewer always sees which one applies: the
// provider reported it, Mio resolved it from the firm's own mapping, or a person verified it
// against evidence and signed for it. A blank provider account is never guessed from the payer.
function accountDecision(transaction = {}, manual = null) {
  if (manual?.verification) {
    return { account_key: manual.verification.account_key, provenance: 'manually_verified', label: accountProvenanceLabel({ state: accountFamily(manual.verification.account_key), provenance: 'manually_verified' }), detail: `${manual.verification.verified_by} · ${manual.verification.evidence_reference}` }
  }
  const outcome = providerAccountOutcome({ transaction })
  const label = accountProvenanceLabel(outcome)
  // Two different conditions, said differently. A supplied-but-unmapped account is Mio's own gap
  // and is fixed once, for every transaction carrying that identifier. A missing identifier is the
  // provider's, and only a person can establish the account from evidence.
  if (outcome.state === 'not_supplied') {
    return { account_key: '', provenance: '', label, detail: 'LawPay supplied no deposit account for this transaction, so Mio cannot tell trust money from operating money. Verify the actual account against evidence.' }
  }
  if (outcome.state === 'unmapped') {
    return { account_key: '', provenance: '', label, detail: 'LawPay named this deposit account and Mio has no mapping for it yet. Map this provider account once and every transaction carrying it resolves automatically; the client, matter or PNC is still chosen here.' }
  }
  // The provider's own account name and the Mio account name are often the same words; say it once.
  const parts = [accountLabel(outcome.account_key), String(outcome.label || '')].filter((part) => part && part !== outcome.account_key)
  return { account_key: outcome.account_key, provenance: 'reported_by_lawpay', label, detail: parts.filter((part, index) => parts.indexOf(part) === index).join(' · ') }
}

async function callGateway(action, body = {}) {
  const { data, error } = await supabase.functions.invoke('lawpay-gateway', { body: { action, ...body } })
  if (error) throw new Error(error.message || 'The LawPay gateway could not be reached.')
  if (data?.error) throw new Error(data.error)
  return data
}
export default function MioLawPayClassificationPanel({
  matter = null, matters = [], transactions = [], classifications = [], invoices = [], existingEntries = [], accounts = [], refundResolutions = [],
  mappingAvailable = true, busy = false, error = '', notice = '', onRefresh, onActed,
}) {
  const [openId, setOpenId] = useState('')
  const [drafts, setDrafts] = useState({})
  const [messages, setMessages] = useState({})
  const [working, setWorking] = useState('')
  const [refundBusy, setRefundBusy] = useState('')
  const [refundMessage, setRefundMessage] = useState('')
  const [refundEvidence, setRefundEvidence] = useState({})
  // Guards a decision that is already in flight for a payment, so a double click cannot record it twice.
  const inFlightRef = useRef('')
  const [expanded, setExpanded] = useState(false)
  const scoped = useMemo(() => (transactions || []).filter((transaction) => providerIdOf(transaction)), [transactions])
  const posted = useMemo(() => (classifications || []).filter((record) => String(record.posting_status || '') === 'posted'), [classifications])
  const anyFor = (transaction) => (classifications || []).find((record) => String(record.gateway_transaction_id || '') === providerIdOf(transaction)) || null
  const decisionsFor = (id) => drafts[id] || { ownership: 'matter', category: '', matter_id: String(matter?.id || ''), pnc_workflow_id: '', other_reason: '', invoice_id: '', explanation: '', manual_key: '', manual_evidence: '', manual_explanation: '', entry_id: '', correction_reason: '', correction_key: '', correction_evidence: '', correction_explanation: '' }
  const patch = (id, change) => setDrafts((current) => ({ ...current, [id]: { ...decisionsFor(id), ...change } }))
  const outstanding = scoped.filter((transaction) => reviewStatus({ record: anyFor(transaction) }) !== 'recorded_in_mio')
  // Refunds whose relationship to a charge is not established by a provider identifier are shown
  // as unresolved, never netted against a charge's reported total just because they share an
  // account. The reconciled total is explicitly not final while any remain.
  const recordedIds = new Set((classifications || []).filter((record) => !matter?.id || String(record.matter_id || '') === String(matter.id)).map((record) => String(record.gateway_transaction_id || '')))
  const recordedAccounts = new Set((transactions || []).filter((transaction) => recordedIds.has(String(transaction.gateway_transaction_id || ''))).map((transaction) => String(transaction.account_id || '')))
  const refundScope = (transactions || []).filter((transaction) => recordedIds.has(String(transaction.gateway_transaction_id || '')) || (providerMoneyOut(transaction) && recordedAccounts.has(String(transaction.account_id || ''))))
  const resolutionsByRefund = Object.fromEntries((refundResolutions || []).map((row) => [String(row.refund_transaction_id || ''), row]))
  const refunds = refundReview({ transactions: refundScope, resolutions: resolutionsByRefund })
  const openRefunds = refunds.effects.filter((effect) => effect.effect !== 'already_reflected')
  async function resolveRefund(refundId, resolution, evidence) {
    const refund = (transactions || []).find((transaction) => String(transaction.gateway_transaction_id || '') === refundId) || {}
    const chargeId = resolution === 'same_refund' ? String((classifications || []).find((record) => (!matter?.id || String(record.matter_id || '') === String(matter.id)) && ['posted', 'reversed'].includes(String(record.posting_status || '')))?.gateway_transaction_id || '') : ''
    const decision = refundResolutionRecord({
      refund, charge: { gateway_transaction_id: chargeId }, resolution, evidence_reference: evidence,
      actor: (await supabase.auth.getUser()).data?.user?.email || 'unknown reviewer',
      previous: resolutionsByRefund[refundId] || null,
    })
    if (!decision.ok) { setRefundMessage(decision.errors.join(' ')); return }
    setRefundBusy(refundId)
    try {
      await callGateway('resolve_refund', { resolution: decision.record })
      setRefundMessage(resolution === 'same_refund'
        ? 'Recorded as the same refund: it is counted once, through the charge’s own reported total.'
        : 'Recorded as a separate refund: its own refund effect is now included.')
      if (onActed) await onActed()
    } catch (failure) { setRefundMessage(failure.message) } finally { setRefundBusy('') }
  }
  // The panel loads its own records when it appears on a matter's Finances view, so the gateway
  // is only asked for financial data while somebody is actually looking at it. `onRefresh` is
  // deliberately not a dependency: the parent recreates it each render.
  const matterIdForLoad = String(matter?.id || '')
  useEffect(() => {
    if (onRefresh) onRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterIdForLoad])
  const planFor = (transaction, draft) => ledgerPlan({
    transaction, category: draft.category, resolvedAccount: accountDecision(transaction, draft.manual_key ? { verification: { account_key: draft.manual_key, verified_by: 'you', evidence_reference: draft.manual_evidence } } : null),
    matter: { id: draft.matter_id, name: String(matter?.name || '') },
    invoice: draft.invoice_id ? { id: draft.invoice_id, invoice_number: draft.invoice_id } : null,
  })
  // A second click, a retry or a replay must not record the same payment twice: the marker is set
  // before the first await, and cleared on every path out of the decision.
  async function submit(action, transaction, mode) {
    const id = providerIdOf(transaction)
    if (inFlightRef.current === id) {
      setMessages((current) => ({ ...current, [id]: 'That decision is already being sent. Nothing else will be recorded for this payment.' }))
      return
    }
    inFlightRef.current = id
    try {
      await submitDecision(action, transaction, mode)
    } finally {
      inFlightRef.current = ''
    }
  }
  async function submitDecision(action, transaction, mode) {
    const id = providerIdOf(transaction)
    const draft = decisionsFor(id)
    // A correction uses the account chosen for the correction when the money actually reached a
    // different account, and that account is verified with evidence exactly like a first posting.
    const correcting = action === 'correct'
    const verification = correcting && draft.correction_key
      ? { account_key: draft.correction_key, evidence_reference: draft.correction_evidence, explanation: draft.correction_explanation }
      : draft.manual_key
        ? { account_key: draft.manual_key, evidence_reference: draft.manual_evidence, explanation: draft.manual_explanation }
        : null
    const manual = verification ? manualAccountVerification({
      ...verification, actor: (await supabase.auth.getUser()).data?.user?.email || 'unknown reviewer',
    }) : null
    if (verification && !manual.ok) { setMessages((current) => ({ ...current, [id]: manual.errors.join(' ') })); return }
    const decision = accountDecision(transaction, manual)
    const record = {
      gateway_transaction_id: providerIdOf(transaction), provider_account_id: String(transaction.account_id || ''),
      ownership: draft.ownership, matter_id: draft.matter_id, pnc_workflow_id: draft.pnc_workflow_id,
      other_reason: draft.other_reason, actual_account_key: decision.account_key, account_source: decision.provenance,
      account_evidence: manual?.verification?.evidence_reference || '', account_explanation: manual?.verification?.explanation || '',
      category: draft.category, direction: categoryDirection(draft.category), explanation: draft.explanation,
      invoice_id: draft.invoice_id, matched_entry_id: draft.entry_id, matched_entry_source: draft.entry_id ? 'mio_trust_transactions' : '',
      original_transaction_id: String(transaction.original_transaction_id || ''),
    }
    const local = validateClassification({
      mode: mode === 'post' ? 'post' : 'save', record, transaction, resolvedAccount: decision,
      matter: draft.ownership === 'matter' ? { id: draft.matter_id } : null,
      pnc: draft.ownership === 'pnc' ? { id: draft.pnc_workflow_id } : null,
      invoice: draft.invoice_id ? { id: draft.invoice_id, matter_id: String(matter?.id || '') } : null,
    })
    if (!local.ok) { setMessages((current) => ({ ...current, [id]: local.errors.join(' ') })); return }
    if (action === 'correct') {
      // The record being corrected is the latest *posted* classification for this payment: an
      // earlier, already-reversed record must never be selected as the thing being corrected.
      const corrections = (classifications || []).filter((entry) => String(entry.gateway_transaction_id || '') === id)
      const previousRecording = corrections.find((entry) => String(entry.posting_status || '') === 'posted')
        || corrections.find((entry) => String(entry.posting_status || '') === 'reversed')
      const preview = correctionPreview({
        previous: previousRecording || {}, transaction, resolvedAccount: decision, category: draft.category,
        matter: draft.ownership === 'matter' ? { id: draft.matter_id, name: String(matter?.name || '') } : null,
        invoice: draft.invoice_id ? { id: draft.invoice_id, invoice_number: draft.invoice_id } : null,
        reason: draft.correction_reason,
      })
      if (!preview.ok) { setMessages((current) => ({ ...current, [id]: preview.errors.join(' ') })); return }
    }
    if (action === 'match') {
      const match = existingEntryMatch({ transaction, entry: { id: draft.entry_id, source: 'mio_trust_transactions', amount: 0 } })
      if (!match.ok) { setMessages((current) => ({ ...current, [id]: match.error })); return }
    }
    setWorking(id); setMessages((current) => ({ ...current, [id]: '' }))
    try {
      await callGateway(action, { classification: record, reason: draft.correction_reason || draft.explanation })
      const trust = decision.account_key.includes('trust')
      setMessages((current) => ({ ...current, [id]: action === 'post'
        ? `Recorded in Mio. ${money(amountBreakdown(transaction).gross_cents)} is now ${trust ? 'in this client’s trust balance' : 'recorded in the operating view'}.`
        : action === 'correct' ? `Corrected. The previous posting was reversed once and the replacement was recorded once; both stay in the audit history.`
        : action === 'match' ? 'Matched to the existing entry. No second entry was created.' : 'Saved for later. Nothing posted.' }))
      setOpenId(''); if (onActed) await onActed()
    } catch (failure) { setMessages((current) => ({ ...current, [id]: failure.message })) } finally { setWorking('') }
  }
  async function mapAccount(transaction, draft) {
    const id = providerIdOf(transaction)
    setWorking(id)
    try {
      await callGateway('map_account', { mapping: { provider_account_id: String(transaction.account_id || ''), account_key: draft.manual_key, bank_role: draft.manual_key.includes('trust') ? 'trust' : 'operating', label: accountLabel(draft.manual_key), last4: String(transaction.account_id || '').slice(-4) } })
      setMessages((current) => ({ ...current, [id]: 'Provider account mapped. Every transaction from this provider account now reports its deposit account.' }))
      if (onActed) await onActed()
    } catch (failure) { setMessages((current) => ({ ...current, [id]: failure.message })) } finally { setWorking('') }
  }

  const rows = expanded ? scoped : outstanding
  return (
    <section aria-label="LawPay payment classification" style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>LawPay payment classification</h3>
          <p style={{ margin: '4px 0 0', color: '#475569' }} data-testid="lawpay-classification-summary">
            {outstanding.length ? `${outstanding.length} payment(s) need a decision` : 'Every LawPay payment has a decision'}
            {matter?.name ? ` for ${matter.name}` : ' across the firm'}
            {` · ${posted.length} recorded in Mio by this workflow`}
          </p>
          <p style={{ margin: '2px 0 0', color: '#64748b', fontSize: 12 }}>
            Ownership, the actual deposit account and the transaction type are decided separately. Nothing posts until you confirm it, and a payment that is already recorded is never recorded twice.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onRefresh && onRefresh()} disabled={!!busy}>{busy ? 'Loading LawPay records…' : 'Refresh from LawPay'}</button>
          <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide recorded payments' : 'Show every LawPay payment'}</button>
        </div>
      </div>
      {error ? <p role="alert" style={{ color: '#b91c1c', margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: '#15803d', margin: 0 }}>{notice}</p> : null}
      {!mappingAvailable ? <p style={{ color: '#b45309', margin: 0 }}>The firm LawPay account mapping table is not readable with these credentials yet. Each transaction can still be recorded by verifying its deposit account by hand with evidence; the mapping is only a convenience for provider accounts that recur.</p> : null}
      {openRefunds.length ? (
        <section aria-label="Refund relationship review" data-testid="refund-review" style={{ border: '1px solid #f59e0b', background: '#fffbeb', borderRadius: 8, padding: 10 }}>
          <strong>{refunds.label || 'Refund review'}</strong>
          <p style={{ margin: '4px 0' }} data-testid="refund-unresolved-summary">{refunds.reason || `${(refunds.separate_refund_total_cents / 100).toFixed(2)} of refunds are resolved: each is counted once.`}</p>
          {openRefunds.map((effect) => (
            <div key={effect.refund_id} style={{ borderTop: '1px solid #fcd34d', paddingTop: 6, marginTop: 6 }}>
              <div>{`Refund ${effect.refund_id} · ${money(effect.amount_cents)} · ${effect.effect === 'unresolved' ? 'Refund relationship unresolved' : 'recorded as a separate refund'}`}</div>
              <label>{`What establishes this refund’s relationship (${effect.refund_id})?`}
                <input aria-label={`Refund evidence for ${effect.refund_id}`} value={refundEvidence[effect.refund_id] || ''} onChange={(event) => setRefundEvidence((current) => ({ ...current, [effect.refund_id]: event.target.value }))} placeholder="Provider reference or report that shows whether this is the same refund" />
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <button type="button" aria-label={`Same refund as the charge ${effect.refund_id}`} disabled={refundBusy === effect.refund_id} onClick={() => resolveRefund(effect.refund_id, 'same_refund', refundEvidence[effect.refund_id] || '')}>Same refund already reflected on this charge</button>
                <button type="button" aria-label={`Separate refund ${effect.refund_id}`} disabled={refundBusy === effect.refund_id} onClick={() => resolveRefund(effect.refund_id, 'separate_refund', refundEvidence[effect.refund_id] || '')}>Separate refund</button>
              </div>
            </div>
          ))}
          {refundMessage ? <p role="status" data-testid="refund-message" style={{ margin: '6px 0 0' }}>{refundMessage}</p> : null}
        </section>
      ) : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        {rows.map((transaction) => {
          const id = providerIdOf(transaction)
          const draft = decisionsFor(id)
          const payer = String(transaction.payer_name || transaction.payer_email || `payment ${id}`)
          const manual = draft.manual_key ? { verification: { account_key: draft.manual_key, verified_by: 'you', evidence_reference: draft.manual_evidence } } : null
          const decision = accountDecision(transaction, manual)
          const plan = planFor(transaction, draft)
          const status = postingEligibility({ transaction, category: draft.category })
          // The account decision is part of the preview: an account nobody has established is
          // stated before the reviewer presses anything, not after a refusal.
          const accountEstablished = ['reported_by_lawpay', 'payment_request', 'manually_verified'].includes(decision.provenance)
          const previewStatus = status.eligible && !accountEstablished
            ? { eligible: false, state: 'needs_account', reason: 'The deposit account is not established yet. Record the actual trust or operating account with supporting evidence, then record the transaction.' }
            : status
          const record = anyFor(transaction)
          const state = reviewStatus({ record })
          const open = openId === id
          const duplicate = duplicateClassification({ existing: classifications, identity: `${String(transaction.account_id || '')}:${id}`, category: draft.category })
          // A legacy attribution already put this immutable provider transaction in Mio's ledger
          // outside this workflow. It is shown as recorded, and the only way forward is to match it
          // to that exact entry: posting again would move the same money twice.
          const legacyEntry = (existingEntries || []).find((entry) => String(entry.source || '') === 'legacy_attribution' && String(entry.lawpay_transaction_id || '') === id) || null
          const legacyAmountMismatch = !!legacyEntry && Math.abs(Number(legacyEntry.amount || 0) - amountBreakdown(transaction).gross_cents / 100) > 0.005
          const statusLabel = legacyEntry && state === 'needs_classification' ? 'Recorded in Mio — legacy attribution needs matching' : REVIEW_STATUS_LABELS[state]
          // Corrections: the recorded posting is preserved, its effect is reversed once and the
          // replacement posts once. The history keeps every record, newest first.
          const history = (classifications || []).filter((entry) => String(entry.gateway_transaction_id || '') === id)
            .sort((left, right) => String(right.created_at || right.posted_at || '').localeCompare(String(left.created_at || left.posted_at || '')))
          const previousRecording = history.find((entry) => String(entry.posting_status || '') === 'posted')
            || history.find((entry) => String(entry.posting_status || '') === 'reversed') || null
          // A correction may move the money to a different account, which must be verified with
          // evidence like any other hand-recorded account.
          const correctionAccount = draft.correction_key
            ? { account_key: draft.correction_key, provenance: 'manually_verified', label: 'Manually verified', detail: `${draft.correction_evidence}` }
            : decision
          const correction = previousRecording ? correctionPreview({
            previous: previousRecording, transaction, resolvedAccount: correctionAccount, category: draft.category,
            matter: draft.ownership === 'matter' ? { id: draft.matter_id, name: String(matter?.name || '') } : null,
            invoice: draft.invoice_id ? { id: draft.invoice_id, invoice_number: draft.invoice_id } : null,
            reason: draft.correction_reason,
          }) : null
          const canCorrect = !!previousRecording && String(previousRecording.posting_status || '') === 'posted'
          return (
            <li key={id} data-testid={`lawpay-row-${id}`} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, background: open ? '#f8fafc' : '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <strong>{payer}</strong>
                  <div style={{ color: '#475569' }}>{`${transaction.occurred_at ? String(transaction.occurred_at).slice(0, 10) : 'date not reported'} · ${providerMoneyOut(transaction) ? 'Money out' : 'Money in'} ${money(amountBreakdown(transaction).gross_cents)} · LawPay transaction ${id}`}</div>
                  <div style={{ color: '#0f172a' }} data-testid={`lawpay-account-${id}`}>{`${decision.label}${decision.detail ? ` · ${decision.detail}` : ''}`}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700 }}>{statusLabel}</div>
                  <button type="button" aria-label={`Decide ${payer}`} onClick={() => setOpenId(open ? '' : id)}>{open ? 'Close' : 'Choose what this payment is'}</button>
                </div>
              </div>
              {open ? (
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }} data-testid={`lawpay-decisions-${id}`}>
                  <label>Ownership for {payer}
                    <select aria-label={`Ownership for ${payer}`} value={draft.ownership} onChange={(event) => patch(id, { ownership: event.target.value })}>
                      <option value="matter">This matter — a client payment</option>
                      <option value="pnc">A PNC consultation</option>
                      <option value="other_unresolved">Neither matter nor PNC — keep it out of matter finances</option>
                    </select>
                  </label>
                  {draft.ownership === 'matter' ? (
                    <label>Matter for {payer}
                      <select aria-label={`Matter for ${payer}`} value={draft.matter_id} onChange={(event) => patch(id, { matter_id: event.target.value })}>
                        <option value="">Choose the matter</option>
                        {(matters || []).map((option) => <option key={option.id} value={option.id}>{String(option.name || option.id)}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {draft.ownership === 'pnc' ? (
                    <label>PNC for {payer}
                      <input aria-label={`PNC for ${payer}`} value={draft.pnc_workflow_id} onChange={(event) => patch(id, { pnc_workflow_id: event.target.value })} placeholder="PNC consultation or workflow name" />
                    </label>
                  ) : null}
                  {draft.ownership === 'other_unresolved' ? (
                    <label>Other reason for {payer}
                      <select aria-label={`Other reason for ${payer}`} value={draft.other_reason} onChange={(event) => patch(id, { other_reason: event.target.value })}>
                        <option value="">Say why this belongs to neither</option>
                        {OTHER_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
                    <legend>{`Actual deposit account for ${payer}`}</legend>
                    <p style={{ margin: '0 0 6px', color: '#0f172a' }}>{`${decision.label}${decision.detail ? ` · ${decision.detail}` : ''}`}</p>
                    {!transaction.resolved_account_key ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <p style={{ margin: 0, color: '#b45309' }}>{decision.detail}</p>
                        <label>Actual account for {payer}
                          <select aria-label={`Actual account for ${payer}`} value={draft.manual_key} onChange={(event) => patch(id, { manual_key: event.target.value })}>
                            <option value="">Choose the account you verified</option>
                            {(accounts.length ? accounts : ACCOUNT_KEYS.map((key) => ({ account_key: key, label: accountLabel(key) })))
                              .map((row) => <option key={row.account_key} value={row.account_key}>{String(row.label || accountLabel(row.account_key))}</option>)}
                          </select>
                        </label>
                        <label>Account evidence for {payer}
                          <input aria-label={`Account evidence for ${payer}`} value={draft.manual_evidence} onChange={(event) => patch(id, { manual_evidence: event.target.value })} placeholder="LawPay transaction ID, report, or bank statement line" />
                        </label>
                        <label>Account explanation for {payer}
                          <input aria-label={`Account explanation for ${payer}`} value={draft.manual_explanation} onChange={(event) => patch(id, { manual_explanation: event.target.value })} placeholder="How you confirmed which account received the money" />
                        </label>
                        <div>
                          <button type="button" aria-label={`Map this provider account for ${payer}`} disabled={!draft.manual_key || working === id} onClick={() => mapAccount(transaction, draft)}>
                            {`Map this provider account once${draft.manual_key ? ` to ${accountLabel(draft.manual_key)}` : ''}`}
                          </button>
                        </div>
                      </div>
                    ) : <p style={{ margin: 0, color: '#15803d' }}>The deposit account is established for this transaction, so nothing has to be verified by hand. A wrong classification is changed later with a linked correction rather than by editing this record.</p>}
                  </fieldset>
                  <label>Transaction type for {payer}
                    <select aria-label={`Transaction type for ${payer}`} value={draft.category} onChange={(event) => patch(id, { category: event.target.value })}>
                      <option value="">Choose the transaction type</option>
                      {CATEGORIES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <p style={{ margin: 0, color: '#64748b', fontSize: 12 }}>{`Suggested from the stored provider record: ${suggestions({ transaction, accountKey: decision.account_key }).map((value) => categoryById(value)?.label || value).join(' · ')}`}</p>
                  {categoryById(draft.category)?.explanation === 'required' ? (
                    <label>Explanation for {payer}
                      <input aria-label={`Explanation for ${payer}`} value={draft.explanation} onChange={(event) => patch(id, { explanation: event.target.value })} placeholder="What this transaction was, in words that will still make sense next year" />
                    </label>
                  ) : null}
                  {draft.ownership === 'matter' && draft.category === 'earned_fee_payment' ? (
                    <label>Invoice for {payer}
                      <select aria-label={`Invoice for ${payer}`} value={draft.invoice_id} onChange={(event) => patch(id, { invoice_id: event.target.value })}>
                        <option value="">No invoice — record it without applying it to one</option>
                        {(invoices || []).map((option) => <option key={option.id} value={option.id}>{String(option.invoice_number || option.id)}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <div data-testid={`lawpay-preview-${id}`} aria-label={`Preview for ${payer}`} style={{ background: '#f1f5f9', borderRadius: 8, padding: 8 }}>
                    <strong>{'Preview — nothing has been written yet'}</strong>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {postingPreview({ plan, status: previewStatus, matter: draft.ownership === 'matter' ? { name: String(matter?.name || '') } : null }).map((line, index) => <li key={index}>{line}</li>)}
                    </ul>
                    {duplicate?.duplicate ? <p style={{ margin: '6px 0 0', color: '#b45309' }}>{duplicate.reason}</p> : null}
                  </div>
                  {legacyEntry ? (
                    <div data-testid={`lawpay-legacy-${id}`} style={{ border: '1px solid #38bdf8', background: '#f0f9ff', borderRadius: 8, padding: 8 }}>
                      <strong>{'Already recorded in Mio outside this classification workflow'}</strong>
                      <p style={{ margin: '4px 0' }}>{`A legacy attribution posted this exact LawPay transaction ${money(Math.abs(Number(legacyEntry.amount || 0)))} to the trust ledger (${legacyEntry.label}). It is counted once and cannot be posted again. Match it to that entry so Mio has one canonical record of it.`}</p>
                      {legacyAmountMismatch ? <p role="alert" style={{ margin: '4px 0', color: '#b91c1c' }}>{`Conflict: the legacy entry is ${money(Math.abs(Number(legacyEntry.amount || 0)))} but LawPay reports ${money(amountBreakdown(transaction).gross_cents)} for this transaction. Resolve the difference before matching.`}</p> : null}
                      <label>Existing entry for {payer}
                        <select aria-label={`Existing entry for ${payer}`} value={draft.entry_id || String(legacyEntry.id)} onChange={(event) => patch(id, { entry_id: event.target.value })}>
                          <option value={String(legacyEntry.id)}>{legacyEntry.label}</option>
                          {(existingEntries || []).filter((entry) => String(entry.id) !== String(legacyEntry.id)).map((entry) => <option key={String(entry.id)} value={String(entry.id)}>{String(entry.label)}</option>)}
                        </select>
                      </label>
                      <div style={{ marginTop: 6 }}>
                        <button type="button" aria-label={`Match the legacy entry ${payer}`} disabled={working === id || !!legacyAmountMismatch} onClick={() => submit('match', transaction, 'save')}>{'Match this transaction to that recorded entry'}</button>
                      </div>
                    </div>
                  ) : null}
                  {canCorrect ? (
                    <fieldset data-testid={`lawpay-correction-${id}`} style={{ border: '1px solid #fbbf24', borderRadius: 8, padding: 8 }}>
                      <legend>{`Correct the recorded classification for ${payer}`}</legend>
                      <p style={{ margin: '0 0 6px', color: '#475569' }}>
                        {`Recorded as ${categoryById(previousRecording?.category || '')?.label || previousRecording?.category || 'unclassified'} on ${accountLabel(previousRecording?.actual_account_key || '')}. Change the decisions above, then confirm: the original posting, its ledger entry and its reversal all stay in the audit history.`}
                      </p>
                      <label>Reason for the correction
                        <input aria-label={`Correction reason for ${payer}`} value={draft.correction_reason} onChange={(event) => patch(id, { correction_reason: event.target.value })} placeholder="Why the recorded classification is wrong, in words that will still make sense next year" />
                      </label>
                      <label>Account the money actually reached
                        <select aria-label={`Correction account for ${payer}`} value={draft.correction_key} onChange={(event) => patch(id, { correction_key: event.target.value })}>
                          <option value="">{`Keep the recorded account (${accountLabel(previousRecording?.actual_account_key || '')})`}</option>
                          {(accounts.length ? accounts : ACCOUNT_KEYS.map((key) => ({ account_key: key, label: accountLabel(key) })))
                            .map((row) => <option key={row.account_key} value={row.account_key}>{String(row.label || accountLabel(row.account_key))}</option>)}
                        </select>
                      </label>
                      {draft.correction_key ? (
                        <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
                          <label>Correction account evidence
                            <input aria-label={`Correction evidence for ${payer}`} value={draft.correction_evidence} onChange={(event) => patch(id, { correction_evidence: event.target.value })} placeholder="LawPay report or bank statement line that shows where the money went" />
                          </label>
                          <label>Correction account explanation
                            <input aria-label={`Correction explanation for ${payer}`} value={draft.correction_explanation} onChange={(event) => patch(id, { correction_explanation: event.target.value })} placeholder="How you confirmed the account the money actually reached" />
                          </label>
                        </div>
                      ) : null}
                      <div data-testid={`lawpay-correction-preview-${id}`} aria-label={`Correction preview for ${payer}`} style={{ background: '#fffbeb', borderRadius: 8, padding: 8, marginTop: 6 }}>
                        <strong>{'Correction preview — nothing has been written yet'}</strong>
                        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                          {(correction?.lines || []).map((line, index) => <li key={index}>{line}</li>)}
                        </ul>
                        {correction && !correction.ok ? <p style={{ margin: '6px 0 0', color: '#b45309' }}>{correction.errors.join(' ')}</p> : null}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <button type="button" aria-label={`Confirm correction ${payer}`} disabled={working === id || !correction?.ok} onClick={() => submit('correct', transaction, 'post')}>{'Confirm correction'}</button>
                      </div>
                    </fieldset>
                  ) : null}
                  {history.length ? (
                    <div data-testid={`lawpay-history-${id}`}>
                      <strong>{'Audit history, newest first'}</strong>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                        {history.map((entry) => (
                          <li key={String(entry.id)}>
                            {`${String(entry.posting_status || 'saved')} · ${categoryById(entry.category || '')?.label || entry.category || 'unclassified'} · ${accountLabel(entry.actual_account_key || '')} · ${entry.created_by || 'unknown'} · ${String(entry.posted_at || entry.updated_at || entry.created_at || '').slice(0, 10)}`}
                            {entry.corrects_classification_id ? ' · corrects an earlier recording' : ''}
                            {entry.explanation ? ` · ${entry.explanation}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <label>Existing entry for {payer}
                    <select aria-label={`Existing entry for ${payer}`} value={draft.entry_id} onChange={(event) => patch(id, { entry_id: event.target.value })}>
                      <option value="">Choose an entry Mio already has, if this money is already recorded</option>
                      {(existingEntries || []).map((option) => <option key={option.id} value={option.id}>{String(option.label || option.id)}</option>)}
                    </select>
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" aria-label={`Save for later ${payer}`} disabled={working === id} onClick={() => submit('save', transaction, 'save')}>{'Save for later'}</button>
                    <button type="button" aria-label={`Confirm and record ${payer}`} disabled={working === id || !status.eligible || !accountEstablished || !!duplicate?.duplicate || (existingEntries || []).some((entry) => String(entry.source || '') === 'legacy_attribution' && String(entry.lawpay_transaction_id || '') === id)} onClick={() => submit('post', transaction, 'post')}>{status.eligible && accountEstablished && !duplicate?.duplicate && !(existingEntries || []).some((entry) => String(entry.source || '') === 'legacy_attribution' && String(entry.lawpay_transaction_id || '') === id) ? 'Confirm and record' : 'Not eligible to record yet'}</button>
                    <button type="button" aria-label={`Match the existing entry ${payer}`} disabled={working === id || !draft.entry_id} onClick={() => submit('match', transaction, 'save')}>{'Match the existing entry'}</button>
                    <button type="button" aria-label={`Leave undecided ${payer}`} onClick={() => setOpenId('')}>{'Leave for now'}</button>
                  </div>
                  {!previewStatus.eligible && draft.category ? <p style={{ margin: 0, color: '#b45309' }}>{previewStatus.reason}</p> : null}
                </div>
              ) : null}
              {messages[id] ? <p role="status" data-testid={`lawpay-message-${id}`} style={{ margin: '8px 0 0', color: /failed|could not|refus|error|not established|already recorded|different classification/i.test(messages[id]) ? '#b91c1c' : '#15803d' }}>{messages[id]}</p> : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
// Diagnostics are read through their own function (`lawpay-account-diagnostics`) so that a
// diagnostics-only release can never carry an action that records money. The app loader asks
// for them and passes the redacted summary in as a prop.

