// Guardrails for standalone replenishment data acquisition.
// Stale historical Clio snapshots must never authorize today's trust requests.
export const MAX_TRUST_BALANCE_AGE_HOURS = 24;
export const MAX_INVOICE_REFRESH_AGE_MINUTES = 5;
export function checkReplenishmentFreshness({balanceAsOf,invoiceAsOf,now=new Date()}) {
  const current=new Date(now).getTime();
  const balance=new Date(balanceAsOf).getTime();
  const invoices=new Date(invoiceAsOf).getTime();
  const errors=[];
  if(!Number.isFinite(balance)||balance>current||current-balance>MAX_TRUST_BALANCE_AGE_HOURS*3600000)
    errors.push('Current trust balance is missing, stale, or future-dated.');
  if(!Number.isFinite(invoices)||invoices>current||current-invoices>MAX_INVOICE_REFRESH_AGE_MINUTES*60000)
    errors.push('Invoice/payment ledger must be refreshed before approval.');
  return {ok:errors.length===0,errors};
}
export function assertSafeReplenishmentRow(row,now=new Date()) {
  const freshness=checkReplenishmentFreshness({
    balanceAsOf:row?.trust_balance_verified_at,
    invoiceAsOf:row?.invoice_ledger_verified_at,
    now
  });
  const errors=[...freshness.errors];
  if(row?.appointed!==false)errors.push('Matter appointment status has not been verified as non-appointed.');
  if(row?.replenishment_enabled===false)errors.push('Replenishment is disabled for this matter.');
  if(row?.primary_replenishment_matter!==true)errors.push('Primary replenishment matter must be confirmed.');
  if(row?.source_balance_reconciled!==true)errors.push('Trust balance is not reconciled to the current trust ledger.');
  return {ok:errors.length===0,errors};
}
