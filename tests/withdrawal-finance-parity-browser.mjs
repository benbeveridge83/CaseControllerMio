// Real production bundle, synthetic data, no live financial or email calls.
// Two guarantees are checked here against the same loaded records:
//   1. The withdrawal page graphs every matter on its list, not the first twelve.
//   2. The trust amount on the withdrawal row is the same trust balance Bulk billing shows.
import {chromium} from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {chunkRows} from './cloud-chunk-fixture.js'
const now=new Date().toISOString(),owner='00000000-0000-4000-8000-000000003120',email='withdrawal-parity@example.invalid'
const user={id:owner,email,aud:'authenticated',role:'authenticated',email_confirmed_at:now,app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:now}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),exp=Math.floor(Date.now()/1000)+3600
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,email,role:'authenticated',exp,aud:'authenticated'})}.test`,refresh_token:'test-only',expires_at:exp,expires_in:3600,token_type:'bearer',user}
const names=['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet','Kilo','Lima','Mike','November']
const trusts=[1550.55,1000,2500,0,4321.99,75.25,0,3000,125.5,0,1800,640,0,9999.99]
const matters=names.map((name,i)=>({id:`00000000-0000-4000-8000-0000000051${String(i+10)}`,client_id:'client-'+i,name:name+' Matter',matter_type:'Modification',matter_status:'Active Client',case_status:'Open',is_active:true,created_at:now,clients:{id:'client-'+i,first_name:name,last_name:'Client',email:name.toLowerCase()+'@example.invalid'}}))
const opening=Object.fromEntries(matters.map((m,i)=>[m.id,{snapshot_date:'2026-08-09',matter_trust_funds:trusts[i],outstanding_balance:0,work_in_progress:0,minimum_balance:2000}]))
// Bravo: a recorded trust disbursement after the opening record. Alpha: a completed LawPay
// trust charge already linked to the matter. Both must appear in the withdrawal trust amount.
const trust=[{id:'trust-bravo',matter_id:matters[1].id,direction:'out',transaction_type:'other_disbursement',amount:100,date:'2026-08-12',created_at:'2026-08-12T15:00:00Z',memo:'Synthetic trust disbursement'}]
const transactions=[{id:'tx-alpha',gateway_transaction_id:'provider-alpha',occurred_at:'2026-08-14T15:13:36Z',transaction_type:'CHARGE',status:'COMPLETED',account_key:'trust',amount_cents:101250,amount_refunded_cents:0,reference:'',payer_name:'Alpha Client',raw:{mio_matter_id:matters[0].id}},{id:'tx-open',gateway_transaction_id:'provider-open',occurred_at:'2026-08-15T15:13:36Z',transaction_type:'CHARGE',status:'COMPLETED',account_key:'operating',amount_cents:100000,amount_refunded_cents:0,reference:'',payer_name:'Unlinked Client',raw:{}}]
const states=new Map(Object.entries({caseMioFinanceOpeningBalances:opening,caseMioTrustTransactions:trust,caseMioBillingCutoverDate:'2026-08-09',caseMioBulkBillingFilters:{case_status:'all',matter_status:'all',search:''}}).map(([key,v])=>[key,{key,raw_value:typeof v==='string'?v:JSON.stringify(v),json_value:v,updated_at:now}]))
const errors=[],writes=[],blocked=[]
const root=path.resolve('dist'),server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep)&&p!==root){res.writeHead(403);return res.end()};const f=fs.existsSync(p)&&fs.statSync(p).isFile()?p:path.join(root,'index.html');res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(f))})

await new Promise(r=>server.listen(0,'127.0.0.1',r))
const port=server.address().port,origin=`http://127.0.0.1:${port}`
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1500,height:1100}})
const page=await context.newPage()
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss())
await context.addInitScript(({session,origin})=>{if(location.origin===origin)localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session))},{session,origin})
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 if(url.port===String(port)){if(url.pathname.startsWith('/api/'))return reply({connected:false,rows:[],data:[]});return route.continue()}
 if(!url.hostname.endsWith('.supabase.co')){blocked.push(req.method()+' '+url.origin+url.pathname);return reply({})}
 if(url.pathname.includes('/auth/v1/'))return reply(url.pathname.endsWith('/user')?user:session)
 if(url.pathname.endsWith('/lawpay-gateway'))return reply({ok:true,page:1,processed:2,total_entries:2,has_more:false,next_page:null,warnings:[]})
 const table=url.pathname.split('/').pop(),single=req.headers().accept?.includes('vnd.pgrst.object')
 if(table==='mio_cloud_state_read_chunks_v297')return reply(chunkRows([...states.values()].map(x=>({...x,user_id:owner})),req.postDataJSON()))
 if(table==='mio_cloud_state_write_v277'){const b=req.postDataJSON(),old=states.get(b.p_key);if(!!old!==b.p_expected_exists||old&&old.updated_at!==b.p_expected_at)return reply({code:'PT409',message:'Stale state'},409);const r={key:b.p_key,raw_value:b.p_raw,json_value:null,updated_at:new Date().toISOString()};states.set(b.p_key,r);return reply(r)}
 if(table==='case_mio_user_state'){let rows=[...states.values()];const key=url.searchParams.get('key');if(key?.startsWith('eq.'))rows=rows.filter(r=>r.key===key.slice(3));return reply(single?rows[0]||null:rows)}
 if(table==='team_members'){const m={id:'synthetic-member',email,first_name:'Test',last_name:'Attorney',is_active:true,page_access:[]};return reply(single?m:[m])}
 if(table==='setting_options')return reply(Object.entries({matter_status:['Active Client','Closed'],case_status:['Open','Closed'],matter_type:['Modification','DFPS']}).flatMap(([category,list])=>list.map((name,i)=>({id:category+i,category,name,is_active:true,sort_order:i}))))
 const tables={matters,clients:matters.map(m=>m.clients),mio_invoices:[],mio_invoice_events:[],lawpay_transactions:transactions,lawpay_payment_requests:[],mio_billing_entries:[]}
 if(tables[table]){if(req.method()!=='GET'){writes.push({table,method:req.method()});return reply({error:'No financial writes allowed in browser fixture'},403)}let rows=tables[table];for(const [key,filter] of url.searchParams)if(filter.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===filter.slice(3));return reply(single?rows[0]||null:rows)}
 return reply(single?null:[])
})
const moneyNumber=value=>Number(String(value??'').replace(/[^0-9.-]/g,''))
const flatten=value=>String(value||'').replace(/\s+/g,' ').trim()

