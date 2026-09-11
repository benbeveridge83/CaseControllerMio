import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// The imported model is used by the production transform, not a parallel test implementation.
const modelPath = new URL('../src/mioFinanceReview.js', import.meta.url)
const load = () => import(modelPath)

test('trust minimum is inclusive, optional, and excludes unknown values when active', async () => {
  const { passesTrustMinimum: p } = await load()
  assert.equal(p(499.99, '500'), false)
  assert.equal(p(500, '500'), true)
  assert.equal(p(0, '0'), true)
  assert.equal(p(-1, '0'), false)
  assert.equal(p(null, '500'), false)
  assert.equal(p(null, ''), true)
})
test('invoice header groups status and sorts each group chronologically, missing dates last', async () => {
  const { compareInvoiceRows } = await load()
  const rows = [
    {id:'p-new',status:'Paid',created:'2026-09-09'},
    {id:'o-unknown',status:'Outstanding',created:''},
    {id:'p-old',status:'Paid',created:'2026-08-01'},
    {id:'o-new',status:'Outstanding',created:'2026-09-08'},
    {id:'o-old',status:'Outstanding',created:'2026-08-02'}
  ]
  const value = (r,k)=>r[k]
  const sort = {field:'status',direction:'asc',secondary:'created',secondaryDirection:'asc'}
  assert.deepEqual(rows.slice().sort((a,b)=>compareInvoiceRows(a,b,sort,value)).map(r=>r.id), ['o-old','o-new','o-unknown','p-old','p-new'])
  sort.secondaryDirection='desc'
  assert.deepEqual(rows.slice().sort((a,b)=>compareInvoiceRows(a,b,sort,value)).map(r=>r.id), ['o-new','o-old','o-unknown','p-new','p-old'])
  assert.equal(compareInvoiceRows({total:9},{total:100},{field:'total',direction:'asc'},value)<0,true)
})
test('operating payments appear exactly once without being added to trust', async () => {
  const { operatingPaymentMarkers } = await load()
  const invoice = {id:'invoice-test',matter_id:'matter-test',invoice_type:'services',invoice_number:'MIO-2026-123456'}
  const event = {id:'event-a',invoice_id:invoice.id,event_type:'lawpay_payment_recorded',provider_event_id:'gateway-test',amount:1012.50,occurred_at:'2026-09-09T15:13:36.860Z'}
  const rows = operatingPaymentMarkers({matterId:'matter-test',invoices:[invoice],events:[event,{...event,id:'event-b'}],openingDate:'2026-08-09'})
  assert.equal(rows.length,1)
  assert.equal(rows[0].operating_payment,1012.50)
  assert.equal(rows[0].direction,'operating')
  assert.equal(rows[0].invoice_id,invoice.id)
  assert.equal(rows[0].trust_delta,0)
  assert.equal(operatingPaymentMarkers({matterId:'matter-test',invoices:[{...invoice,invoice_type:'trust_request'}],events:[event]}).length,0)
})
test('a repeated replenishment preview reuses unsent drafts and never resends existing requests', async () => {
  const { replenishmentCandidate } = await load()
  const draft={id:'draft',matter_id:'m',invoice_type:'trust_request',status:'draft',total:500,amount_paid:0,balance:500}
  assert.equal(replenishmentCandidate('m',[draft],0).invoice.id,'draft')
  assert.equal(replenishmentCandidate('m',[{...draft,status:'outstanding',emailed_at:'2026-09-11'}],0).blocked,true)
  assert.equal(replenishmentCandidate('m',[{...draft,amount_paid:50,balance:450}],500).blocked,true)
  assert.equal(replenishmentCandidate('m',[],500).amount,500)
  assert.equal(replenishmentCandidate('m',[],0).blocked,true)
})
test('gateway page traversal cannot claim completion after page one or a failed page', async () => {
  const { scanLawPayPages } = await load()
  const calls=[]
  const result=await scanLawPayPages(async body=>{calls.push(body);return {ok:true,page:body.page,total_entries:3,processed:body.page===1?2:1,has_more:body.page===1,next_page:body.page===1?2:null}}, {action:'sync_transactions',start_date:'2026-08-09T00:00:00.000Z',end_date:'2026-09-11T00:00:00.000Z'})
  assert.equal(result.processed,3);assert.equal(calls.length,2)
  assert.equal(calls[0].end_date,calls[1].end_date)
  await assert.rejects(scanLawPayPages(async body=>body.page===1?{ok:true,page:1,has_more:true,next_page:2,processed:1}:{ok:false,error:'provider unavailable'},{}),/provider unavailable/)
  await assert.rejects(scanLawPayPages(async()=>({ok:true,page:1,has_more:true,next_page:1}),{}),/progress/)
})
test('audit distinguishes unmatched consults, unapplied invoice payments, and amount discrepancies', async () => {
  const { auditLawPayRecords } = await load()
  const tx={id:'local',gateway_transaction_id:'gateway',transaction_type:'CHARGE',status:'COMPLETED',amount_cents:101250,reference:'Case | MIO-2026-123456'}
  const invoice={id:'i',invoice_number:'MIO-2026-123456',amount_paid:2562.5,invoice_type:'services'}
  const event={invoice_id:'i',event_type:'lawpay_payment_recorded',provider_event_id:'gateway',amount:1012.5}
  assert.equal(auditLawPayRecords([tx],[invoice],[event]).issues.length,0)
  assert.equal(auditLawPayRecords([tx],[invoice],[]).issues[0].kind,'unapplied')
  assert.equal(auditLawPayRecords([tx],[invoice],[{...event,amount:1000}]).issues[0].kind,'amount_mismatch')
  assert.equal(auditLawPayRecords([{...tx,reference:'Family Law Consult'}],[],[]).unlinked.length,1)
  assert.equal(auditLawPayRecords([{...tx,status:'AUTHORIZED'}],[],[]).issues.length,0)
})
test('baseline reproduction: trust-only accounting omits a posted operating payment marker', () => {
  // Documents the original defect without modifying accounting balances in production.
  const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
  const start=source.indexOf('  function accountingLedgerRows('),end=source.indexOf('\n  function ',start+10)
  const ctx={accountingOutstandingEvents:()=>[],financeNumber:Number,accountingDateTime:String,financeDateOnly:String,activeMioBillingCutoverDate:'2026-08-09',clioHistoricalFinancialArchive:[]}
  vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'\nthis.run=accountingLedgerRows',ctx)
  assert.equal(ctx.run({id:'m'},{currentLedgerRows:[],invoices:[{id:'i',amount_paid:1012.5}],outstanding:0}).length,0)
})

