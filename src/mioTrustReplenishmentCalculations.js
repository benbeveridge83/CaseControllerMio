// Pure calculations for the private-client trust replenishment workflow.
// Amounts are decimal dollars, consistent with the existing replenishment review.
// The invoice/payment adapter must normalize partial payments before calling this module.
const amount = value => Math.max(0, Number(value) || 0);
const cents = value => Math.round(amount(value) * 100);
const dollars = value => Math.round(value) / 100;
export function invoiceOutstanding(invoice) {
  if (invoice?.remaining_balance != null) return dollars(cents(invoice.remaining_balance));
  if (invoice?.balance_due != null) return dollars(cents(invoice.balance_due));
  return dollars(Math.max(0, cents(invoice?.amount) - cents(invoice?.paid_amount)));
}
export function calculateTrustReplenishment({currentTrust = 0, targetTrust = 0, priorTrustInvoices = []}) {
  const outstandingCents = priorTrustInvoices
    .filter(invoice => !['void','voided','cancelled','canceled','written_off'].includes(String(invoice.status || '').toLowerCase()))
    .reduce((sum, invoice) => sum + cents(invoiceOutstanding(invoice)), 0);
  return dollars(Math.max(0, cents(targetTrust) - cents(currentTrust) - outstandingCents));
}
export function shouldReviewTrustMatter(matter) {
  if (matter.appointed || matter.is_appointed || matter.closed || matter.is_closed) return false;
  if (matter.replenishment_enabled === false) return false;
  if (matter.primary_replenishment_matter === false || matter.is_primary_replenishment_matter === false) return false;
  const minimum = Number(matter.minimum_trust ?? matter.minimum_trust_balance);
  const balance = Number(matter.current_trust ?? matter.trust_balance);
  return Number.isFinite(minimum) && Number.isFinite(balance) && balance < minimum;
}
export function summarizeReplenishmentMatter(matter) {
  const oldTrust = (matter.prior_trust_invoices || []).reduce((sum, invoice) => sum + cents(invoiceOutstanding(invoice)), 0);
  const work = (matter.unpaid_work_invoices || []).reduce((sum, invoice) => sum + cents(invoiceOutstanding(invoice)), 0);
  const newTrust = calculateTrustReplenishment({
    currentTrust: matter.current_trust ?? matter.trust_balance,
    targetTrust: matter.target_trust ?? matter.target_trust_balance,
    priorTrustInvoices: matter.prior_trust_invoices || []
  });
  return { oldTrust: dollars(oldTrust), work: dollars(work), newTrust, totalRequested: dollars(oldTrust + work + cents(newTrust)) };
}
export function recentTrustHistory(invoices, asOf = new Date(), days = 60) {
  const end = new Date(asOf).getTime();
  const start = end - days * 86400000;
  return (invoices || []).filter(invoice => {
    const sent = new Date(invoice.sent_at || invoice.issued_at || invoice.created_at).getTime();
    return Number.isFinite(sent) && sent >= start && sent <= end;
  }).sort((a,b) => new Date(a.sent_at || a.issued_at || a.created_at) - new Date(b.sent_at || b.issued_at || b.created_at));
}
// The send adapter must re-read financial data and use an idempotency key before invoice creation.
// An unpaid work invoice is NOT a trust deposit; never route it to IOLTA.
