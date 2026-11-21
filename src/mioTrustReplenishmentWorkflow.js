import {invoiceOutstanding, calculateTrustReplenishment, shouldReviewTrustMatter} from './mioTrustReplenishmentCalculations.js';

const closedInvoice = i => ['void','voided','cancelled','canceled','written_off'].includes(String(i.status || '').toLowerCase());
const isTrust = i => ['trust_replenishment','trust','replenishment','trust_request'].includes(String(i.invoice_type || i.type || '').toLowerCase());
const isWork = i => ['work','work_ob','operating','fee','services','wip','work_invoice'].includes(String(i.invoice_type || i.type || '').toLowerCase());
const sum = invoices => Math.round(invoices.reduce((n,i)=>n + Math.round(invoiceOutstanding(i)*100),0))/100;
const dateOf = i => i.emailed_at || i.sent_at || i.issue_date || i.created_at || null;
const desc = i => ({
  id:i.id,
  invoice_number:i.invoice_number || '',
  date:dateOf(i),
  amount:Number(i.total ?? i.amount ?? 0),
  paid:Number(i.amount_paid ?? i.paid_amount ?? 0),
  remaining:invoiceOutstanding({ ...i, remaining_balance:i.balance ?? i.remaining_balance,paid_amount:i.amount_paid ?? i.paid_amount,amount:i.total ?? i.amount }),
  payment_url:i.payment_url || '',
  trust_at_issue:i.trust_at_issue ?? null,
});
export function buildReplenishmentReview({matters=[],invoices=[],settings={}}) {
  return matters.filter(m => shouldReviewTrustMatter({
    ...m,
    ...(settings[m.id] || {}),
    current_trust:m.current_trust ?? m.trust_balance,
    minimum_trust:m.minimum_trust ?? m.minimum_balance,
    primary_replenishment_matter:(settings[m.id] || {}).primary_replenishment_matter ?? m.primary_replenishment_matter
  })).map(m=>{
    const cfg=settings[m.id] || {};
    const related = invoices.filter(i=>String(i.matter_id)===String(m.id) || (cfg.covered_matter_ids||[]).map(String).includes(String(i.matter_id)));
    const unpaid=related.filter(i=>!closedInvoice(i)&&invoiceOutstanding({ ...i,remaining_balance:i.balance ?? i.remaining_balance,paid_amount:i.amount_paid ?? i.paid_amount,amount:i.total ?? i.amount })>0);
    const trust=unpaid.filter(isTrust).map(desc);
    const work=unpaid.filter(isWork).map(desc);
    const target=Number(cfg.target_trust ?? m.target_trust ?? m.initial_retainer ?? m.minimum_balance ?? 0);
    const balance=Number(m.current_trust ?? m.trust_balance ?? 0);
    const outstandingTrust=sum(trust.map(i=>({remaining_balance:i.remaining})));
    const newAmount=calculateTrustReplenishment({currentTrust:balance,targetTrust:target,priorTrustInvoices:trust.map(i=>({remaining_balance:i.remaining}))});
    return {
      id:m.id,matter_name:m.name,client_name:m.client_name||'',
      current_trust:balance,minimum_trust:Number(cfg.minimum_trust ?? m.minimum_trust ?? m.minimum_balance),
      target_trust:target,replenishment_enabled:cfg.replenishment_enabled!==false,
      withdrawal_flagged:cfg.withdrawal_flagged===true,
      unpaid_work_invoices:work,prior_trust_invoices:trust,
      outstanding_work:sum(work.map(i=>({remaining_balance:i.remaining}))),
      outstanding_trust:outstandingTrust,
      new_replenishment:newAmount,
      all_due:Math.round((sum(work.map(i=>({remaining_balance:i.remaining}))+outstandingTrust+newAmount)*100)/100,
      needs_new_invoice:newAmount>0,
      needs_payment_reminder:work.length+trust.length>0
    }
  }).sort((a,b)=>a.current_trust-b.current_trust);
}
export function buildReplenishmentEmailPreview(row, newInvoice=null) {
  const work=row.unpaid_work_invoices||[];
  const prior=row.prior_trust_invoices||[];
  const newlyIssued=newInvoice ? [newInvoice] : [];
  const sections=[
    {label:'Invoices for prior work performed',category:'operating',invoices:work},
    {label:'Previously issued trust replenishment invoices',category:'trust',invoices:prior},
    {label:'New trust replenishment invoice',category:'trust',invoices:newlyIssued}
  ];
  const line=i=>`• Invoice ${i.invoice_number || i.id || '(pending number)'} — ${Number(i.remaining ?? i.balance ?? i.amount ?? 0).toFixed(2)} due${i.payment_url?' — '+i.payment_url:''}`;
  return {
    subject:'Outstanding invoices and trust replenishment',
    sections,
    text:['Please review the following outstanding invoices for your legal matter.',
      ...sections.filter(s=>s.invoices.length).flatMap(s=>['',s.label,...s.invoices.map(line)]),
      ...(newlyIssued.length?[]:row.new_replenishment>0?['','Proposed additional trust replenishment: '+Number(row.new_replenishment).toFixed(2)+' (not yet invoiced).']:[]),
      '','Payments for legal services and trust replenishment are processed separately.'].join('\n')
  };
}
export function validateReplenishmentSend(row) {
  const errors=[];
  if(!row?.recipient_email)errors.push('Recipient email missing');
  if(!row?.verified_current_balances)errors.push('Balances and invoice statuses not freshly verified');
  if(!row?.trust_payment_routing_verified)errors.push('Trust payment routing not verified');
  if(!row?.operating_payment_routing_verified && (row.unpaid_work_invoices||[]).length)errors.push('Operating payment routing not verified');
  if(row?.withdrawal_flagged && !row?.withdrawal_send_approved)errors.push('Withdrawal-flagged matter requires explicit confirmation');
  if(row?.appointed || row?.replenishment_enabled===false)errors.push('Matter is excluded');
  if(!row?.idempotency_key)errors.push('Idempotency key missing');
  return errors;
}
