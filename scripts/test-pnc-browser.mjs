// Actual production bundle, synthetic accounts, all external requests intercepted.
import {chromium} from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {chunkRows} from '../tests/cloud-chunk-fixture.js'
import {PNC_STATUS,CONSULT_STATUS,CLIENT_STATUS,DEFAULT_INTAKES,readyToClient} from '../src/mioPncModel.js'
import {firmDate} from '../src/mioDailyTrust.js'
const root=path.resolve('dist'),now=new Date().toISOString(),owner='00000000-0000-4000-8000-000000003110',email='synthetic@example.invalid'
const user={id:owner,email,aud:'authenticated',role:'authenticated',email_confirmed_at:now,app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:now}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),exp=Math.floor(Date.now()/1000)+3600
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,email,role:'authenticated',exp,aud:'authenticated'})}.test`,refresh_token:'test-only',expires_at:exp,expires_in:3600,token_type:'bearer',user}
const matters=[{id:'00000000-0000-4000-8000-000000004001',client_id:'client-a',name:'Existing family matter',matter_type:'Divorce',matter_status:CLIENT_STATUS,case_status:'Open',is_active:true,created_at:now,clients:{id:'client-a',first_name:'Existing',last_name:'Client',email:'existing@example.invalid'}},{id:'00000000-0000-4000-8000-000000004002',client_id:'client-b',name:'DFPS matter',matter_type:'DFPS',matter_status:CLIENT_STATUS,case_status:'Open',is_active:true,created_at:now,clients:{id:'client-b',first_name:'DFPS',last_name:'Client',email:'dfps@example.invalid'}}]
const billing=matters.map((m,i)=>({id:'entry-'+i,matter_id:m.id,date:firmDate(),amount:i?100:200,billing_time:i?1:2,rate:100,entry_type:'time',description:'Synthetic work',created_at:now}))
const states=new Map(Object.entries({caseMioBillingEntries:billing}).map(([key,v])=>[key,{key,raw_value:JSON.stringify(v),json_value:v,updated_at:now}]))
const workflows=new Map(),actions=[],errors=[],alerts=[],blocked=[],calendar=[];let settled=false
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep)&&p!==root){res.writeHead(403);return res.end()};const f=fs.existsSync(p)&&fs.statSync(p).isFile()?p:path.join(root,'index.html');res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(f))})
await new Promise(r=>server.listen(4173,'127.0.0.1',r))
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1500,height:1050}}),page=await context.newPage()
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{if(d.type()==='alert')alerts.push(d.message());if(d.type()==='confirm')await d.accept();else await d.dismiss()})
await context.addInitScript(({session})=>localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session)),{session})
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 if(url.hostname==='127.0.0.1'&&url.port==='4173'){
  if(url.pathname==='/api/pnc'){
   const b=req.postDataJSON();actions.push(b);if(b.action==='list')return reply({rows:[...workflows.values()]})
   if(b.action==='create'){
    let w=[...workflows.values()].find(x=>x.creation_key===b.key)
    if(!w){const id='00000000-0000-4000-8000-000000004003',client={id:'new-client',first_name:b.first_name,last_name:b.last_name,email:b.email,phone:b.phone},m={id,client_id:client.id,name:b.first_name+' '+b.last_name+' - '+b.case_type,matter_type:b.case_type,matter_status:PNC_STATUS,case_status:'Open',is_active:true,created_at:now,clients:client};matters.push(m);w={matter_id:id,client_id:client.id,user_id:owner,creation_key:b.key,config:{},state:{},revision:0,created_at:now};workflows.set(id,w)}return reply({workflow:w})
   }
   if(b.action==='templates')return reply({templates:[{id:'template-test',title:'Synthetic agreement',signer_roles:[{name:'Client'}]}]})
   let w=workflows.get(b.matter_id);if(!w)return reply({error:'Unknown fixture matter'},404)
   if(b.action==='save'){if(b.revision!==w.revision)return reply({error:'Stale revision'},409);w.config=b.config}
   if(b.action==='prepare_consult'){w.state.consult_request={id:'consult-request',url:'https://secure.lawpay.com/test?amount=125.00',amount_cents:12500,account_key:'operating'};if(w.config.include_intake)w.state.intake={id:'intake-test',status:'pending',url:'https://example.invalid/#client-intake/test'}}
   if(b.action==='prepare_engagement')w.state.retainer_request={id:'retainer-request',url:'https://secure.lawpay.com/test-trust?amount=5000.00',amount_cents:500000,account_key:'trust'}
   if(b.action==='refresh'){w.state.signature={id:'signature-test',status:settled?'signed':'awaiting_signature'};w.state.retainer={status:settled?'processing':'partial',paid_cents:0,processing_cents:settled?500000:10000,required_cents:500000};w.state.intake={...w.state.intake,status:'submitted'};w.state.checked_at=now}
   let changed
   if(b.action==='advance'){const m=matters.find(x=>x.id===b.matter_id);if(m.matter_status===CONSULT_STATUS&&!readyToClient(w.state))return reply({error:'Both are required'},409);m.matter_status=m.matter_status===PNC_STATUS?CONSULT_STATUS:CLIENT_STATUS;changed={id:m.id,matter_status:m.matter_status}}
   w={...w,config:{...w.config},state:{...w.state},revision:w.revision+1};workflows.set(w.matter_id,w);return reply({workflow:w,...(changed?{matter:changed}:{})})
  }
  if(url.pathname==='/api/client-intake'){const b=req.postDataJSON();return reply({request:{id:'public-fixture',title:'SAPCR / Modification',template_snapshot:DEFAULT_INTAKES[1],status:b.action==='submit'?'submitted':'pending'}})}
  if(url.pathname.startsWith('/api/'))return reply({connected:false,data:[]});return route.continue()
 }
 if(!url.hostname.endsWith('.supabase.co')){if(req.method()!=='GET')blocked.push(url.origin+url.pathname);return reply({})}
 if(url.pathname.includes('/auth/v1/'))return reply(url.pathname.endsWith('/user')?user:session)
 const table=url.pathname.split('/').pop(),single=req.headers().accept?.includes('vnd.pgrst.object')
 if(table==='mio_cloud_state_read_chunks_v297')return reply(chunkRows([...states.values()].map(x=>({...x,user_id:owner})),req.postDataJSON()))
 if(table==='mio_cloud_state_write_v277'){const b=req.postDataJSON(),old=states.get(b.p_key);if(!!old!==b.p_expected_exists||old&&old.updated_at!==b.p_expected_at)return reply({code:'PT409',message:'Stale state'},409);const r={key:b.p_key,raw_value:b.p_raw,json_value:null,updated_at:new Date().toISOString()};states.set(b.p_key,r);return reply(r)}
 if(table==='case_mio_user_state'){let rows=[...states.values()];const key=url.searchParams.get('key');if(key?.startsWith('eq.'))rows=rows.filter(r=>r.key===key.slice(3));return reply(single?rows[0]||null:rows)}
 if(table==='setting_options')return reply(Object.entries({matter_status:[PNC_STATUS,CONSULT_STATUS,CLIENT_STATUS,'Served- Need to Finalize','Closed'],case_status:['Open','Closed'],matter_type:['Divorce','SAPCR/Modification','DFPS','Other']}).flatMap(([category,names])=>names.map((name,i)=>({id:category+i,category,name,is_active:true,sort_order:i}))))
 if(table==='clients')return reply(matters.map(m=>m.clients));if(table==='matters')return reply(single?matters.find(m=>m.id===url.searchParams.get('id')?.slice(3)):matters)
 if(table==='mio_billing_entries')return reply(billing)
 if(table==='calendar_events'){if(req.method()==='POST')calendar.push(req.postDataJSON());return reply(calendar)}
 if(table==='team_members'){const m={id:'synthetic-member',email,first_name:'Test',last_name:'Attorney',is_active:true,page_access:[]};return reply(single?m:[m])}
 return reply(single?null:[])
})
const settle=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await page.waitForTimeout(100)}assert.ok(await fn(),'Fixture did not settle')}
fs.mkdirSync('pnc-test-results',{recursive:true})
try{
 await page.goto('http://127.0.0.1:4173/#matters',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Add PNC',exact:true}).waitFor({timeout:60000})
 await page.getByRole('button',{name:'Add PNC',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Add potential new client'})
 await dialog.getByLabel('First name',{exact:true}).fill('Sample');await dialog.getByLabel('Last name',{exact:true}).fill('Prospect');await dialog.getByLabel('Email address',{exact:true}).fill('sample@example.invalid');await dialog.getByLabel('Phone number',{exact:true}).fill('555-0100');await dialog.getByLabel('Case type',{exact:true}).selectOption('SAPCR/Modification');await dialog.getByRole('button',{name:'Create PNC',exact:true}).click()
 dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:/^Consultation - Sample/})});await dialog.waitFor();assert.equal(matters.length,3);assert.equal(workflows.size,1)
 await dialog.getByLabel('Consultation fee (operating account)',{exact:true}).fill('125');await dialog.getByLabel('Include intake form',{exact:true}).check();await dialog.getByLabel('Intake form',{exact:true}).selectOption('pnc-sapcr')
 await dialog.getByLabel('Add consultation to calendar and invite client',{exact:true}).check();await dialog.getByLabel('Consultation date and time',{exact:true}).fill('2026-09-15T09:30')
 await dialog.getByRole('button',{name:'Prepare links and preview',exact:true}).click();await settle(()=>[...workflows.values()][0]?.state.consult_request);await settle(async()=>!(await dialog.getByRole('button',{name:'Close',exact:true}).isDisabled()))
 assert.match(await dialog.locator('pre').innerText(),/125\.00/);assert.match(await dialog.locator('pre').innerText(),/2026-09-15 09:30/);assert.equal(actions.filter(x=>x.action==='send_signature').length,0);assert.equal(calendar.length,0)
 await page.screenshot({path:'pnc-test-results/consultation-preview.png',fullPage:true});await dialog.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.locator('.mio-pnc-row').count(),1)
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('.mio-pnc-row').waitFor({timeout:60000});await page.getByRole('button',{name:'Send consult fee / intake',exact:true}).click();dialog=page.getByRole('dialog');assert.equal(await dialog.getByLabel('Consultation fee (operating account)',{exact:true}).inputValue(),'125')
 await dialog.getByRole('button',{name:'Client wants to move forward',exact:true}).click();await dialog.getByRole('button',{name:'Move to Client-Need to Draft',exact:true}).waitFor();assert.equal(matters[2].matter_status,CONSULT_STATUS);assert.equal(await dialog.getByLabel('Retainer amount (trust account)',{exact:true}).inputValue(),'5000')
 await dialog.getByRole('button',{name:'Refresh status',exact:true}).click();await settle(()=>[...workflows.values()][0].state.retainer?.status==='partial');assert.equal(await dialog.getByRole('button',{name:'Move to Client-Need to Draft',exact:true}).isDisabled(),true)
 settled=true;await settle(async()=>!(await dialog.getByRole('button',{name:'Refresh status',exact:true}).isDisabled()));await dialog.getByRole('button',{name:'Refresh status',exact:true}).click();await settle(async()=>!(await dialog.getByRole('button',{name:'Move to Client-Need to Draft',exact:true}).isDisabled()));await page.screenshot({path:'pnc-test-results/ready-to-client.png',fullPage:true})
 await dialog.getByRole('button',{name:'Move to Client-Need to Draft',exact:true}).click();await page.getByRole('dialog',{name:'Client ready to draft'}).waitFor();assert.equal(matters[2].matter_status,CLIENT_STATUS);await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.locator('.mio-pnc-row').count(),0)
 await page.getByTitle("Add time or an expense and review today's billing entries",{exact:true}).click();await page.getByRole('region',{name:'Daily billing breakdown'}).waitFor();assert.match(await page.locator('.pnc-metrics').innerText(),/Total billed[\s\S]*\$300\.00/);assert.match(await page.locator('.pnc-metrics').innerText(),/DFPS - monthly billing[\s\S]*\$100\.00/);await page.screenshot({path:'pnc-test-results/daily-billing.png',fullPage:true})
 await page.getByRole('heading',{name:/^Daily Billing -/}).locator('..').getByRole('button',{name:'Close',exact:true}).click()
 await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'PNC workflow',exact:true}).click();const settings=page.locator('.mio-pnc-settings');await settings.waitFor();assert.equal(await settings.getByLabel('Intake template to edit').locator('option').count(),4)
 await settings.getByLabel('Default retainer (trust)',{exact:true}).fill('5500');await settings.getByRole('button',{name:'Save PNC settings',exact:true}).click();await settle(()=>JSON.parse(states.get('caseMioPncSettingsV313')?.raw_value||'{}').retainer==='5500');await page.screenshot({path:'pnc-test-results/settings.png',fullPage:true})
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.equal(actions.filter(x=>x.action==='create').length,1)
 console.log('PASS production UI: Add PNC, client+matter, initial case type, consult preview/date/intake, persistent special row, manual advance, retainer default, partial gate, signed+processing gate, normal row, daily DFPS breakdown, editable cloud settings. No live provider sends.')
}catch(e){await page.screenshot({path:'pnc-test-results/failure.png',fullPage:true}).catch(()=>{});fs.writeFileSync('pnc-test-results/failure.txt',JSON.stringify({error:e.stack,errors,alerts,actions,body:await page.locator('body').innerText().catch(()=>''),blocked},null,2));throw e}finally{await browser.close();await new Promise(r=>server.close(r))}
