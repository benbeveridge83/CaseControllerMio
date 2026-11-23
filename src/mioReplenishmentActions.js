// Review actions describe separate invoice categories, not an exclusive status.
// A matter can require all three within one consolidated client communication.
import {invoiceOutstanding} from './mioTrustReplenishmentCalculations.js';
export function replenishmentActionCategories(row={}) {
  const prior=(row.prior_trust_invoices||[]).some(i=>invoiceOutstanding(i)>0);
  const work=(row.unpaid_work_invoices||[]).some(i=>invoiceOutstanding(i)>0);
  const fresh=Number(row.amount)>0;
  const actions=[];
  if(fresh)actions.push('New trust invoice');
  if(prior)actions.push('Old trust invoice');
  if(work)actions.push('Work invoice');
  return actions;
}
