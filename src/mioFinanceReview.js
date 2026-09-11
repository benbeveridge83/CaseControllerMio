// Shared presentation and verification rules. Amounts in this module are dollars
// except provider fields explicitly ending in _cents. No function writes money.
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const cents = value => Math.round(number(value) * 100)
export const completedPayment = status => ['completed','complete','settled','succeeded','success','paid','captured'].includes(String(status || '').trim().toLowerCase())
export function passesTrustMinimum(trust, minimum) {
  if (minimum === '' || minimum === null || minimum === undefined) return true
  if (trust === null || trust === undefined || trust === '') return false
  const floor = Number(minimum), amount = Number(trust)
  return Number.isFinite(floor) && Number.isFinite(amount) && cents(amount) >= cents(floor)
}
const dateFields = new Set(['created','sent','lastPayment','trustPaid','clientPaid','issued','due'])
const moneyFields = new Set(['total','paidAmount','pendingAmount','balance'])
export function compareInvoiceRows(a,b,sort,valueFor) {
  const compare = (field,direction) => {
    const av=valueFor(a,field),bv=valueFor(b,field),sign=direction==='desc'?-1:1
    if(dateFields.has(field)) {
      const at=av?Date.parse(av):NaN,bt=bv?Date.parse(bv):NaN
      if(!Number.isFinite(at)||!Number.isFinite(bt))return Number.isFinite(at)?-1:Number.isFinite(bt)?1:0
      return (at-bt)*sign
    }
    return (moneyFields.has(field)?number(av)-number(bv):String(av??'').localeCompare(String(bv??''),undefined,{numeric:true}))*sign
  }
  const primary=compare(sort.field||'created',sort.direction||'desc')
  if(primary)return primary
  const secondary=sort.secondary===undefined?'created':sort.secondary
  if(secondary&&secondary!==sort.field){const result=compare(secondary,sort.secondaryDirection||'asc');if(result)return result}
  return String(a.invoice?.id||a.id||'').localeCompare(String(b.invoice?.id||b.id||''))
}
export function replenishmentCandidate(matterId,invoices,amount) {
  const active=invoices.filter(i=>String(i.matter_id)===String(matterId)&&i.invoice_type==='trust_request'&&!['void','paid'].includes(i.status)&&number(i.balance??(number(i.total)-number(i.amount_paid)))>0.005)
  if(active.length>1)return {blocked:true,reason:'Multiple open trust requests already exist. Review them in All invoices before creating another.'}
  if(active.length) {
    const invoice=active[0]
    if(invoice.emailed_at||(invoice.email_history||[]).length||number(invoice.amount_paid)>0.005)return {blocked:true,invoice,reason:'An outstanding trust request has already been sent or partially paid. No duplicate will be created or resent.'}
    return {blocked:false,invoice,amount:number(invoice.total)}
  }
  if(!Number.isFinite(Number(amount))||Number(amount)<=0.005)return {blocked:true,reason:'No replenishment is currently due.'}
  return {blocked:false,invoice:null,amount:Number(amount)}
}
export function operatingPaymentMarkers({matterId,invoices=[],events=[],openingDate=''}) {
  const matches=new Map(invoices.filter(i=>String(i.matter_id)===String(matterId)&&i.invoice_type!=='trust_request'&&i.status!=='void').map(i=>[String(i.id),i]))
  const unique=new Map()
  for(const event of events) {
    if(!['lawpay_payment_recorded','lawpay_payment_reversed','outside_payment_recorded','client_payment_recorded'].includes(event.event_type))continue
    const invoice=matches.get(String(event.invoice_id))
    if(!invoice||!event.occurred_at||!Number.isFinite(Date.parse(event.occurred_at))||Math.abs(number(event.amount))<=0.005)continue
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(event.occurred_at))
    if(openingDate&&date<=openingDate)continue
    const key=String(event.provider_event_id||event.id||'')
    if(!key)continue
    const amount=number(event.amount)*(event.event_type.endsWith('_reversed')?-1:1)
    unique.set(`${invoice.id}:${event.event_type}:${key}`,{
      id:`operating:${invoice.id}:${event.event_type}:${key}`,matter_id:matterId,invoice_id:invoice.id,
      reference:invoice.invoice_number,date,occurred_at:event.occurred_at,created_at:event.occurred_at,
      accounting_at:new Date(event.occurred_at).toISOString(),direction:'operating',amount:Math.abs(amount),
      operating_payment:amount,trust_delta:0,accounting_source:event.event_type.startsWith('lawpay')?'LawPay - Operating':'Outside payment',
      payer_payee:invoice.client_name||'',memo:amount>=0?'Payment received into Operating; no trust movement':'Operating payment reversed; no trust movement'
    })
  }
  return [...unique.values()].sort((a,b)=>a.accounting_at.localeCompare(b.accounting_at)||a.id.localeCompare(b.id))
}
export async function scanLawPayPages(invoke,options={},onProgress=()=>{}) {
  let page=1,processed=0,total=null;const warnings=[]
  for(let iteration=0;iteration<10000;iteration++) {
    const data=await invoke({...options,page,page_size:options.page_size||50})
    if(!data?.ok)throw new Error(data?.error||'LawPay scan failed.')
    if(Number(data.page)!==page)throw new Error('LawPay pagination did not make progress. Update the gateway before retrying.')
    processed+=number(data.processed);total=number(data.total_entries);warnings.push(...(data.warnings||[]))
    onProgress({page,processed,total})
    if(data.has_more===false)return {...data,processed,pages:page,total_entries:total,warnings}
    if(data.has_more!==true||Number(data.next_page)<=page)throw new Error('LawPay pagination did not make progress; scan is incomplete.')
    page=Number(data.next_page)
  }
  throw new Error('LawPay scan reached its page safety limit and is incomplete.')
}
export function transactionInvoiceNumber(tx={}) {
  const raw=tx.raw&&typeof tx.raw==='object'?tx.raw:{}
  const fields=raw.data?.custom_fields||raw.custom_fields||{}
  return String(tx.invoice_number||raw.mio_invoice_number||raw.invoice_number||fields.Invoice||fields.invoice||'').trim().toUpperCase()||String(tx.reference||raw.reference||'').match(/MIO-\d{4}-\d+/i)?.[0]?.toUpperCase()||''
}
export function auditLawPayRecords(transactions=[],invoices=[],events=[]) {
  const byNumber=new Map(invoices.map(i=>[String(i.invoice_number||'').toUpperCase(),i]))
  const issues=[],unlinked=[];let matched=0,completed=0
  const seen=new Set()
  for(const tx of transactions) {
    const id=String(tx.gateway_transaction_id||tx.id||'')
    if(!id||seen.has(id)||!completedPayment(tx.status))continue
    seen.add(id)
    const type=String(tx.transaction_type||tx.type||'').toUpperCase()
    if(!['CHARGE','REFUND','REVERSAL','CHARGEBACK'].includes(type))continue
    completed++
    const invoiceNumber=transactionInvoiceNumber(tx),invoice=byNumber.get(invoiceNumber)
    const detail={id,invoiceNumber,payer:tx.payer_name||tx.payer_email||'',amount:number(tx.amount_cents)/100,type}
    if(!invoiceNumber){unlinked.push({...detail,kind:'unlinked',reason:'No Mio invoice reference. Review attribution; this may be a consultation or refund.'});continue}
    if(!invoice){issues.push({...detail,kind:'missing_invoice',reason:'The referenced Mio invoice was not found.'});continue}
    const paymentEvents=events.filter(e=>String(e.invoice_id)===String(invoice.id)&&e.event_type==='lawpay_payment_recorded'&&String(e.provider_event_id)===id)
    if(!paymentEvents.length){issues.push({...detail,kind:'unapplied',reason:'Completed transaction has no posted invoice payment event.'});continue}
    const net=type==='CHARGE'?Math.max(0,number(tx.amount_cents)-number(tx.amount_refunded_cents)):-Math.abs(number(tx.amount_cents))
    if(paymentEvents.length!==1||cents(paymentEvents[0].amount)!==Math.round(net)) {issues.push({...detail,kind:'amount_mismatch',reason:'The invoice payment event amount or event count does not match LawPay.'});continue}
    if(type==='CHARGE'&&cents(invoice.amount_paid)<net){issues.push({...detail,kind:'invoice_balance',reason:'Invoice paid amount is lower than this posted payment.'});continue}
    matched++
  }
  return {completed,matched,issues,unlinked}
}

export function bulkInvoiceActionEligibility(invoice={}) {
  const status=String(invoice.status||'').toLowerCase()
  const sent=!!(invoice.emailed_at||(invoice.email_history||[]).length)
  const active=!['paid','void','deleted'].includes(status)
  return {approve:active&&status==='draft',send:active&&!sent,resend:active&&sent&&status!=='draft'}
}
