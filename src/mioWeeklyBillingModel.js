// Pure read-only proposal engine. Amounts are dollars. This module never posts invoices or moves trust.
const cents = value => Math.max(0, Math.round((Number(value) || 0) * 100))
const amount = value => Math.round(value) / 100
export function weeklyBillingDefaults(matter = {}) {
  const appointed = Boolean(matter.appointed ?? matter.is_appointed ?? matter.court_appointed ?? false)
  return {appointed, included: !appointed, shareTrust: true}
}
export function createWeeklyBillingProposal({matters = [], minimumWip = 150, selectedIds = null, authorizations = {}} = {}) {
  const threshold = cents(minimumWip)
  const normalized = matters.map(row => {
    const defaults = weeklyBillingDefaults(row)
    const included = row.included ?? defaults.included
    const shareTrust = row.shareTrust ?? defaults.shareTrust
    const wip = cents(row.wip)
    const selected = included && (selectedIds ? selectedIds.includes(String(row.id)) : wip >= threshold)
    return {...row, id:String(row.id), clientId:String(row.clientId || ''), included, shareTrust, selected,
      wipCents:wip, dueCents:cents(row.workOB) + (selected ? wip : 0), trustCents:cents(row.availableTrust)}
  })
  const balance = new Map(normalized.map(m=>[m.id,m.trustCents]))
  const owing = new Map(normalized.map(m=>[m.id,m.dueCents]))
  const proposals = []
  const makePayment = (source,dest) => {
    if (!dest.included || !source.included || !source.clientId || source.clientId !== dest.clientId) return
    if (source.id !== dest.id && (!source.shareTrust || authorizations[source.id] !== true)) return
    const payment = Math.min(balance.get(source.id), owing.get(dest.id))
    if (payment <= 0) return
    proposals.push({id:source.id+':'+dest.id,sourceMatterId:source.id,destinationMatterId:dest.id,
      sourceName:source.name,destinationName:dest.name,clientId:source.clientId,
      amount:amount(payment),crossMatter:source.id!==dest.id, requiresAuthorization:source.id!==dest.id})
    balance.set(source.id,balance.get(source.id)-payment)
    owing.set(dest.id,owing.get(dest.id)-payment)
  }
  // First satisfy each source matter's own eligible work, before any cross-matter allocation.
  for (const matter of normalized) makePayment(matter,matter)
  // Stable oldest-first order for remaining balances within a client.
  const destinations = normalized.filter(m=>m.included).sort((a,b)=>String(a.oldestInvoiceDate||'9999').localeCompare(String(b.oldestInvoiceDate||'9999')) || a.id.localeCompare(b.id))
  for (const dest of destinations) for (const source of normalized) if (source.id !== dest.id) makePayment(source,dest)
  return {
    matters:normalized.map(m=>({id:m.id,name:m.name,clientId:m.clientId,appointed:m.appointed, included:m.included,
      shareTrust:m.shareTrust,selected:m.selected,wip:amount(m.wipCents),workOB:amount(m.dueCents),
      availableTrust:amount(m.trustCents),unpaid:amount(owing.get(m.id))})),
    payments:proposals,
    totalWip:amount(normalized.filter(m=>m.selected).reduce((n,m)=>n+m.wipCents,0)),
    totalPayments:amount(proposals.reduce((n,p)=>n+cents(p.amount),0)),
    excluded:normalized.filter(m=>!m.included).length
  }
}

/**
 * Reconcile the reviewer's one-run payment decisions without altering any ledger.
 * Excluded proposals are not paid; the unpaid total must reflect those exclusions.
 */
export function reconcileWeeklyBillingReview(proposal, rejectedPaymentIds = []) {
  const rejected = new Set(rejectedPaymentIds.map(String))
  const applied = (proposal.payments || []).filter(payment => !rejected.has(String(payment.id)))
  const paidByMatter = new Map()
  const spentBySource = new Map()
  for (const payment of applied) {
    paidByMatter.set(payment.destinationMatterId,(paidByMatter.get(payment.destinationMatterId)||0)+cents(payment.amount))
    spentBySource.set(payment.sourceMatterId,(spentBySource.get(payment.sourceMatterId)||0)+cents(payment.amount))
  }
  const matters = proposal.matters.map(m => ({
    ...m,
    paid: amount(paidByMatter.get(m.id)||0),
    unpaid: amount(Math.max(0,cents(m.workOB)-(paidByMatter.get(m.id)||0))),
    remainingTrust: amount(Math.max(0,cents(m.availableTrust)-(spentBySource.get(m.id)||0)))
  }))
  return {payments:applied,matters,totalPayments:amount(applied.reduce((n,p)=>n+cents(p.amount),0))}
}

/**
 * Informational only: show possible sharing before authorization and reconciliation.
 * The input balance is a DISPLAY balance, never proof of available or transferable funds.
 */
export function possibleCrossMatterFunding(matters = []) {
  const normalized=matters.map(m=>({...m,id:String(m.id),clientId:String(m.clientId||''),displayCents:cents(m.displayTrust),owedCents:cents(m.workOB)+cents(m.selectedWip)}))
  const possible=[]
  const remainingOwed=new Map(normalized.map(m=>[m.id,Math.max(0,m.owedCents-m.displayCents)]))
  for (const source of normalized) {
    if (!source.included || !source.shareTrust || !source.clientId) continue
    let remainder=Math.max(0,source.displayCents-source.owedCents)
    if (!remainder) continue
    const destinations=normalized.filter(dest=>dest.id!==source.id&&dest.clientId===source.clientId&&dest.included&&remainingOwed.get(dest.id)>0)
    for (const dest of destinations) {
      const suggested=Math.min(remainder,remainingOwed.get(dest.id))
      if (!suggested) continue
      possible.push({id:source.id+':'+dest.id,sourceMatterId:source.id,destinationMatterId:dest.id,
        sourceName:source.name,destinationName:dest.name,amount:amount(suggested),status:'unverified'})
      remainder-=suggested
      remainingOwed.set(dest.id,remainingOwed.get(dest.id)-suggested)
    }
  }
  return possible
}
