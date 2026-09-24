// The single signal every LawPay decision point raises, and the single navigation the global review
// notification uses. It mirrors the Formspree lead-alert mechanism exactly: a window event for this
// tab, and a BroadcastChannel so two open tabs never show a stale count.
export const LAWPAY_REVIEW_CHANNEL = 'mio-lawpay'

export function notifyLawPayReviewChanged() {
  try { window.dispatchEvent(new Event('mio-lawpay-refresh')) } catch { /* not a browser window */ }
  try { const channel = new BroadcastChannel(LAWPAY_REVIEW_CHANNEL); channel.postMessage({ type: 'refresh' }); channel.close() } catch { /* BroadcastChannel unavailable */ }
}

export function openLawPayReviewQueue() {
  try { window.dispatchEvent(new Event('mio-open-lawpay')) } catch { /* not a browser window */ }
}
