// Authenticated, read-only billing data adapter.
// Do not use these rows to authorize trust disbursement or invoice generation.
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0
const cents = value => Math.round(num(value)*100)

export function isEligibleWeeklyWipEntry(entry = {}) {
  const payload=entry.payload && typeof entry.payload==='object'?entry.payload:{}
  return Boolean(entry.id&&entry.matter_id&&entry.do_not_bill!==true&&payload.do_not_bill!==true&&
    payload.non_billable!==true&&!payload.invoice_id&&!payload.invoiced_at&&Number.isFinite(Number(entry.amount))&&num(entry.amount)>0)
}
export function prepareWeeklyInvoiceDrafts(entries = [], selectedMatterIds = []) {
  const selected=new Set(selectedMatterIds.map(String))
  const grouped=new Map()
  for(const entry of entries) {
    if(!isEligibleWeeklyWipEntry(entry)||!selected.has(String(entry.matter_id)))continue
    const key=String(entry.matter_id)
    if(!grouped.has(key))grouped.set(key,[])
    grouped.get(key).push({entryId:String(entry.id),date:entry.entry_date||entry.payload?.date||'',
      description:String(entry.description||entry.payload?.description||''),amountCents:cents(entry.amount)})
  }
  return [...grouped.entries()].map(([matterId,items])=>({
    matterId,entryIds:items.map(x=>x.entryId).sort(),totalCents:items.reduce((sum,x)=>sum+x.amountCents,0),
    lineItems:items.sort((a,b)=>a.date.localeCompare(b.date)||a.entryId.localeCompare(b.entryId))
  })).sort((a,b)=>a.matterId.localeCompare(b.matterId))
}
export function validateWeeklyInvoiceSnapshot(snapshot, freshEntries = []) {
  const fresh=prepareWeeklyInvoiceDrafts(freshEntries,(snapshot||[]).map(x=>x.matterId))
  const expected=(snapshot||[]).map(x=>({
    matterId:x.matterId,
    entryIds:[...x.entryIds].sort(),
    totalCents:x.totalCents,
    lineItems:x.lineItems
  })).sort((a,b)=>a.matterId.localeCompare(b.matterId))
  const actual=fresh.map(x=>({matterId:x.matterId,entryIds:x.entryIds,totalCents:x.totalCents,lineItems:x.lineItems}))
  return JSON.stringify(expected)===JSON.stringify(actual)
}
export function summarizeWeeklyBillingEntries(entries = [], invoices = []) {
  const wip = new Map(), workOB = new Map(), oldestInvoice = new Map()
  for (const entry of entries) {
    if (!isEligibleWeeklyWipEntry(entry)) continue
    const key=String(entry.matter_id)
    wip.set(key,(wip.get(key)||0)+cents(entry.amount))
  }
  for(const invoice of invoices) {
    if (!invoice.matter_id || invoice.invoice_type !== 'services' || !['outstanding','partially_paid'].includes(String(invoice.status||'').toLowerCase())) continue
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
    fetchAllRows(supabase,'mio_billing_entries','id,matter_id,entry_date,description,amount,do_not_bill,payload',userId),
    fetchAllRows(supabase,'mio_invoices','id,matter_id,invoice_type,status,total,amount_paid,balance,issue_date,created_at',userId)
  ])
  const {data:withdrawalRows,error:withdrawalError}=await supabase.from('mio_withdrawal_workflows').select('matter_id,state').eq('owner_id',userId)
  if(withdrawalError)throw new Error('Withdrawal status: '+withdrawalError.message)
  const withdrawalByMatter=Object.fromEntries((withdrawalRows||[]).map(row=>[String(row.matter_id),String(row.state?.status||'unknown')]))
  const summary=summarizeWeeklyBillingEntries(entries,invoices)
  return {wipByMatter:Object.fromEntries([...summary.wip].map(([k,v])=>[k,v/100])),
    workOBByMatter:Object.fromEntries([...summary.workOB].map(([k,v])=>[k,v/100])),
    oldestByMatter:Object.fromEntries(summary.oldestInvoice),
    withdrawalByMatter,
    // Entry IDs are the immutable review basis; re-check them immediately before invoicing.
    entries:entries.map(x=>({id:x.id,matter_id:x.matter_id,entry_date:x.entry_date,
      amount:x.amount,description:x.description,do_not_bill:x.do_not_bill,payload:x.payload})),
    recordCount:{entries:entries.length,invoices:invoices.length}}
}
