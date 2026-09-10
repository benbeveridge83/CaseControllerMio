// Production bundle, synthetic accounts/matters only; every external request is intercepted.
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
const oldSteps=structuredClone(workflows.get(matters[0].id).state.steps)
const extras=Object.fromEntries(matters.slice(0,3).map(m=>[m.id,{withdrawal_status:'withdrawing'}]))
const states=new Map(Object.entries({caseControllerDocuments:[],caseControllerMatterExtraInfo:extras,caseMioWithdrawalViewV305:{open:false,show:'active'}}).map(([key,v])=>[key,{key,raw_value:JSON.stringify(v),json_value:v,updated_at:now}]))
const events=[],errors=[],blocked=[],server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep)&&p!==root){res.writeHead(403);return res.end()};const file=fs.existsSync(p)&&fs.statSync(p).isFile()?p:path.join(root,'index.html');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(file))})
await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1600,height:1100}}),page=await context.newPage()
let cancelNext=false,failStatus=false,extrasWrites=0
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
page.on('dialog',async d=>{if(cancelNext&&d.type()==='confirm'){cancelNext=false;await d.dismiss()}else if(['confirm','beforeunload'].includes(d.type()))await d.accept();else await d.dismiss()})
await context.addInitScript(({session})=>{localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session))},{session})
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 if(url.hostname==='127.0.0.1'&&url.port==='4173'){if(url.pathname.startsWith('/api/'))return reply({connected:false,data:[]});return route.continue()}
 if(!url.hostname.endsWith('.supabase.co')){if(req.method()!=='GET')blocked.push(url.origin+url.pathname);return reply({})}
 if(url.pathname.includes('/auth/v1/'))return reply(url.pathname.endsWith('/user')?user:session)
 const table=url.pathname.split('/').pop(),single=req.headers().accept?.includes('vnd.pgrst.object')
 if(table==='mio_cloud_state_read_chunks_v297')return reply(chunkRows([...states.values()].map(x=>({...x,user_id:owner})),req.postDataJSON()))
 if(table==='mio_cloud_state_write_v277'){const p=req.postDataJSON();if(p.p_key==='caseControllerMatterExtraInfo'){extrasWrites++;return reply({code:'PT409',message:'Synthetic other-tab conflict'},409)}const row={key:p.p_key,raw_value:p.p_raw,json_value:null,updated_at:new Date().toISOString()};states.set(p.p_key,row);return reply(row)}
 if(table==='case_mio_user_state'){let rows=[...states.values()];const key=url.searchParams.get('key');if(key?.startsWith('eq.'))rows=rows.filter(r=>r.key===key.slice(3));return reply(single?rows[0]||null:rows)}
 if(table==='setting_options')return reply(Object.entries({matter_status:['Served- Need to Finalize','Order- Need to Close','Closed'],case_status:['Open','Closed'],matter_type:['Divorce','Other']}).flatMap(([category,names])=>names.map((name,i)=>({id:category+i,category,name,is_active:true,sort_order:i}))))
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
const settle=async fn=>{for(let i=0;i<100;i++){if(fn())return;await page.waitForTimeout(100)}assert.ok(fn(),'Fixture state did not settle')}
const reviewTable=()=>page.locator('details').filter({has:page.locator('summary').filter({hasText:'Review all 73 matching matters'})}).first()
const summary=n=>page.locator('tr.mio-block-summary').filter({hasText:'SYNTHETIC-'+n})
const candidate=n=>reviewTable().locator('tbody tr').filter({hasText:new RegExp('Client '+n+' - Matter '+n+'(?:\\D|$)')})
const dialog=()=>page.locator('dialog[open]')
fs.mkdirSync('withdrawal-test-results',{recursive:true})
try{
 await page.goto('http://127.0.0.1:4173/#withdrawals',{waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Withdrawal dashboard',exact:true}).waitFor({timeout:60000})
 assert.match(await page.locator('body').innerText(),/Mio V31[123]/)
 await page.getByText('Review all 73 matching matters / change status',{exact:true}).click()
 assert.equal(await reviewTable().locator('tbody tr').count(),73)
 await candidate(73).getByRole('button',{name:'Change status',exact:true}).click()
 await dialog().getByLabel('Matter status',{exact:true}).selectOption('Order- Need to Close')
 await dialog().getByRole('button',{name:'Save matter status',exact:true}).click()
 await settle(()=>matters[72].matter_status==='Order- Need to Close')
 await dialog().waitFor({state:'hidden'})
 console.log('PASS all 73 matching rows and last-row matter status update')
 await summary(1).getByRole('button',{name:'Change status',exact:true}).click()
 assert.equal(await page.locator('.mio-block-expanded').count(),0)
 await dialog().getByLabel('Matter status',{exact:true}).selectOption('Closed')
 await dialog().getByRole('button',{name:'Save matter status',exact:true}).click()
 await settle(()=>matters[0].matter_status==='Closed');await dialog().waitFor({state:'hidden'})
 console.log('PASS workflow-row status control is isolated from row expansion')
 await summary(1).getByRole('button',{name:'Review',exact:true}).click()
 cancelNext=true;await page.locator('.mio-block-expanded').getByRole('button',{name:'Mark complete',exact:true}).click()
 assert.equal(workflows.get(matters[0].id).state.status,'active')
 await page.locator('.mio-block-expanded').getByRole('button',{name:'Mark complete',exact:true}).click()
 await settle(()=>workflows.get(matters[0].id).state.status==='complete')
 await summary(1).waitFor({state:'hidden'})
 assert.deepEqual(workflows.get(matters[0].id).state.steps,oldSteps)
 assert.equal(matters[0].case_status,'Open')
 console.log('PASS cancel and confirm whole-row completion; step evidence and case status retained')
 const before=extrasWrites,secondSteps=structuredClone(workflows.get(matters[1].id).state.steps)
 await summary(2).getByRole('button',{name:'Review',exact:true}).click()
 await page.locator('.mio-block-expanded').getByRole('button',{name:'Release from withdrawal',exact:true}).click()
 await settle(()=>workflows.get(matters[1].id).state.status==='released')
 await summary(2).waitFor({state:'hidden'})
 await candidate(3).getByRole('button',{name:'Release from withdrawal',exact:true}).click()
 await settle(()=>workflows.get(matters[2].id).state.status==='released')
 assert.deepEqual(workflows.get(matters[1].id).state.steps,secondSteps)
 assert.equal(extrasWrites,before,'Releasing a row must not touch conflicting shared extras')
 console.log('PASS release from both tables, preserving history without overwriting another tab')
 failStatus=true
 await candidate(73).getByRole('button',{name:'Change status',exact:true}).click()
 await dialog().getByLabel('Matter status',{exact:true}).selectOption('Closed')
 await dialog().getByRole('button',{name:'Save matter status',exact:true}).click()
 await dialog().getByRole('alert').filter({hasText:'Synthetic status conflict'}).waitFor()
 assert.equal(matters[72].matter_status,'Order- Need to Close')
 await dialog().getByRole('button',{name:'Close',exact:true}).click()
 await page.reload({waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Withdrawal dashboard',exact:true}).waitFor({timeout:60000})
 assert.equal(await page.locator('tr.mio-block-summary').count(),0)
 await page.getByLabel('Workflow view',{exact:true}).selectOption('complete')
 await summary(1).waitFor()
 await summary(1).getByRole('button',{name:'Review',exact:true}).click()
 assert.ok((await page.locator('.mio-block-expanded').innerText()).includes('Closed by attorney - step history retained'))
 await page.screenshot({path:'withdrawal-test-results/completed-row.png',fullPage:true})
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
 console.log('PASS saved states survive reload, completed-history view, visible failed-save feedback; zero browser exceptions or external writes')
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
