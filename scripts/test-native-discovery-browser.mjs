// Synthetic records only. Every external request is intercepted; no live account writes.
import {chromium} from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {newWithdrawal} from '../src/mioWithdrawalWorkflow.js'
import {configureWorkflow,defaultWithdrawalDefinition} from '../src/mioWorkflowBlocks.js'
import {chunkRows} from '../tests/cloud-chunk-fixture.js'
const root=path.resolve('dist'),now=new Date().toISOString(),owner='00000000-0000-4000-8000-000000003110',email='synthetic@example.invalid'
const user={id:owner,email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:now}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),exp=Math.floor(Date.now()/1000)+3600
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,email,role:'authenticated',exp,aud:'authenticated'})}.test`,refresh_token:'test-only',expires_at:exp,expires_in:3600,token_type:'bearer',user}
const matters=Array.from({length:73},(_,i)=>({id:'00000000-0000-4000-8000-'+String(4000+i).padStart(12,'0'),name:'Matter '+(i+1),matter_type:'Divorce',case_type:'Divorce',matter_status:'Served- Need to Finalize',case_status:'Open',is_active:true,cause_number:'SYNTHETIC-'+(i+1),created_at:now,clients:{first_name:'Client',last_name:String(i+1),email:'client'+i+'@example.invalid'},courts:{court_name:'Synthetic court',county:'Synthetic'}}))
const workflows=new Map(matters.slice(0,3).map(m=>{const state=configureWorkflow(newWithdrawal(m.id,now,now),defaultWithdrawalDefinition(),now);return[m.id,{owner_id:owner,matter_id:m.id,revision:1,state}]}))
matters[1].case_status='Closed'
matters.forEach((m,i)=>{m.client_id='test-client-'+i;m.clients.id=m.client_id})
const docs=['New','Old','Undated','Closed'].map((label,i)=>({id:'test-doc-'+i,matter_id:i===3?matters[1].id:matters[0].id,name:'RFP to us '+label+' '+'long document name '.repeat(12),file_name:'Request '+label+'.pdf',tag_ids:[],document_field_values:{},status:'Theirs',is_active:true}))
const requests=docs.map((doc,i)=>({id:'test-request-'+i,document_id:doc.id,matter_id:doc.matter_id,side:'their',response_due:['2026-09-30','2026-08-01','','2026-10-31'][i],responses:[]}))
const legacy={[matters[0].id]:{clio_matter_id:'999',clio_display_number:''}}
const alerts=[],writes=[]
const extras=Object.fromEntries(matters.slice(0,3).map(m=>[m.id,{withdrawal_status:'withdrawing'}]))
const states=new Map(Object.entries({caseControllerDocuments:docs,caseControllerDiscoveryRequests:requests,caseMioClioMioRosetta:legacy,caseControllerMatterExtraInfo:extras,caseMioWithdrawalViewV305:{open:false,show:'active'}}).map(([key,v])=>[key,{key,raw_value:JSON.stringify(v),json_value:v,updated_at:now}]))
const events=[],errors=[],blocked=[],server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep)&&p!==root){res.writeHead(403);return res.end()};const file=fs.existsSync(p)&&fs.statSync(p).isFile()?p:path.join(root,'index.html');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(file))})
await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1600,height:1100}}),page=await context.newPage()
let cancelNext=false,failStatus=false,extrasWrites=0
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
page.on('dialog',async d=>{if(d.type()==='alert')alerts.push(d.message());if(cancelNext&&d.type()==='confirm'){cancelNext=false;await d.dismiss()}else if(['confirm','beforeunload'].includes(d.type()))await d.accept();else await d.dismiss()})
await context.addInitScript(({session})=>{localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session))},{session})
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 if(url.hostname==='127.0.0.1'&&url.port==='4173'){if(url.pathname.startsWith('/api/'))return reply({connected:false,data:[]});return route.continue()}
 if(!url.hostname.endsWith('.supabase.co')){if(req.method()!=='GET')blocked.push(url.origin+url.pathname);return reply({})}
 if(url.pathname.includes('/auth/v1/'))return reply(url.pathname.endsWith('/user')?user:session)
 const table=url.pathname.split('/').pop(),single=req.headers().accept?.includes('vnd.pgrst.object')
 if(table==='mio_cloud_state_read_chunks_v297')return reply(chunkRows([...states.values()].map(x=>({...x,user_id:owner})),req.postDataJSON()))
 if(table==='mio_cloud_state_write_v277'){
  const p=req.postDataJSON();writes.push(p.p_key);const old=states.get(p.p_key)
  if(!!old!==p.p_expected_exists||old&&old.updated_at!==p.p_expected_at)return reply({code:'PT409',message:'Synthetic stale preference'},409)
  const row={key:p.p_key,raw_value:p.p_raw,json_value:null,updated_at:new Date().toISOString()};states.set(p.p_key,row);return reply(row)
 }
 if(table==='case_mio_user_state'){let rows=[...states.values()];const key=url.searchParams.get('key');if(key?.startsWith('eq.'))rows=rows.filter(r=>r.key===key.slice(3));return reply(single?rows[0]||null:rows)}
 if(table==='setting_options')return reply(Object.entries({matter_status:['Served- Need to Finalize','Order- Need to Close','Closed'],case_status:['Open','Closed'],matter_type:['Divorce','Other']}).flatMap(([category,names])=>names.map((name,i)=>({id:category+i,category,name,is_active:true,sort_order:i}))))
 if(table==='clients')return reply(matters.map(m=>m.clients))
 if(table==='matters'){const id=url.searchParams.get('id')?.slice(3),record=matters.find(m=>m.id===id)||matters[0];if(req.method()==='PATCH'){if(failStatus){failStatus=false;return reply({message:'Synthetic status conflict'},409)}Object.assign(record,req.postDataJSON())}return reply(single?record:matters)}
 if(table==='mio_withdrawal_workflows'){let rows=[...workflows.values()];const id=url.searchParams.get('matter_id');if(id?.startsWith('eq.'))rows=rows.filter(r=>r.matter_id===id.slice(3));return reply(single?rows[0]||null:rows)}
 if(['mio_save_withdrawal_v1','mio_save_workflow_blocks_v1','mio_close_withdrawal_row_v311'].includes(table)){
  const p=req.postDataJSON(),old=workflows.get(p.p_matter_id);if((old?.revision||0)!==p.p_expected_revision)return reply({code:'40001',message:'Synthetic workflow conflict'},409)
  let state=p.p_state
  if(table==='mio_close_withdrawal_row_v311'){assert.equal(p.p_event.confirmed,true);assert.equal(p.p_event.type,'workflow_complete');state={...old.state,status:'complete',paused:false,paused_at:null,completion_mode:'manual_row',completed_at:now,completion_note:p.p_event.note}}
  const row={owner_id:owner,matter_id:p.p_matter_id,revision:(old?.revision||0)+1,state};workflows.set(p.p_matter_id,row);events.push({event_id:p.p_event_id,event:p.p_event,revision:row.revision,recorded_at:now});return reply(row)
 }
 if(table==='mio_withdrawal_events')return reply(events)
 if(table==='team_members'){const member={id:'synthetic-member',email,first_name:'Test',last_name:'Attorney',is_active:true,page_access:[]};return reply(single?member:[member])}
 return reply(single?null:[])
})
const settle=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await page.waitForTimeout(100)}assert.ok(await fn(),'Fixture state did not settle')}
const table=()=>page.locator('.mio-discovery-compact')
const due=()=>table().locator('tbody tr[id]').evaluateAll(rows=>rows.map(r=>r.children[7].textContent.trim()))
const caseFilter=()=>page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Case Status/})}).first()
const navigate=async hash=>{await page.getByRole('link',{name:hash==='matters'?'Matters':'Discovery',exact:true}).click()}
fs.mkdirSync('native-filter-test-results',{recursive:true})
try{
 await page.goto('http://127.0.0.1:4173/#discovery',{waitUntil:'domcontentloaded'})
 await table().waitFor({timeout:60000})
 assert.equal(await table().locator('tbody tr[id]').count(),3,'closed request excluded by default')
 assert.equal(await caseFilter().getByLabel('Closed',{exact:true}).isChecked(),false)
 const first=await table().locator('tbody tr[id]').first().locator('td').first().boundingBox()
 assert.ok(first.width<65,'Doc column stays narrow even for long names')
 const bounds=await table().boundingBox();assert.ok(bounds.x+bounds.width<=1600,'all thirteen columns fit desktop viewport')
 await table().locator('tbody tr[id]').first().getByRole('button',{name:'Doc',exact:true}).click()
 await page.getByRole('heading',{name:'Edit Document',exact:true}).waitFor()
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
 await table().getByRole('columnheader',{name:/^Response due/}).click()
 assert.deepEqual(await due(),['09/30/2026','08/01/2026','N/A'])
 await page.screenshot({path:'native-filter-test-results/discovery-compact.png',fullPage:true})
 await caseFilter().locator('summary').click()
 await caseFilter().getByRole('button',{name:'All',exact:true}).click()
 await settle(()=>states.has('caseMioStickyFilter:discoveryCaseStatusFilter'))
 assert.equal(await table().locator('tbody tr[id]').count(),4)
 await page.reload({waitUntil:'domcontentloaded'});await table().waitFor({timeout:60000})
 assert.equal(await table().locator('tbody tr[id]').count(),4,'explicit All survives rehydration')
 assert.equal((await due()).at(-1),'N/A','sort survives reload with blank last')
 await caseFilter().locator('summary').click()
 await caseFilter().getByRole('button',{name:'None',exact:true}).click()
 await settle(()=>JSON.parse(states.get('caseMioStickyFilter:discoveryCaseStatusFilter')?.raw_value||'{}').value?.length===0)
 await navigate('matters');await page.getByRole('heading',{name:'Matters',exact:true}).waitFor()
 await navigate('discovery');await table().waitFor()
 assert.equal(await table().locator('tbody tr[id]').count(),0,'None survives navigation')
 await page.reload({waitUntil:'domcontentloaded'});await table().waitFor({timeout:60000})
 assert.equal(await table().locator('tbody tr[id]').count(),0,'None survives reload')
 await caseFilter().locator('summary').click()
 await caseFilter().getByLabel('Closed',{exact:true}).check()
 await settle(()=>JSON.parse(states.get('caseMioStickyFilter:discoveryCaseStatusFilter')?.raw_value||'{}').value?.includes('Closed'))
 assert.equal(await table().locator('tbody tr[id]').count(),1)
 await page.reload({waitUntil:'domcontentloaded'});await table().waitFor({timeout:60000})
 assert.equal(await table().locator('tbody tr[id]').count(),1,'explicit Closed-only selection retained')
 console.log('PASS actual discovery: compact Doc editor, blank dates last, default closed exclusion, All/None/Closed and sort survive navigation/reload')
 await navigate('matters');await page.getByRole('heading',{name:'Matters',exact:true}).waitFor()
 const row=page.locator('tr').filter({has:page.locator('td').filter({hasText:/^SYNTHETIC-1$/})}).first()
 await row.getByRole('button',{name:'Edit',exact:true}).click()
 await page.getByRole('button',{name:'Update Matter',exact:true}).waitFor()
 assert.equal(await page.getByText('Legacy Clio reference (optional)',{exact:true}).count(),1)
 const before=writes.filter(k=>k==='caseMioClioMioRosetta').length
 await page.getByRole('button',{name:'Update Matter',exact:true}).click()
 await page.getByRole('button',{name:'Update Matter',exact:true}).waitFor({state:'hidden'})
 assert.equal(writes.filter(k=>k==='caseMioClioMioRosetta').length,before,'ordinary matter save does not rewrite Clio')
 assert.ok(!alerts.some(x=>/Clio Matter Number|Clio Matter ID/.test(x)),JSON.stringify(alerts))
 console.log('PASS actual matter editor saves incomplete legacy Clio link without requesting a number or writing Clio mapping')
 await page.getByPlaceholder('Predictive search matters',{exact:true}).fill('SYNTHETIC-1')
 await settle(()=>JSON.parse(states.get('caseMioStickyFilter:matterPageSearch')?.raw_value||'{}').value==='SYNTHETIC-1')
 await page.reload({waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Matters',exact:true}).waitFor({timeout:60000})
 assert.equal(await page.getByPlaceholder('Predictive search matters',{exact:true}).inputValue(),'SYNTHETIC-1')
 const second=await context.newPage();second.on('pageerror',e=>errors.push(e.message));await second.goto('http://127.0.0.1:4173/#matters',{waitUntil:'domcontentloaded'})
 await second.getByRole('heading',{name:'Matters',exact:true}).waitFor({timeout:60000})
 assert.equal(await second.getByPlaceholder('Predictive search matters',{exact:true}).inputValue(),'SYNTHETIC-1')
 await second.close()
 console.log('PASS search filters survive full reload and a fresh tab from acknowledged Supabase state')
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
 await page.screenshot({path:'native-filter-test-results/native-matters.png',fullPage:true})
}catch(error){await page.screenshot({path:'native-filter-test-results/failure.png',fullPage:true}).catch(()=>{});fs.writeFileSync('native-filter-test-results/failure.txt',JSON.stringify({error:error.stack,errors,alerts,body:await page.locator('body').innerText().catch(()=>''),writes},null,2));throw error}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
