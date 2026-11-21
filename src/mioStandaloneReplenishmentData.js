// Read-only source of matter and invoice records for trust replenishment review.
// Does NOT infer current IOLTA balances from historical snapshots or payment deposits.
// Calling code must provide reconciled CURRENT trust amounts from Mio's authoritative ledger.
import {buildReplenishmentReview} from './mioTrustReplenishmentWorkflow.js';
import {loadReplenishmentSettings} from './mioReplenishmentSettings.js';

async function allPages(queryFactory,pageSize=500) {
  let result=[],from=0;
  for(;;){
    const {data,error}=await queryFactory().range(from,from+pageSize-1);
    if(error)throw error;
    result.push(...(data||[]));
    if(!data||data.length<pageSize)return result;
    from+=pageSize;
    if(from>20000)throw new Error('Financial records exceed safe review limit; paginate on server.');
  }
}
export async function loadStandaloneReplenishmentData(supabase,userId,{currentTrustByMatter={},appointedByMatter={}}={}) {
  if(!userId)throw new Error('Please sign in first.');
  const [matters,invoices,settings]=await Promise.all([
    allPages(()=>supabase.from('matters').select('id,name,client_id,is_active,case_status,matter_status')),
    allPages(()=>supabase.from('mio_invoices').select('id,matter_id,client_id,client_name,matter_name,invoice_number,invoice_type,status,total,amount_paid,balance,issue_date,emailed_at,payment_url,created_at').eq('user_id',userId)),
    loadReplenishmentSettings(supabase,userId)
  ]);
  const items=matters.map(m=>{
    const balance=currentTrustByMatter[m.id];
    // Absence of an independently verified balance is not zero.
    const verified=balance && balance.reconciled===true && Number.isFinite(Number(balance.amount)) &&
      balance.asOf && Date.now()-new Date(balance.asOf).getTime()<=24*3600000 &&
      Date.now()>=new Date(balance.asOf).getTime();
    return {
      ...m,
      appointed:appointedByMatter[m.id]!==false, // Unknown appointments fail closed.
      closed:m.is_active===false || /closed/i.test(String(m.case_status||m.matter_status||'')),
      current_trust:verified?Number(balance.amount):null,
      source_balance_reconciled:!!verified,
      trust_balance_verified_at:verified?balance.asOf:null,
      minimum_balance:settings[m.id]?.minimum_trust ?? null,
      target_trust:settings[m.id]?.target_trust ?? null
    };
  });
  const review=buildReplenishmentReview({matters:items.filter(m=>m.source_balance_reconciled),invoices,settings});
  return {
    review,
    allMatters:items,
    invoiceLoadedAt:new Date().toISOString(),
    excludedUntilVerified:items.filter(m=>!m.source_balance_reconciled || m.appointed).length,
    warning:'Review only. No invoice generation or sending is authorized. Verify current trust, appointment classification, trust ownership, and payment routing before enabling approval.'
  };
}
