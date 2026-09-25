// Real production bundle, synthetic data, no live financial or email calls.
import {chromium} from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {chunkRows} from './cloud-chunk-fixture.js'
const now=new Date().toISOString(),owner='00000000-0000-4000-8000-000000003110',email='synthetic@example.invalid'
const user={id:owner,email,aud:'authenticated',role:'authenticated',email_confirmed_at:now,app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:now}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),exp=Math.floor(Date.now()/1000)+3600
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,email,role:'authenticated',exp,aud:'authenticated'})}.test`,refresh_token:'test-only',expires_at:exp,expires_in:3600,token_type:'bearer',user}
const names=['Alpha','Bravo','Charlie'],matters=names.map((name,i)=>({id:`00000000-0000-4000-8000-00000000400${i+1}`,client_id:'client-'+i,name:name+' Matter',matter_type:'Modification',matter_status:'Active Client',case_status:'Open',is_active:true,created_at:now,clients:{id:'client-'+i,first_name:name,last_name:'Synthetic',email:name.toLowerCase()+'@example.invalid'}}))
const opening=Object.fromEntries(matters.map((m,i)=>[m.id,{snapshot_date:'2026-08-09',matter_trust_funds:[1550,1000,2500][i],outstanding_balance:0,work_in_progress:0,minimum_balance:2000}]))
const invoice=(id,mi,type,total,paid,date,sent='')=>({id,invoice_number:'MIO-2026-'+id.padStart(6,'0'),user_id:owner,matter_id:matters[mi].id,client_id:matters[mi].client_id,client_name:names[mi]+' Synthetic',matter_name:matters[mi].name,invoice_type:type,status:paid===total?'paid':sent?'outstanding':type==='trust_request'?'draft':'outstanding',total,subtotal:total,amount_paid:paid,balance:total-paid,issue_date:date,due_date:date,created_at:date+'T12:00:00Z',updated_at:date+'T12:00:00Z',emailed_at:sent,email_history:[],line_items:[{date,description:'Synthetic work',amount:total}]})
const invoices=[invoice('33',0,'services',2562.5,2562.5,'2026-08-11'),invoice('77',0,'services',225,0,'2026-08-21'),invoice('82',0,'services',375,0,'2026-08-28'),invoice('100',1,'services',100,100,'2026-09-10'),invoice('102',1,'trust_request',3500,0,'2026-09-11'),invoice('103',2,'trust_request',2000,0,'2026-09-11','2026-09-11T13:00:00Z')]
const trust=[{id:'trust-a',matter_id:matters[0].id,invoice_id:'33',direction:'out',amount:1550,date:'2026-08-11',created_at:'2026-08-11T15:00:00Z',memo:'Synthetic trust application'}]
const events=[{id:'event-a',invoice_id:'33',user_id:owner,event_type:'lawpay_payment_recorded',amount:1012.5,provider_event_id:'provider-a',occurred_at:'2026-09-09T15:13:36Z'}]
const transactions=[{id:'tx-a',gateway_transaction_id:'provider-a',occurred_at:'2026-09-09T15:13:36Z',transaction_type:'CHARGE',status:'COMPLETED',account_key:'operating',amount_cents:101250,amount_refunded_cents:0,reference:'MIO-2026-000033',payer_name:'Alpha Synthetic',raw:{mio_matter_id:matters[0].id,mio_invoice_number:'MIO-2026-000033'}},{id:'tx-b',gateway_transaction_id:'provider-b',occurred_at:'2026-09-12T15:13:36Z',transaction_type:'CHARGE',status:'COMPLETED',account_key:'trust',amount_cents:500000,amount_refunded_cents:0,reference:'',payer_name:'Bravo Synthetic',raw:{}},{id:'tx-c',gateway_transaction_id:'provider-c',occurred_at:'2026-09-12T16:13:36Z',transaction_type:'CHARGE',status:'COMPLETED',account_key:'operating',amount_cents:100000,amount_refunded_cents:0,reference:'',payer_name:'Charlie Synthetic',raw:{}},{id:'tx-d',gateway_transaction_id:'provider-d',occurred_at:'2026-09-12T17:13:36Z',transaction_type:'CHARGE',status:'COMPLETED',account_key:'',account_id:'acct-1137',amount_cents:12500,amount_refunded_cents:0,reference:'',payer_name:'Yasmine Said',raw:{mio_account_key_source:'unresolved'}},{id:'tx-e',gateway_transaction_id:'provider-e',occurred_at:'2026-09-12T18:13:36Z',transaction_type:'CHARGE',status:'COMPLETED',account_key:'trust',amount_cents:25000,amount_refunded_cents:0,reference:'',payer_name:'Delta Synthetic',raw:{}}]
const states=new Map(Object.entries({caseMioFinanceOpeningBalances:opening,caseMioTrustTransactions:trust,caseMioInvoices:invoices,caseMioBillingCutoverDate:'2026-08-09',caseMioBulkBillingFilters:{case_status:'all',matter_status:'all',search:''}}).map(([key,v])=>[key,{key,raw_value:typeof v==='string'?v:JSON.stringify(v),json_value:v,updated_at:now}]))
const errors=[],blocked=[],writes=[],checks=[]
const gatewayState={classifications:[],ledger:[],actions:[]}
const root=path.resolve('dist'),server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep)&&p!==root){res.writeHead(403);return res.end()};const f=fs.existsSync(p)&&fs.statSync(p).isFile()?p:path.join(root,'index.html');res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(f))})
await new Promise(r=>server.listen(4175,'127.0.0.1',r))
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1500,height:1100}})
let page=await context.newPage()
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss())
await context.addInitScript(({session})=>{if(location.origin==='http://127.0.0.1:4175')localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session))},{session})
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 if(url.hostname==='127.0.0.1'&&url.port==='4175'){if(url.pathname.startsWith('/api/'))return reply({connected:false,rows:[],data:[]});return route.continue()}
 if(!url.hostname.endsWith('.supabase.co')){blocked.push(req.method()+' '+url.origin+url.pathname);return reply({})}
 if(url.pathname.includes('/auth/v1/'))return reply(url.pathname.endsWith('/user')?user:session)
 const table=url.pathname.split('/').pop(),single=req.headers().accept?.includes('vnd.pgrst.object')
 if(table==='lawpay-gateway'){
  const b=req.postDataJSON();gatewayState.actions.push({action:b.action,id:String(b.classification?.gateway_transaction_id||'')})
  if(b.action==='review')return reply({ok:true,version:323,transactions:[],classifications:gatewayState.classifications,ledger_entries:gatewayState.ledger,accounts:[],mapping_table_available:true,refund_resolutions_available:true,refund_resolutions:[]})
  if(['post','save','match'].includes(b.action)){
   const c=b.classification||{},tx=transactions.find(t=>String(t.gateway_transaction_id)===String(c.gateway_transaction_id))
   assert.ok(tx,'the gateway only records a stored provider transaction')
   const identity=`${String(c.provider_account_id||'')}:${String(c.gateway_transaction_id||'')}`
   if(gatewayState.classifications.some(r=>r.identity===identity&&r.posting_status==='posted'))return reply({ok:false,error:'This transaction is already recorded in Mio, so nothing else will post.'})
   if(b.action==='post'){
    assert.ok(c.amount_cents===undefined||Number(c.amount_cents)===Number(tx.amount_cents),'the caller must never dictate the posted amount')
    if(!c.actual_account_key)return reply({ok:false,error:'The deposit account is not established yet.'})
    const id='c'+(gatewayState.classifications.length+1)
    gatewayState.classifications=[...gatewayState.classifications.filter(r=>r.identity!==identity),{...c,id,identity,amount_cents:tx.amount_cents,posting_status:'posted',posted_at:new Date().toISOString(),created_by:email}]
    const entry={id:'e'+(gatewayState.ledger.length+1),identity,classification_id:id,entry_kind:String(c.actual_account_key).includes('trust')?'trust_entry':'operating_association',direction:c.direction==='out'?'out':'in',account_key:c.actual_account_key,matter_id:c.matter_id||'',amount_cents:tx.amount_cents,currency:tx.currency||'USD',occurred_at:tx.occurred_at,provider_account_id:tx.account_id||''}
    gatewayState.ledger=[...gatewayState.ledger.filter(e=>e.identity!==identity),entry]
    return reply({ok:true,result:{status:'posted',classification_id:id,ledger_entry_id:entry.id}})
   }
   gatewayState.classifications=[...gatewayState.classifications.filter(r=>r.identity!==identity),{...c,id:'c'+(gatewayState.classifications.length+1),identity,amount_cents:tx.amount_cents,posting_status:b.action==='match'?'matched':'saved',matched_entry_id:c.matched_entry_id||''}]
   return reply({ok:true,result:{status:b.action==='match'?'matched':'saved'}})
  }
  assert.equal(b.action,'sync_transactions');checks.push(b);return reply({ok:true,page:b.page,processed:1,total_entries:1,has_more:false,next_page:null,warnings:[]})
 }
 if(table==='lawpay-account-diagnostics')return reply({ok:true,version:323,redacted:true,diagnostics:{transactions_reviewed:0,missing_provider_account_id:0,unmapped_provider_accounts:[]}})
 if(table==='mio_cloud_state_read_chunks_v297')return reply(chunkRows([...states.values()].map(x=>({...x,user_id:owner})),req.postDataJSON()))
 if(table==='mio_cloud_state_write_v277'){const b=req.postDataJSON(),old=states.get(b.p_key);if(!!old!==b.p_expected_exists||old&&old.updated_at!==b.p_expected_at)return reply({code:'PT409',message:'Stale state'},409);const r={key:b.p_key,raw_value:b.p_raw,json_value:null,updated_at:new Date().toISOString()};states.set(b.p_key,r);return reply(r)}
 if(table==='case_mio_user_state'){let rows=[...states.values()];const key=url.searchParams.get('key');if(key?.startsWith('eq.'))rows=rows.filter(r=>r.key===key.slice(3));return reply(single?rows[0]||null:rows)}
 if(table==='team_members'){const m={id:'synthetic-member',email,first_name:'Test',last_name:'Attorney',is_active:true,page_access:[]};return reply(single?m:[m])}
 if(table==='setting_options')return reply(Object.entries({matter_status:['Active Client','Closed'],case_status:['Open','Closed'],matter_type:['Modification','DFPS']}).flatMap(([category,names])=>names.map((name,i)=>({id:category+i,category,name,is_active:true,sort_order:i}))))
 const tables={matters,clients:matters.map(m=>m.clients),mio_invoices:invoices,mio_invoice_events:events,lawpay_transactions:transactions,lawpay_payment_requests:[],mio_billing_entries:[]}
 if(tables[table]){if(req.method()!=='GET'){writes.push({table,method:req.method()});return reply({error:'No financial writes allowed in browser fixture'},403)}let rows=tables[table];for(const [key,filter] of url.searchParams)if(filter.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===filter.slice(3));return reply(single?rows[0]||null:rows)}
 return reply(single?null:[])
})
fs.mkdirSync('finance-test-results',{recursive:true})
try{
 await page.goto('http://127.0.0.1:4175/#billing',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Bulk Billing',exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:'Bulk Billing',exact:true}).click()
 const minimum=page.getByLabel('Minimum trust amount',{exact:true});await minimum.waitFor()
 const billingRows=page.locator('tr').filter({has:page.locator('a')})
 await minimum.fill('1000');await page.waitForTimeout(300)
 assert.ok(!(await billingRows.filter({hasText:'Alpha Synthetic'}).count()),'low trust excluded')
 assert.ok(await page.getByText('Bravo Synthetic',{exact:true}).count(),'boundary retained')
 await minimum.fill('1000.01');await page.waitForTimeout(300);assert.equal(await page.getByText('Bravo Synthetic',{exact:true}).count(),0)
 await minimum.fill('');await page.getByText('Alpha Synthetic',{exact:true}).first().waitFor()
 await page.getByRole('button',{name:'Replenish all selected',exact:true}).click()
 const review=page.getByRole('dialog',{name:'Replenishment Review'});await review.waitFor();await review.getByLabel('Request amount for Alpha Synthetic').waitFor()
 assert.equal(await review.getByRole('button',{name:'Approve & Send',exact:true}).count(),2)
 assert.match(await review.innerText(),/No duplicate will be created or resent/)
 assert.equal(writes.length,0);assert.equal(blocked.length,0)
 await page.screenshot({path:'finance-test-results/replenishment-review.png',fullPage:false})
 await review.getByRole('button',{name:'Close',exact:true}).click()
 await page.getByRole('button',{name:'All invoices',exact:true}).click()
 const ledger=page.locator('section').filter({has:page.getByRole('heading',{name:'All invoices',exact:true})}).first()
 await ledger.getByRole('button',{name:'Paid: oldest first',exact:true}).click()
 const ids=()=>ledger.locator('tbody tr td:nth-child(2)').allTextContents()
 assert.deepEqual((await ids()).map(x=>x.trim()),['MIO-2026-000033','MIO-2026-000100'])
 await ledger.getByRole('button',{name:'Clear filters',exact:true}).click()
 await ledger.getByLabel('Invoice primary sort').selectOption('status');await ledger.getByLabel('Invoice primary order').selectOption('asc');await ledger.getByLabel('Invoice secondary date').selectOption('created');await ledger.getByLabel('Invoice secondary order').selectOption('asc')
 let all=await ids();assert.ok(all.indexOf('MIO-2026-000077')<all.indexOf('MIO-2026-000082'));assert.ok(all.indexOf('MIO-2026-000033')<all.indexOf('MIO-2026-000100'))
 await ledger.getByLabel('Invoice secondary order').selectOption('desc');all=await ids();assert.ok(all.indexOf('MIO-2026-000077')>all.indexOf('MIO-2026-000082'))
 await page.screenshot({path:'finance-test-results/invoice-sorting.png'})
 await ledger.getByRole('button',{name:'Close',exact:true}).click()
  // The reconciliation list now lives on Bulk Billing: the matter dashboard no longer
  // carries any LawPay review or reconciliation UI.
 // The reconciliation list must name the LawPay deposit account each charge was taken
 // into, and say so plainly when Mio could not resolve it instead of guessing. The
 // matter dashboard only sees transactions after this verified full scan.
 const reconciliation=page.locator('details').filter({has:page.locator('summary').filter({hasText:'LawPay reconciliation'})}).first()
 // If this click cannot find the reconciliation list, keep the page's own evidence: the URL, the
 // open tabs and the rendered summaries say which page or state the fixture actually reached.
 try{await reconciliation.locator('summary').click()}catch(probeError){const probe=['url='+page.url(),'pages='+context.pages().map(open=>open.url()).join(' | '),'detailsSummaries='+JSON.stringify(await page.locator('details summary').allTextContents()),'headings='+JSON.stringify(await page.getByRole('heading').allTextContents()),'hasReconciliationText='+String((await page.locator('body').innerText()).includes('LawPay reconciliation')),'body='+(await page.locator('body').innerText()).slice(0,2000)].join('\n');fs.writeFileSync('finance-test-results/nav-probe.txt',probe);throw probeError}
 await reconciliation.getByRole('button',{name:'Check all LawPay payments since Mio opening',exact:true}).click()
 await reconciliation.locator('summary').filter({hasText:'4 unlinked transaction(s)'}).waitFor()
 const reconciliationLine=async text=>{const line=reconciliation.locator('p').filter({hasText:text}).first();await line.waitFor();return await line.innerText()}
 assert.match(await reconciliationLine('Bravo Synthetic'),/5,000.*- Trust - /)
 assert.match(await reconciliationLine('Charlie Synthetic'),/1,000.*- Operating - /)
 assert.match(await reconciliationLine('Yasmine Said'),/125.*- Account not reported - /)
 assert.match(await reconciliationLine('Delta Synthetic'),/250.*- Trust - /)
 await page.screenshot({path:'finance-test-results/lawpay-reconciliation-accounts.png'})
 // Every unlinked charge can now be attributed from this screen, and the picker states the
 // deposit account LawPay recorded instead of guessing one.
 const openPicker=async payer=>{
  const button=reconciliation.getByRole('button',{name:new RegExp(`^Categorize the .*${payer}$`)}).first()
  await button.waitFor();await button.click()
  const editor=reconciliation.locator('div').filter({has:page.getByLabel('Attribution decision')}).last()
  await editor.waitFor();return editor
 }
 const decisions=()=>states.get('caseMioLawPayAttribution')?JSON.parse(states.get('caseMioLawPayAttribution').raw_value):[]
 const trustLedger=()=>JSON.parse(states.get('caseMioTrustTransactions').raw_value)
 const serverEffect=(transactionId)=>gatewayState.ledger.filter(entry=>String(entry.identity).endsWith(':'+String(transactionId)))
 const bravoEditor=await openPicker('Bravo Synthetic')
 assert.match(await bravoEditor.innerText(),/deposit account as Trust/)
 await bravoEditor.getByLabel('Search matters for this payment',{exact:true}).fill('Bravo')
 await bravoEditor.getByLabel('Matter for this payment',{exact:true}).selectOption({label:'Bravo Synthetic - Bravo Matter'})
 await bravoEditor.getByRole('button',{name:'Save attribution',exact:true}).click()
 await reconciliation.getByText(/- Trust - trust deposit - Bravo Matter/).waitFor()
 assert.equal(decisions()[0].decision,'matter');assert.equal(decisions()[0].account,'trust');assert.equal(decisions()[0].entry_kind,'trust_deposit')
 assert.ok(gatewayState.actions.some(entry=>entry.action==='post'),'Bulk Billing must post through the shared classification gateway')
 assert.equal(gatewayState.classifications.filter(record=>String(record.gateway_transaction_id)==='provider-b'&&record.posting_status==='posted').length,1,'exactly one server classification may be posted')
 assert.equal(serverEffect('provider-b').length,1,'exactly one applicable ledger effect may exist')
 assert.equal(Number(serverEffect('provider-b')[0].amount_cents),500000,'the effect must use the stored provider amount')
 assert.equal(serverEffect('provider-b')[0].entry_kind,'trust_entry')
 assert.equal(trustLedger().some(row=>String(row.lawpay_transaction_id)==='provider-b'),false,'the new path must not write a client-side trust row')
 const retryEditor=await openPicker('Bravo Synthetic')
 await retryEditor.getByLabel('Search matters for this payment',{exact:true}).fill('Bravo')
 await retryEditor.getByLabel('Matter for this payment',{exact:true}).selectOption({label:'Bravo Synthetic - Bravo Matter'})
 await retryEditor.getByRole('button',{name:'Save attribution',exact:true}).click()
 await retryEditor.getByRole('alert').waitFor()
 assert.match(await retryEditor.innerText(),/already recorded in Mio/)
 assert.equal(gatewayState.classifications.filter(record=>String(record.gateway_transaction_id)==='provider-b').length,1,'a retry must not add a classification')
 assert.equal(serverEffect('provider-b').length,1,'a retry must not add a ledger effect')
 const charlieEditor=await openPicker('Charlie Synthetic')
 await charlieEditor.getByLabel('Matter for this payment',{exact:true}).selectOption({index:1})
 await charlieEditor.getByRole('button',{name:'Save attribution',exact:true}).click()
 await reconciliation.getByText(/- Operating - operating record - /).waitFor()
 assert.equal(decisions()[0].entry_kind,'operating_association')
 assert.equal(serverEffect('provider-c').length,0,'an operating charge may never move a trust balance')
 assert.equal(trustLedger().some(row=>String(row.lawpay_transaction_id)==='provider-c'),false,'no client-side trust row for an operating charge')
 const deltaEditor=await openPicker('Delta Synthetic')
 await deltaEditor.getByLabel('Attribution decision').selectOption('neither')
 const saveNeither=deltaEditor.getByRole('button',{name:'Save attribution',exact:true})
 assert.equal(await saveNeither.isDisabled(),true,'A neither decision needs a reason first')
 await deltaEditor.getByLabel('Why this payment belongs to neither',{exact:true}).fill('Not a client payment; recorded for the firm operating account.')
 await saveNeither.click()
 await reconciliation.getByText(/decided: neither \(Not a client payment/).waitFor()
 assert.equal(decisions()[0].decision,'neither')
 assert.equal(serverEffect('provider-e').length,0,'A neither decision posts no money')
 assert.equal(trustLedger().some(row=>String(row.lawpay_transaction_id)==='provider-e'),false,'A neither decision writes no client-side trust row')
 const yasmineEditor=await openPicker('Yasmine Said')
 assert.match(await yasmineEditor.innerText(),/nothing will be posted/,'the picker must say plainly that an unresolved deposit account posts nothing')
 await yasmineEditor.getByLabel('Matter for this payment',{exact:true}).selectOption({index:1})
 await yasmineEditor.getByRole('button',{name:'Save attribution',exact:true}).click()
  const savedYasmine=await (async()=>{for(let attempt=0;attempt<40;attempt+=1){const found=gatewayState.classifications.find(record=>String(record.gateway_transaction_id)==='provider-d');if(found)return found;await page.waitForTimeout(150)}return null})()
 assert.ok(savedYasmine,'an unresolved deposit account may be saved for review through the gateway')
 assert.equal(savedYasmine.posting_status,'saved','an unresolved deposit account must never post')
 assert.equal(savedYasmine.account_source,'','nothing may claim a verified provenance for an unresolved account')
 assert.equal(serverEffect('provider-d').length,0,'an unresolved deposit account must produce no ledger effect')
 assert.equal(decisions().some(record=>record.gateway_transaction_id==='provider-d'),false,'an unresolved deposit account is never attributed locally, only recorded for review through the shared workflow')
 await page.screenshot({path:'finance-test-results/lawpay-attribution-picker.png'})
 // Exercise the actual target=_blank matter link rather than dismissing an
 // unrelated unsaved-state beforeunload prompt with a forced reload.
 const opened=context.waitForEvent('page')
 const ledgerPage=page;await page.getByRole('link',{name:'Alpha Synthetic',exact:true}).click()
 page=await opened
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss())
 await page.waitForLoadState('domcontentloaded')
 await page.getByText('Finances settings',{exact:true}).waitFor({timeout:60000}).catch(async()=>{const second=context.waitForEvent('page',{timeout:20000}).catch(()=>null);await ledgerPage.getByRole('link',{name:'Alpha Synthetic',exact:true}).first().click();const openedAgain=await second;if(openedAgain){page=openedAgain;page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForLoadState('domcontentloaded')}await page.getByText('Finances settings',{exact:true}).waitFor({timeout:60000})})
 const settings=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Finances settings'})})
 assert.equal(await settings.getAttribute('open'),null);assert.equal(await settings.getByText('Retainer replenishment target',{exact:true}).isVisible(),false)
 await settings.locator('summary').click();assert.equal(await settings.getByText('Retainer replenishment target',{exact:true}).isVisible(),true)
  // Matter -> Finances must not carry any LawPay review or reconciliation UI: the
  // review queue is centralized on the LawPay page, reached through the consolidated notification.
  const matterBody=await page.locator('body').innerText()
  assert.equal(matterBody.includes('LawPay reconciliation'),false,'Matter -> Finances must not show the LawPay reconciliation list')
  assert.equal(matterBody.includes('Categorize this payment'),false,'Matter -> Finances must not show the legacy attribution picker')
  assert.equal(matterBody.includes('LawPay payment classification'),false,'Matter -> Finances must not show the classification panel')
  assert.equal(await page.locator('details summary').filter({hasText:'LawPay reconciliation'}).count(),0,'no reconciliation details block on Matter -> Finances')
 await page.getByRole('button',{name:'Accounting',exact:true}).last().click()
 await page.getByRole('columnheader',{name:'Operating payment',exact:true}).waitFor()
 const op=page.locator('tr').filter({hasText:'Payment received into Operating; no trust movement'});await op.waitFor();assert.match(await op.innerText(),/1,012/)
 const cells=await op.locator('td').allTextContents();assert.match(cells[8],/\$0/);assert.match(cells[9],/600/)
 await page.screenshot({path:'finance-test-results/operating-ledger.png'})
 // Now that every charge has been decided: one posting, three saved decisions, and the one
 // verified trust deposit is the only thing that ever left Bulk Billing as a post.
 assert.deepEqual([...new Set(gatewayState.actions.filter(entry=>entry.action==='post').map(entry=>entry.id))],['provider-b'],'only the verified trust deposit may ever be posted')
 assert.deepEqual([...new Set(gatewayState.actions.filter(entry=>entry.action==='save').map(entry=>entry.id))].sort(),['provider-c','provider-d','provider-e'],'an operating, unresolved or neither decision is saved, never posted')
 assert.ok(checks.length>0);assert.equal(writes.length,0);assert.deepEqual(errors,[])
 console.log(JSON.stringify({ok:true,checks:checks.length,financialWrites:writes.length,externalCalls:blocked.length,tests:['minimum trust boundary','review opens without send','existing draft reuse','sent-request duplicate prevention','status plus date sorting','paid oldest-first preset','collapsed finance settings','reconciliation shows the deposit account','categorize an unlinked charge as a matter trust deposit through the shared gateway','a retry is refused and adds nothing','an operating charge never moves trust','neither decision posts nothing','an unresolved deposit account is saved for review and never posted','operating ledger no trust movement']},null,2))
}catch(error){await page.screenshot({path:'finance-test-results/failure.png'});fs.writeFileSync('finance-test-results/failure.txt',await page.locator('body').innerText());console.error({errors,writes,blocked});throw error}
finally{await browser.close();await new Promise(r=>server.close(r))}
