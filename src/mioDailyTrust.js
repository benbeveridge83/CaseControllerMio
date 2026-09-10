// Money is allocated in cents, once per matter, never across client trust ledgers.
export const cents = value => Math.round((Number(value) || 0) * 100)
export function entryCents(entry) {
  if (entry.non_billable || entry.do_not_bill || entry.deleted_at || ['void','deleted'].includes(entry.status)) return 0
  return Math.max(0, cents(entry.amount ?? (Number(entry.billing_time || 0) * Number(entry.rate || 0))))
}
export function firmDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(value)
}
export function dailyTrustSummary({date, entries=[], matters=[], financeFor, pendingFor=()=>0}) {
  const byMatter=new Map(matters.map(m=>[String(m.id),m])), grouped=new Map()
  const result={total:0,dfps:0,nonDfps:0,covered:0,uncovered:0,paid:0,unknown:0,rows:[]}
  const seen=new Set()
  for(const e of entries){if(String(e.date||e.entry_date||'').slice(0,10)!==date)continue
    if(e.id&&seen.has(String(e.id)))continue;if(e.id)seen.add(String(e.id))
    const amount=entryCents(e);if(!amount)continue
    const id=String(e.matter_id||'');if(!grouped.has(id))grouped.set(id,[]);grouped.get(id).push(e)
  }
  for(const [id,dayEntries] of grouped){
    const matter=byMatter.get(id),total=dayEntries.reduce((s,e)=>s+entryCents(e),0)
    const type=String(matter?.matter_type||matter?.case_type||'').trim()
    const row={id,name:matter?.name||'Unlinked matter',total,covered:0,uncovered:0,paid:0,unknown:0,trust:0,reserved:0,pending:0}
    result.total+=total
    if(!matter||!type){row.unknown=total;row.note='Matter or case type is missing';result.unknown+=total;result.rows.push(row);continue}
    if(/^dfps$/i.test(type)){result.dfps+=total;row.note='DFPS - monthly billing';result.rows.push(row);continue}
    result.nonDfps+=total
    const f=financeFor(matter)
    if(!f||f.financialSnapshotResolved===false||f.blockedOpeningWipInvoiceIds?.size){row.unknown=total;row.note='Finance needs review';result.unknown+=total;result.rows.push(row);continue}
    // Only currently outstanding charges may be covered again. Already-paid invoice
    // lines are excluded, with invoice payments allocated oldest service date first.
    const invoices=new Map((f.serviceInvoices||[]).filter(i=>!['void','cancelled'].includes(i.status)).map(i=>[String(i.id),i]))
    const unpaidLines=new Map();let invoiceLiability=0
    const liabilityIds=new Set((f.obligationInvoices||[...invoices.values()]).map(i=>String(i.id)))
    for(const i of invoices.values()){
      const remaining=Math.max(0,cents(i.balance??(Number(i.total||0)-Number(i.amount_paid||0))))
      if(liabilityIds.has(String(i.id)))invoiceLiability+=remaining
      let payment=Math.max(0,cents(i.total)-remaining)
      const lines=[...(i.line_items||[])].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')))
      for(const l of lines){const amount=Math.max(0,cents(l.amount)),used=Math.min(payment,amount);payment-=used
        if(l.billing_entry_id)unpaidLines.set(String(l.billing_entry_id),(unpaidLines.get(String(l.billing_entry_id))||0)+amount-used)
      }
    }
    const eligible=new Set((f.uninvoicedEntries||[]).map(e=>String(e.id)))
    let unpaid=0,unknown=0
    for(const e of dayEntries){const amount=entryCents(e)
      if(!e.invoice_id){if(eligible.has(String(e.id)))unpaid+=amount;else unknown+=amount;continue}
      const i=invoices.get(String(e.invoice_id))
      if(!i){unknown+=amount;continue}
      if(unpaidLines.has(String(e.id))){const left=Math.min(amount,unpaidLines.get(String(e.id)));unpaid+=left;row.paid+=amount-left}
      else if(cents(i.balance??(Number(i.total||0)-Number(i.amount_paid||0)))===0)row.paid+=amount
      else unknown+=amount
    }
    // outstanding includes opening AR and non-draft invoices; explicitly include
    // draft service invoices too, without adding their value twice.
    const postedInvoiceLiability=[...invoices.values()].filter(i=>i.status!=='draft'&&liabilityIds.has(String(i.id))).reduce((n,i)=>n+Math.max(0,cents(i.balance??(Number(i.total||0)-Number(i.amount_paid||0)))),0)
    const openingAR=f.openingOutstanding!=null?Math.max(0,cents(f.openingOutstanding)):Math.max(0,cents(f.outstanding)-postedInvoiceLiability)
    const obligations=Math.max(0,cents(f.wip))+invoiceLiability+openingAR
    row.reserved=Math.max(0,obligations-unpaid)
    row.trust=Math.max(0,cents(f.trust));row.pending=Math.max(0,cents(pendingFor(matter)))
    row.covered=Math.min(unpaid,Math.max(0,row.trust-row.reserved));row.uncovered=unpaid-row.covered;row.unknown=unknown
    row.note=unknown?'Some entries cannot be reconciled to current finance records':''
    result.covered+=row.covered;result.uncovered+=row.uncovered;result.paid+=row.paid;result.unknown+=unknown;result.rows.push(row)
  }
  return result
}
