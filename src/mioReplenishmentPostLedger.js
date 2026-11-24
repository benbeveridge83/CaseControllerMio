// Verify that the trust ledger used for the UI has the same entries as the
// current persisted ledger, which atomic weekly posting updates in one transaction.
// This is a guard against using balances from the pre-posting React render.
function normalized(entries){
  if(!Array.isArray(entries))return null;
  return entries.map(row=>[
    String(row?.id||''),
    String(row?.matter_id||''),
    String(row?.direction||''),
    Math.round(Number(row?.amount||0)*100),
    String(row?.invoice_id||''),
    String(row?.idempotency_key||'')
  ].join('|')).sort();
}
export function trustLedgerMatchesCloud(local,cloud){
  const a=normalized(local),b=normalized(cloud);
  return !!a&&!!b&&a.length===b.length&&a.every((entry,index)=>entry===b[index]);
}
export async function assertCurrentTrustLedger(supabase,userId,local){
  if(!userId)throw new Error('Sign in before verifying the trust ledger.');
  const {data,error}=await supabase.from('case_mio_user_state')
    .select('json_value').eq('user_id',userId)
    .eq('key','caseMioTrustTransactions').maybeSingle();
  if(error)throw error;
  const cloud=data?.json_value;
  if(!trustLedgerMatchesCloud(local,cloud))
    throw new Error('Trust transactions changed after this screen loaded. Reopen the billing review after the latest atomic postings are loaded before preparing or sending replenishments.');
  return {verified:true,count:cloud.length};
}
