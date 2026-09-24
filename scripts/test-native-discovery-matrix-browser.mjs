// Synthetic records only. Every external request is intercepted; no live account writes.
import {chromium} from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {chunkRows} from '../tests/cloud-chunk-fixture.js'
const root=path.resolve('dist'),now=new Date().toISOString(),owner='00000000-0000-4000-8000-000000003110',email='synthetic-matrix@example.invalid'
const user={id:owner,email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:now}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),exp=Math.floor(Date.now()/1000)+3600
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,email,role:'authenticated',exp,aud:'authenticated'})}.test`,refresh_token:'test-only',expires_at:exp,expires_in:3600,token_type:'bearer',user}
const matter=(id,name,caseStatus,matterStatus,caseType)=>({id,name,case_type:caseType,matter_type:caseType,matter_status:matterStatus,case_status:caseStatus,is_active:true,cause_number:'SYN-'+id,created_at:now,clients:{first_name:'Client',last_name:id,email:'c'+id+'@example.invalid'},courts:{court_name:'Synthetic court',county:'Synthetic'}})
const matters=[matter('m0','Open Divorce','Open','Served- Need to Finalize','Divorce'),matter('m1','Closed Divorce','Closed','Order- Need to Close','Divorce'),matter('m2','Open Other','Open','Served- Need to Finalize','Other'),matter('m3','Open No Docs','Open','Served- Need to Finalize','Divorce')]
matters.forEach((m)=>{m.client_id='c'+m.id;m.clients.id=m.client_id})
const doc=(id,matterId,type,name)=>({id,matter_id:matterId,discovery_side:'ours',discovery_type:type,name,file_name:name+'.pdf',tag_ids:[],document_field_values:{},status:'Ours',is_active:true})
const docs=[doc('d-rfp-0','m0','rfp','RFP to them'),doc('d-rfp-1','m0','rfp','Amended RFP to them'),doc('d-rfd-0','m0','rfd','RFD to them'),doc('d-rfp-closed','m1','rfp','RFP on closed matter'),doc('d-rfa-2','m2','rfa','RFA to them')]
const requests=[{id:'doc-d-rfd-0',document_id:'d-rfd-0',matter_id:'m0',side:'our',discovery_type:'rfd',request_served:'2026-08-01',responses:[]}]
const states=new Map(Object.entries({caseControllerDocuments:docs,caseControllerDiscoveryRequests:requests,caseMioClioMioRosetta:{}}).map(([key,v])=>[key,{key,raw_value:JSON.stringify(v),json_value:v,updated_at:now}]))
const writes=[],errors=[],blocked=[]
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep)&&p!==root){res.writeHead(403);return res.end()};const file=fs.existsSync(p)&&fs.statSync(p).isFile()?p:path.join(root,'index.html');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(file))})
await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1600,height:1100}}),page=await context.newPage()
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
page.on('dialog',async d=>{if(d.type()==='alert')await d.dismiss();else await d.accept()})
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
  if(table==='matters'){const id=url.searchParams.get('id')?.slice(3),record=matters.find(m=>m.id===id)||matters[0];if(req.method()==='PATCH')Object.assign(record,req.postDataJSON());return reply(single?record:matters)}
  if(table==='team_members'){const member={id:'synthetic-member',email,first_name:'Test',last_name:'Attorney',is_active:true,page_access:[]};return reply(single?member:[member])}
  return reply(single?null:[])
})
const settle=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await page.waitForTimeout(100)}assert.ok(await fn(),'Fixture state did not settle')}
const cycleButtons=()=>page.getByRole('button',{name:/cycle/})
const matterLinks=()=>page.locator('a[href^="#matter_dashboard:"]')
fs.mkdirSync('native-filter-test-results',{recursive:true})
try{
  await page.goto('http://127.0.0.1:4173/#discovery',{waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'Discovery Table',exact:true}).click()
  await page.getByRole('button',{name:'Our discovery requests',exact:true}).waitFor()
  await matterLinks().first().waitFor({timeout:60000})
  const linkCount=await matterLinks().count()
  assert.equal(linkCount,3,'expected 3 matter links, got '+linkCount)
  assert.equal(await matterLinks().filter({hasText:'Closed Divorce'}).count(),0,'closed matter hidden by default')
  assert.equal(await matterLinks().filter({hasText:'Open Divorce'}).count(),1)
  assert.equal(await matterLinks().filter({hasText:'Open Other'}).count(),1)
  assert.equal(await matterLinks().filter({hasText:'Open No Docs'}).count(),1)
  assert.ok(await page.getByText('Served',{exact:true}).count()>=1,'served cell derived from tracking request_served')
  const before=await cycleButtons().count();assert.ok(before>=1,'cycle controls render')
  await cycleButtons().first().click()
  await settle(()=>states.has('caseMioDiscoveryMatrixState'))
  const override=JSON.parse(states.get('caseMioDiscoveryMatrixState').raw_value)
  assert.ok(Object.values(override).some((cell)=>cell?.status),'cycle persisted a status override')
  await page.getByRole('button',{name:'+',exact:true}).first().click()
  await settle(async()=> (await page.getByText('Amended RFP to them',{exact:true}).count())>=1)
  const caseFilter=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Case Status/})}).first()
  await caseFilter.locator('summary').click()
  await caseFilter.getByRole('button',{name:'None',exact:true}).click()
  await settle(()=>JSON.parse(states.get('caseMioStickyFilter:discoveryMatrixCaseStatusFilter')?.raw_value||'{}').value?.length===0)
  assert.equal(await matterLinks().count(),0,'None hides all matters')
  await page.reload({waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'Discovery Table',exact:true}).click()
  await settle(async()=> (await page.getByText('Our discovery requests',{exact:true}).count())>=1)
  assert.equal(await matterLinks().count(),0,'None filter survives reload')
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  await page.screenshot({path:'native-filter-test-results/discovery-matrix.png',fullPage:true})
  console.log('PASS discovery matrix: matter rows, status cycle, served-date derivation, + expansion, and sticky filters survive reload')
}catch(error){await page.screenshot({path:'native-filter-test-results/discovery-matrix-failure.png',fullPage:true}).catch(()=>{});fs.writeFileSync('native-filter-test-results/discovery-matrix-failure.txt',JSON.stringify({error:error.stack,errors,blocked,body:await page.locator('body').innerText().catch(()=>''),writes},null,2));throw error}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}


