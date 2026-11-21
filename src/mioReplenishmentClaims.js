// Claim a unique financial send decision before generating a new request or emailing
// a previous invoice. Uses Supabase's unique primary key as a cross-tab lock.
// Never retry claimed/needs_review sends automatically; reconcile externally first.
const hex = data => [...new Uint8Array(data)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
export async function replenishmentFingerprint({matterId,kind,amount,trust,target,invoices=[],day}) {
  const lines=(invoices||[]).map(i=>[String(i.id),String(i.updated_at||''),Math.round(Number(i.balance||0)*100)].join(':')).sort();
  const text=JSON.stringify({matterId:String(matterId),kind,amountCents:Math.round(Number(amount||0)*100),
    trustCents:Math.round(Number(trust||0)*100),targetCents:Math.round(Number(target||0)*100),
    invoiceLines:lines,day:kind==='reminder'?day||new Date().toISOString().slice(0,10):null});
  return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
}
export async function claimReplenishmentSend(supabase,{userId,matterId,fingerprint,kind}) {
  const {data,error}=await supabase.from('mio_replenishment_send_claims')
    .insert({user_id:userId,matter_id:matterId,fingerprint,kind,status:'claimed'}).select().single();
  if(error) {
    if(error.code==='23505')throw new Error('This replenishment decision was already started in another tab or earlier run. Check sent email and invoice history before retrying.');
    throw error;
  }
  return data;
}
export async function finishReplenishmentClaim(supabase,{userId,matterId,fingerprint,status,invoiceId}) {
  if(!['sent','needs_review'].includes(status))throw new Error('Invalid claim completion state');
  const {data,error}=await supabase.from('mio_replenishment_send_claims')
    .update({status,invoice_id:invoiceId||null,updated_at:new Date().toISOString()})
    .eq('user_id',userId).eq('matter_id',matterId).eq('fingerprint',fingerprint).select().single();
  if(error)throw error;
  return data;
}
