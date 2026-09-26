import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const modelPath = new URL('../src/mioFinanceReview.js', import.meta.url)
const load = () => import(modelPath)

test('trust minimum is inclusive, optional, and excludes unknown values when active', async () => {
  const { passesTrustMinimum: p } = await load()
  assert.equal(p(499.99, '500'), false); assert.equal(p(500, '500'), true); assert.equal(p(0, '0'), true); assert.equal(p(-1, '0'), false); assert.equal(p(null, '500'), false); assert.equal(p(null, ''), true)
})
test('invoice header groups status and sorts each group chronologically, missing dates last', async () => {
  const { compareInvoiceRows } = await load(); const rows=[{id:'p-new',status:'Paid',created:'2026-09-09'},{id:'o-unknown',status:'Outstanding',created:''},{id:'p-old',status:'Paid',created:'2026-08-01'},{id:'o-new',status:'Outstanding',created:'2026-09-08'},{id:'o-old',status:'Outstanding',created:'2026-08-02'}]; const value=(r,k)=>r[k]; const sort={field:'status',direction:'asc',secondary:'created',secondaryDirection:'asc'}
  assert.deepEqual(rows.slice().sort((a,b)=>compareInvoiceRows(a,b,sort,value)).map(r=>r.id),['o-old','o-new','o-unknown','p-old','p-new']); sort.secondaryDirection='desc'; assert.deepEqual(rows.slice().sort((a,b)=>compareInvoiceRows(a,b,sort,value)).map(r=>r.id),['o-new','o-old','o-unknown','p-new','p-old'])
})
test('operating payments appear exactly once without being added to trust', async () => {
  const { operatingPaymentMarkers }=await load(); const invoice={id:'invoice-test',matter_id:'matter-test',invoice_type:'services',invoice_number:'MIO-2026-123456'}; const event={id:'event-a',invoice_id:invoice.id,event_type:'lawpay_payment_recorded',provider_event_id:'gateway-test',amount:1012.50,occurred_at:'2026-09-09T15:13:36.860Z'}; const rows=operatingPaymentMarkers({matterId:'matter-test',invoices:[invoice],events:[event,{...event,id:'event-b'}],openingDate:'2026-08-09'}); assert.equal(rows.length,1); assert.equal(rows[0].operating_payment,1012.50); assert.equal(rows[0].trust_delta,0)
})
test('a repeated replenishment preview reuses unsent drafts and never resends existing requests', async () => {
  const {replenishmentCandidate}=await load(); const draft={id:'draft',matter_id:'m',invoice_type:'trust_request',status:'draft',total:500,amount_paid:0,balance:500}; assert.equal(replenishmentCandidate('m',[draft],0).invoice.id,'draft'); assert.equal(replenishmentCandidate('m',[{...draft,status:'outstanding',emailed_at:'2026-09-11'}],0).blocked,true); assert.equal(replenishmentCandidate('m',[],500).amount,500)
})
test('gateway page traversal cannot claim completion after page one or a failed page', async () => {
  const {scanLawPayPages}=await load(); const calls=[]; const result=await scanLawPayPages(async body=>{calls.push(body);return {ok:true,page:body.page,total_entries:3,processed:body.page===1?2:1,has_more:body.page===1,next_page:body.page===1?2:null}},{}); assert.equal(result.processed,3); assert.equal(calls.length,2); await assert.rejects(scanLawPayPages(async body=>body.page===1?{ok:true,page:1,has_more:true,next_page:2,processed:1}:{ok:false,error:'provider unavailable'},{}),/provider unavailable/)
})
test('audit distinguishes unmatched consults, unapplied invoice payments, and amount discrepancies', async () => {
  const {auditLawPayRecords}=await load(); const tx={id:'local',gateway_transaction_id:'gateway',transaction_type:'CHARGE',status:'COMPLETED',amount_cents:101250,reference:'Case | MIO-2026-123456'}; const invoice={id:'i',invoice_number:'MIO-2026-123456',amount_paid:2562.5,invoice_type:'services'}; const event={invoice_id:'i',event_type:'lawpay_payment_recorded',provider_event_id:'gateway',amount:1012.5}; assert.equal(auditLawPayRecords([tx],[invoice],[event]).issues.length,0); assert.equal(auditLawPayRecords([tx],[invoice],[]).issues[0].kind,'unapplied')
})
test('a linked PNC consultation payment needs no invoice while an unresolved one stays actionable', async () => {
  const {auditLawPayRecords}=await load()
  const reference='PNC-CONSULT-F0689380-FF9F-46C5-9489-6D5FB306B1DD-15000'
  const linked={id:'local-consult',gateway_transaction_id:'provider-consult',transaction_type:'CHARGE',status:'COMPLETED',amount_cents:15000,reference,account_key:'operating',raw:{mio_payment_request_id:'request-consult',mio_invoice_number:reference}}
  const request={id:'request-consult',reference,invoice_number:reference,account_key:'operating',amount_cents:15000}
  const recorded=auditLawPayRecords([linked],[],[],[request])
  assert.equal(recorded.matched,1)
  assert.deepEqual(recorded.issues,[])
  assert.deepEqual(recorded.unlinked,[])

  const refund=auditLawPayRecords([{...linked,gateway_transaction_id:'provider-consult-refund',transaction_type:'REFUND'}],[],[],[request])
  assert.equal(refund.matched,0,'a consultation refund is not hidden as the linked charge')
  assert.equal(refund.unlinked[0].kind,'unlinked_refund')

  const unresolved=auditLawPayRecords([{...linked,raw:{mio_invoice_number:reference}}],[],[],[])
  assert.deepEqual(unresolved.issues,[],'a consultation reference is never reported as a missing invoice')
  assert.equal(unresolved.unlinked.length,1)
  assert.equal(unresolved.unlinked[0].kind,'unlinked_consultation')

  const missingInvoice=auditLawPayRecords([{...linked,reference:'MIO-2026-999999',raw:{mio_invoice_number:'MIO-2026-999999'}}],[],[],[])
  assert.equal(missingInvoice.issues[0].kind,'missing_invoice','a genuine missing Mio invoice remains an invoice issue')
})
test('the reconciliation status message uses the audit counts supplied at render time', async () => {
  const {lawPayReconciliationMessage}=await load()
  const message=lawPayReconciliationMessage({processed:24,pages:1,openingDate:'2026-08-09',checkedAtLabel:'9/25/2026, 9:06:01 PM'},{issues:[{id:'invoice'}],unlinked:[]})
  assert.equal(message,'Checked 24 LawPay transaction(s) across 1 page(s), from 2026-08-09 through 9/25/2026, 9:06:01 PM. 1 invoice issue(s); 0 unlinked transaction(s) require review. No trust funds were transferred.')
})
test('every reviewed transaction reports its LawPay deposit account without guessing', async () => {
  const {auditLawPayRecords,lawPayAccountLabel,transactionAccountKey}=await load()
  const rows=[{id:'a',gateway_transaction_id:'a',transaction_type:'CHARGE',status:'COMPLETED',amount_cents:500000,account_key:'trust'},
    {id:'b',gateway_transaction_id:'b',transaction_type:'CHARGE',status:'COMPLETED',amount_cents:100000,account_key:'operating',payer_name:'Unlinked payer'},
    {id:'c',gateway_transaction_id:'c',transaction_type:'CHARGE',status:'COMPLETED',amount_cents:12500,account_id:'acct-1137',raw:{mio_account_key_source:'unresolved'}}]
  const audit=auditLawPayRecords(rows,[],[])
  assert.equal(audit.unlinked.length,3)
  assert.deepEqual(audit.unlinked.map(row=>row.account),['trust','operating',''])
  assert.deepEqual(audit.unlinked.map(row=>row.account_label),['Trust','Operating','Account not reported'])
  assert.deepEqual(audit.issues.map(row=>row.account_label),[])
  assert.equal(transactionAccountKey({account_key:'OPERATING'}),'operating')
  assert.equal(transactionAccountKey({raw:{account_key:'trust'}}),'trust')
  assert.equal(lawPayAccountLabel({account_key:'echeck_trust'}),'Trust (e-check)')
  assert.equal(lawPayAccountLabel({account_key:'clientcredit_trust'}),'Trust (client credit)')
  assert.equal(lawPayAccountLabel({account_key:'echeck_operating'}),'Operating (e-check)')
  assert.equal(lawPayAccountLabel('trust'),'Trust')
  assert.equal(lawPayAccountLabel({account_key:'ach_something'}),'Account ach_something')
  assert.equal(lawPayAccountLabel({}),'Account not reported')
})
test('baseline reproduction: trust-only accounting omits a posted operating payment marker', () => {
  const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8'); const start=source.indexOf('  function accountingLedgerRows('),end=source.indexOf('\n  function ',start+10); const ctx={accountingOutstandingEvents:()=>[],financeNumber:Number,accountingDateTime:String,financeDateOnly:String,activeMioBillingCutoverDate:'2026-08-09',clioHistoricalFinancialArchive:[]}; vm.createContext(ctx); vm.runInContext(source.slice(start,end)+'\nthis.run=accountingLedgerRows',ctx); assert.equal(ctx.run({id:'m'},{currentLedgerRows:[],invoices:[{id:'i',amount_paid:1012.5}],outstanding:0}).length,0)
})
test('gateway page metadata enforces full traversal and rejects silent truncation',async()=>{const {pageMetadata}=await import('../supabase/functions/_shared/lawpay-v314.js'); assert.equal(pageMetadata({results:[1,2],total_entries:3,page:1},1,2).has_more,true); assert.throws(()=>pageMetadata({results:[],total_entries:5,page:2},2,2),/empty page/)})
test('provider ingestion posts through the atomic RPC before marking an event processed',async()=>{const {storeProviderTransaction}=await import('../supabase/functions/_shared/lawpay-v314.js'); const calls=[]; const db={from(){return {select(){return this},eq(){return this},order(){return this},limit(){return Promise.resolve({data:[{id:'r',invoice_number:'MIO-2026-123456',matter_id:'m',created_at:'2026-08-01',account_key:'operating'}]})},maybeSingle(){return Promise.resolve({data:null})},insert(){calls.push('event');return Promise.resolve({data:null})}}},async rpc(){calls.push('atomic');return {data:{status:'posted'}}}}; await storeProviderTransaction(db,{id:'test-id',amount:101250,status:'COMPLETED',type:'CHARGE',created:'2026-09-09T15:13:36Z',reference:'MIO-2026-123456'},{event:{id:'event',type:'transaction.completed'}}); assert.deepEqual(calls,['atomic','event'])})
test('bulk invoice review classifies approve, send, and resend safely', async () => {
  const {bulkInvoiceActionEligibility}=await load()
  assert.deepEqual(bulkInvoiceActionEligibility({status:'draft',emailed_at:''}),{approve:true,send:true,resend:false})
  assert.deepEqual(bulkInvoiceActionEligibility({status:'outstanding',emailed_at:''}),{approve:false,send:true,resend:false})
  assert.deepEqual(bulkInvoiceActionEligibility({status:'outstanding',emailed_at:'2026-09-11T10:00:00Z'}),{approve:false,send:false,resend:true})
  assert.deepEqual(bulkInvoiceActionEligibility({status:'paid',emailed_at:'2026-09-11T10:00:00Z'}),{approve:false,send:false,resend:false})
  assert.deepEqual(bulkInvoiceActionEligibility({status:'void',emailed_at:''}),{approve:false,send:false,resend:false})
})