test('gateway page metadata enforces full traversal and rejects silent truncation',async()=>{
 const {pageMetadata}=await import('../supabase/functions/_shared/lawpay-v314.js')
 assert.equal(pageMetadata({results:[1,2],total_entries:3,page:1},1,2).has_more,true)
 assert.equal(pageMetadata({results:[3],total_entries:3,page:2},2,2).has_more,false)
 assert.throws(()=>pageMetadata({results:[],total_entries:5,page:2},2,2),/empty page/)
 assert.throws(()=>pageMetadata({results:[],total_entries:5,page:1},2,2),/wrong page/)
})
test('provider ingestion posts through the atomic RPC before marking an event processed',async()=>{
 const {storeProviderTransaction}=await import('../supabase/functions/_shared/lawpay-v314.js')
 const calls=[]
 const db={from(table){return {select(){return this},eq(){return this},order(){return this},limit(){return Promise.resolve({data:[{id:'r',invoice_number:'MIO-2026-123456',matter_id:'m',created_at:'2026-08-01',account_key:'operating'}]})},maybeSingle(){return Promise.resolve({data:null})},insert(){calls.push('event');return Promise.resolve({data:null})}}},async rpc(name,body){calls.push('atomic');assert.equal(name,'mio_store_lawpay_transaction_v314');assert.equal(body.p_row.amount_cents,101250);assert.equal(body.p_row.account_key,'operating');return {data:{status:'posted'}}}}
 const tx={id:'test-id',amount:101250,status:'COMPLETED',type:'CHARGE',created:'2026-09-09T15:13:36Z',reference:'MIO-2026-123456'}
 await storeProviderTransaction(db,tx,{event:{id:'event',type:'transaction.completed'}})
 assert.deepEqual(calls,['atomic','event'])
 calls.length=0;db.rpc=async()=>({error:{message:'test failure'}})
 await assert.rejects(storeProviderTransaction(db,tx,{event:{id:'event'}}),/test failure/)
 assert.equal(calls.length,0)
})