const columnIndex=async(table,header)=>{const heads=await table.locator('thead th').allInnerTexts();const index=heads.findIndex(text=>flatten(text).startsWith(header));assert.ok(index>=0,`Column "${header}" not found in ${JSON.stringify(heads.map(flatten))}`);return index}
const rowsByMatter=async(table,column)=>{const index=await columnIndex(table,column),result=new Map(),rows=table.locator('tbody tr');for(let i=0;i<await rows.count();i+=1){const row=rows.nth(i),cells=await row.locator('td').allInnerTexts();if(cells.length<=index)continue;const matter=names.map(name=>name+' Matter').find(name=>cells.some(cell=>flatten(cell).includes(name)));if(!matter)continue;result.set(matter,moneyNumber(cells[index]))}return result}
const closeTo=(actual,expected,message,tolerance=1.01)=>assert.ok(Math.abs(Number(actual)-Number(expected))<=tolerance,`${message}: received ${actual}, expected ${expected}`)
fs.mkdirSync('finance-test-results',{recursive:true})
try{
 await page.goto(`${origin}/#billing`,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Bulk Billing',exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:'Bulk Billing',exact:true}).click()
 const billingTable=page.locator('table').filter({has:page.locator('thead th',{hasText:/^Trust/})}).first()
 await billingTable.waitFor()
 const billingTrust=await rowsByMatter(billingTable,'Trust')
 assert.equal(billingTrust.size,names.length,`Bulk billing should list every synthetic matter: ${JSON.stringify([...billingTrust])}`)
 closeTo(billingTrust.get('Alpha Matter'),2563.05,'Bulk billing trust must include the recorded LawPay trust charge')
 closeTo(billingTrust.get('Bravo Matter'),900,'Bulk billing trust must include the recorded trust disbursement')
 await page.screenshot({path:'finance-test-results/parity-bulk-billing.png',fullPage:true})
 await page.goto(`${origin}/?parity=1#withdrawals`,{waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Withdrawal dashboard',exact:true}).waitFor({timeout:60000})
 const review=page.locator('details').filter({hasText:'matching matters'}).first()
 await review.locator('summary').click()
 const withdrawalTrust=await (async()=>{let map=new Map();for(let i=0;i<75;i+=1){map=await rowsByMatter(review.locator('table'),'Trust amount');if(Math.abs(Number(map.get('Alpha Matter'))-2563.05)<=1)return map;await page.waitForTimeout(200)}assert.fail(`The withdrawal page never showed the recorded LawPay trust charge: ${JSON.stringify([...map])}`)})()
 for(const matter of names.map(name=>name+' Matter'))closeTo(withdrawalTrust.get(matter),billingTrust.get(matter),`Withdrawal trust for ${matter} must equal the Bulk billing trust amount`)
 const legend=page.locator('svg[aria-label="Mio financial graph"]').locator('xpath=../following-sibling::div[1]').locator('label')
 const plotted=await legend.count()
 assert.equal(plotted,names.length,`The graph must plot every matching matter, not a fixed subset (plotted ${plotted} of ${names.length})`)
 assert.doesNotMatch(await page.locator('.mio-block-graph-note').innerText(),/First 12/,'The graph note must not claim only twelve lines are drawn')
 // A tab opened before a payment arrived must converge on the same balance Bulk billing
 // calculates instead of keeping its older number forever.
 transactions.push({id:'tx-bravo',gateway_transaction_id:'provider-bravo',occurred_at:'2026-08-16T15:13:36Z',transaction_type:'CHARGE',status:'COMPLETED',account_key:'trust',amount_cents:25000,amount_refunded_cents:0,reference:'',payer_name:'Bravo Client',raw:{mio_matter_id:matters[1].id}})
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 const converged=await (async()=>{let map=new Map();for(let i=0;i<75;i+=1){map=await rowsByMatter(review.locator('table'),'Trust amount');if(Math.abs(Number(map.get('Bravo Matter'))-1150)<=1)return map;await page.waitForTimeout(200)}assert.fail(`The open withdrawal tab never picked up the new trust charge: ${JSON.stringify([...map])}`)})()
 const secondTab=await context.newPage();secondTab.setDefaultTimeout(15000);secondTab.on('pageerror',e=>errors.push(e.message));secondTab.on('dialog',d=>d.dismiss())
 await secondTab.goto(`${origin}/?parity=2#billing`,{waitUntil:'domcontentloaded'})
 await secondTab.getByRole('button',{name:'Bulk Billing',exact:true}).waitFor({timeout:60000});await secondTab.getByRole('button',{name:'Bulk Billing',exact:true}).click()
 const secondTable=secondTab.locator('table').filter({has:secondTab.locator('thead th',{hasText:/^Trust/})}).first()
 await secondTable.waitFor();await secondTab.waitForTimeout(1500)
 const secondTrust=await rowsByMatter(secondTable,'Trust')
 closeTo(converged.get('Bravo Matter'),secondTrust.get('Bravo Matter'),'A withdrawal tab must converge on the Bulk billing trust amount after a new payment')
 await secondTab.close()
 await page.screenshot({path:'finance-test-results/withdrawal-finance-parity.png',fullPage:true})
 assert.equal(writes.length,0);assert.deepEqual(errors,[])
 console.log(JSON.stringify({ok:true,matters:names.length,plotted,tests:['withdrawal graph plots every matching matter','withdrawal trust equals the Bulk billing trust amount','an open withdrawal tab converges after a new payment (matches a second Bulk billing tab)'],note:'Bulk billing rounds its trust column to whole dollars, so page-to-page parity is compared within one dollar.'},null,2))
}catch(error){await page.screenshot({path:'finance-test-results/parity-failure.png',fullPage:true});fs.writeFileSync('finance-test-results/parity-failure.txt',await page.locator('body').innerText());console.error({errors,writes,blocked});throw error}
finally{await browser.close();await new Promise(r=>server.close(r))}


