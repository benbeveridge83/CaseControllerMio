// Authenticated, read-only billing data adapter.
// Do not use these rows to authorize trust disbursement or invoice generation.
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0
const cents = value => Math.round(num(value)*100)

export function summarizeWeeklyBillingEntries(entries = [], invoices = []) {
  const wip = new Map(), workOB = new Map(), oldestInvoice = new Map()
  for (const entry of entries) {
    const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {}
    if (!entry.matter_id || entry.do_not_bill === true || payload.do_not_bill === true || payload.non_billable === true ||
        payload.invoice_id || payload.invoiced_at) continue
    const key=String(entry.matter_id)
    wip.set(key,(wip.get(key)||0)+cents(entry.amount))
  }
  for(const invoice of invoices) {
    if (!invoice.matter_id || invoice.invoice_type === 'trust_request' || !['outstanding','partially_paid'].includes(String(invoice.status||'').toLowerCase())) continue
    const balance = invoice.balance == null
      ? Math.max(0,num(invoice.total)-num(invoice.amount_paid))
      : num(invoice.balance)
    if (!(balance>0)) continue
    const key=String(invoice.matter_id)
    workOB.set(key,(workOB.get(key)||0)+cents(balance))
    const date=String(invoice.issue_date||invoice.created_at||'').slice(0,10)
    if (date && (!oldestInvoice.has(key) || date<oldestInvoice.get(key)))oldestInvoice.set(key,date)
  }
  return {wip,workOB,oldestInvoice}
}

async function fetchAllRows(supabase,table,columns,userId) {
  const result=[]
  for(let offset=0;offset<100000;offset+=500) {
    const {data,error}=await supabase.from(table).select(columns).eq('user_id',userId).order('id',{ascending:true}).range(offset,offset+499)
    if(error)throw new Error(table+': '+error.message)
    result.push(...(data||[]))
    if(!data||data.length<500)return result
  }
  throw new Error('Financial record scan exceeded the safety limit')
}
export async function loadWeeklyBillingReadOnly(supabase,userId) {
  if(!supabase||!userId)throw new Error('Authenticated Mio connection required')
  const [entries,invoices]=await Promise.all([
    fetchAllRows(supabase,'mio_billing_entries','id,matter_id,amount,do_not_bill,payload',userId),
    fetchAllRows(supabase,'mio_invoices','id,matter_id,invoice_type,status,total,amount_paid,balance,issue_date,created_at',userId)
  ])
  const summary=summarizeWeeklyBillingEntries(entries,invoices)
  return {wipByMatter:Object.fromEntries([...summary.wip].map(([k,v])=>[k,v/100])),
    workOBByMatter:Object.fromEntries([...summary.workOB].map(([k,v])=>[k,v/100])),
    oldestByMatter:Object.fromEntries(summary.oldestInvoice),
    recordCount:{entries:entries.length,invoices:invoices.length}}
}
