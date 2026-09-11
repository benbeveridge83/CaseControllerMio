import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import config from '../vite.config.js'
import * as model from '../src/mioFinanceReview.js'
let source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
for(const plugin of config.plugins.flat(Infinity)){
 if(plugin.name==='vite:react-babel'||plugin.name==='vite:react-oxc')break
 const handler=typeof plugin.transform==='function'?plugin.transform:plugin.transform?.handler
 if(handler){const result=await handler.call({},source,'/repo/src/App.jsx');source=typeof result==='string'?result:result?.code||source}
 if(plugin.name==='mio-v314-finance-review')break
}
function fn(name){const match=new RegExp('  (?:async )?function '+name+'\\(').exec(source);assert.ok(match,`missing ${name}`);const start=match.index,next=/\n  (?:async )?function /.exec(source.slice(start+match[0].length));return source.slice(start,next?start+match[0].length+next.index:undefined)}
const reviewFns=['updateReplenishmentRow','replenishSelectedMatters','sendReplenishmentReview']
function reviewContext(){
 const db=[],sent=[],records=[];let number=100
 const ctx={...model,Date,crypto,console,replenishmentSendingRef:{current:false},replenishmentReview:{rows:[]},bulkBusy:false,
 matters:[{id:'a',client_id:'ca',name:'A',email:'a@example.invalid'},{id:'b',client_id:'cb',name:'B',email:'b@example.invalid'}],
 setReplenishmentReview(value){ctx.replenishmentReview=typeof value==='function'?value(ctx.replenishmentReview):value},setBulkBillingBusy(v){ctx.bulkBusy=v},
 setBulkBillingResult(){},readFinanceInvoicesForReview:async()=>db.map(x=>({...x})),matterClientName:m=>m.name,matterClientEmail:m=>m.email,clientEmailForMatter:()=>'',billingMatterNumber:()=>'',matterReplenishmentAmount:()=>500,matterRetainerTarget:()=>500,clientFinanceNumbers:()=>({trust:0,minimumBalance:100}),
 renderBillingTemplate:()=>({subject:'Invoice [invoice number]',body:'Please pay [amount]'}),DEFAULT_BILLING_SENDER_EMAIL:'billing@example.invalid',money:n=>'$'+Number(n).toFixed(2),firmDate:()=>'2026-09-11',
 reserveMioInvoiceNumber:async()=>`MIO-2026-${++number}`,persistMioInvoiceRecord:async(row,event)=>{records.push(event);const i=db.findIndex(x=>x.id===row.id);if(i<0)db.push({...row});else db[i]={...row};return {...row}},
 sendInvoiceDocumentEmail:async(m,row,options)=>{sent.push({row,options});return {...row,emailed_at:'2026-09-11T20:00:00Z'}},loadMioInvoicesFromDatabase:async()=>db,loadMioInvoiceEventsFromDatabase:async()=>[],alert:m=>{throw new Error(m)}}
 vm.createContext(ctx);for(const name of reviewFns)vm.runInContext(fn(name),ctx)
 return {ctx,db,sent,records}
}
test('real replenishment callbacks open review without creating or sending; individual then all sends exactly once',async()=>{
 const {ctx,sent,records}=reviewContext()
 await ctx.replenishSelectedMatters(['a','b','a'])
 assert.equal(ctx.replenishmentReview.open,true);assert.equal(ctx.replenishmentReview.rows.length,2);assert.equal(sent.length,0);assert.equal(records.length,0)
 await ctx.sendReplenishmentReview('a');assert.equal(sent.length,1);assert.match(sent[0].options.subject,/MIO-2026-/);assert.match(sent[0].options.message,/\$500\.00/)
 await ctx.sendReplenishmentReview();assert.equal(sent.length,2)
 await ctx.sendReplenishmentReview();assert.equal(sent.length,2)
 assert.equal(ctx.bulkBusy,false)
})
test('saved unsent drafts are reused and previously sent trust requests are blocked',async()=>{
 const {ctx,db,sent}=reviewContext()
 db.push({id:'saved-a',matter_id:'a',invoice_number:'MIO-2026-001001',invoice_type:'trust_request',status:'draft',total:400,balance:400,amount_paid:0,updated_at:'2026-09-10'})
 db.push({id:'saved-b',matter_id:'b',invoice_number:'MIO-2026-001002',invoice_type:'trust_request',status:'outstanding',total:500,balance:500,amount_paid:0,emailed_at:'2026-09-10'})
 await ctx.replenishSelectedMatters(['a','b']);assert.equal(ctx.replenishmentReview.rows[1].send_status,'blocked')
 await ctx.sendReplenishmentReview();assert.equal(sent.length,1);assert.equal(sent[0].row.id,'saved-a');assert.equal(db.length,2)
})
test('send failures are visible, ambiguous delivery is blocked from automatic retry',async()=>{
 const {ctx,sent}=reviewContext();await ctx.replenishSelectedMatters(['a'])
 ctx.sendInvoiceDocumentEmail=async()=>{sent.push('attempt');throw new Error('Network interrupted after submission')}
 await ctx.sendReplenishmentReview();assert.equal(sent.length,1);assert.equal(ctx.replenishmentReview.rows[0].send_status,'uncertain');assert.match(ctx.replenishmentReview.rows[0].send_error,/Check Sent Items/)
 await ctx.sendReplenishmentReview('a');assert.equal(sent.length,1)
})
test('real accounting ledger adds operating row with correct balances; trust input ledger is unchanged',()=>{
 const invoice={id:'inv',matter_id:'m',invoice_type:'services',invoice_number:'MIO-2026-123456',client_name:'Synthetic'}
 const event={id:'event',invoice_id:'inv',event_type:'lawpay_payment_recorded',amount:1012.5,provider_event_id:'provider',occurred_at:'2026-09-09T15:13:36Z'}
 const ctx={...model,financeNumber:Number,accountingDateTime:(v)=>String(v),financeDateOnly:(v)=>String(v).slice(0,10),activeMioBillingCutoverDate:'2026-08-09',clioHistoricalFinancialArchive:[],mioInvoiceEvents:[event],accountingOutstandingEvents:()=>[]}
 vm.createContext(ctx);vm.runInContext(fn('accountingLedgerRows'),ctx)
 const finance={snapshot:{snapshot_date:'2026-08-09'},snapshotTrust:1550,snapshotOutstanding:0,outstanding:600,invoices:[invoice],currentLedgerRows:[{id:'trust',direction:'out',amount:1550,created_at:'2026-08-11T15:00:00Z'}]}
 const rows=ctx.accountingLedgerRows({id:'m'},finance)
 assert.equal(rows.length,3);assert.equal(rows[2].operating_payment,1012.5);assert.equal(rows[2].running_balance,0);assert.equal(rows[2].ob_balance,600);assert.equal(finance.currentLedgerRows.length,1)
 assert.doesNotMatch(fn('clientFinanceLedgerRows'),/operatingPaymentMarkers/)
})
test('composed app preserves all new controls and read-only browser finance loading',()=>{
 assert.match(source,/Finances settings/);assert.match(source,/Invoice secondary date/);assert.match(source,/Minimum trust amount/)
 assert.match(fn('renderBulkBillingPanel'),/passesTrustMinimum\(row.trust,bulkBillingFilters.min_trust\)/)
 assert.doesNotMatch(fn('loadLawPayWorkspace'),/reconcileLawPayInvoicePayments\(/)
 assert.doesNotMatch(fn('loadLawPayWorkspace'),/\.limit\((100|200)\)/)
 assert.match(fn('refreshLawPayFinancialData'),/action:'sync_transactions'/)
})
