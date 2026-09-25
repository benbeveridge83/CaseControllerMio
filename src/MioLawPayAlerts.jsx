// One consolidated, persistent LawPay review notification. It reuses the Formspree lead-alert
// mechanism: a component mounted outside page-specific tabs that polls, listens for a window event,
// and crosses tabs through a BroadcastChannel. It always shows one count — never one notification
// per transaction — and disappears when nothing needs review. Clicking it opens the centralized
// LawPay review queue.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient.js'
import { actionableReviewCount } from './mioLawPayClassification.js'
import { LAWPAY_REVIEW_CHANNEL, openLawPayReviewQueue } from './mioLawPayNotifications.js'
import './mioLeadAlerts.css'

export default function MioLawPayAlerts() {
  const [session, setSession] = useState(null)
  const [count, setCount] = useState(0)
  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('lawpay-gateway', { body: { action: 'review' } })
      if (error) throw new Error(error.message || 'The LawPay gateway could not be reached.')
      if (data?.error) throw new Error(data.error)
      const review = actionableReviewCount({
        transactions: data?.transactions || [],
        classifications: data?.classifications || [],
        refundResolutions: data?.refund_resolutions || [],
        reviewCutoverDate: data?.review_cutover_date || '',
        legacyRecordedTransactionIds: data?.legacy_recorded_transaction_ids || [],
        legacyAttributedTransactionIds: data?.legacy_attributed_transaction_ids || [],
      })
      setCount(review.count)
    } catch (failure) {
      console.warn('The LawPay review count could not be refreshed; keeping the last figure.', failure?.message || failure)
    }
  }, [])
  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) setSession(data.session) })
    const { data: auth } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => { alive = false; auth.subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    if (!session) return
    // Load once when a signed-in session appears, then stay fresh through the poll, the window event
    // and the BroadcastChannel. This is the same shape MioLeadAlerts uses.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const timer = setInterval(() => void load(), 30000)
    const onRefresh = () => void load()
    window.addEventListener('mio-lawpay-refresh', onRefresh)
    let channel
    try {
      channel = new BroadcastChannel(LAWPAY_REVIEW_CHANNEL)
      channel.onmessage = (event) => { if (event.data?.type === 'refresh') void load() }
    } catch { /* BroadcastChannel unavailable; the poll and window event still refresh */ }
    return () => { clearInterval(timer); window.removeEventListener('mio-lawpay-refresh', onRefresh); try { channel?.close() } catch { /* nothing to close */ } }
  }, [session, load])
  if (!session || !count) return null
  return (
    <aside className="mio-lead-mini" role="status" data-testid="lawpay-review-notification">
      <button onClick={openLawPayReviewQueue} aria-label={`${count} LawPay transaction${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} review`}>
        <b>{count} LawPay transaction{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} review.</b>
        <span>Open the centralized LawPay review queue</span>
      </button>
    </aside>
  )
}
