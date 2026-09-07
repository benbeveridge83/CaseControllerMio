// Synthetic accounts only. All external requests intercepted; no real login or case data.
import {chromium} from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {chunkRows} from './cloud-chunk-fixture.js'
fs.mkdirSync('test-results',{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})})
const origin=process.env.MIO_TEST_ORIGIN||'http://127.0.0.1:4173'
const owner='00000000-0000-4000-8000-000000000305',email='auth-recovery@example.invalid'
const user={id:owner,email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:new Date().toISOString()}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
const tokenKey='sb-vnnkxqpyndidnjbrbywz-auth-token'
const sessionFor=seconds=>{const exp=Math.floor(Date.now()/1000)+seconds;return{access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,email,role:'authenticated',exp,aud:'authenticated'})}.synthetic-signature`,refresh_token:'synthetic-refresh-only',expires_at:exp,expires_in:seconds,token_type:'bearer',user}}
async function setup({seconds=3600,mode='ok',poisonLock=false}={}){
 const context=await browser.newContext({viewport:{width:1440,height:960}}),errors=[],warnings=[]
 const states=new Map([['caseMioSnapshotGraphShowInvoicesV259',{key:'caseMioSnapshotGraphShowInvoicesV259',raw_value:'true',updated_at:'2026-09-07T00:00:00Z'}]])
 const stats={mode,refreshes:0,writes:0,reads:0}
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),single=req.headers().accept?.includes('vnd.pgrst.object')
  const respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  if(url.origin===origin){if(url.pathname==='/__old_tab__')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Old tab fixture</title>'});if(url.pathname.startsWith('/api/'))return respond({connected:false,data:[]});return route.continue()}
  if(!url.hostname.endsWith('.supabase.co'))return respond({})
  if(url.pathname.includes('/auth/v1/')){
    if(url.pathname.endsWith('/token')){stats.refreshes++;await new Promise(r=>setTimeout(r,300));if(stats.mode==='offline')return respond({message:'Synthetic network outage'},503);if(stats.mode==='revoked')return respond({code:'refresh_token_not_found',message:'Invalid Refresh Token'},400);return respond(sessionFor(3600))}
    return respond(url.pathname.endsWith('/user')?user:{})
  }
  if(req.method()==='GET'||url.pathname.endsWith('mio_cloud_state_read_chunks_v297'))stats.reads++
  else stats.writes++
  const table=url.pathname.split('/').pop()
  if(table==='mio_cloud_state_read_chunks_v297')return respond(chunkRows([...states.values()].map(r=>({...r,user_id:owner})),req.postDataJSON()))
  if(table==='mio_cloud_state_write_v277'){const p=req.postDataJSON(),old=states.get(p.p_key);if(old?.raw_value!==p.p_raw&&(!!old!==p.p_expected_exists||(old&&old.updated_at!==p.p_expected_at)))return respond({code:'40001',message:'Synthetic stale write'},409);const row={key:p.p_key,raw_value:p.p_raw,json_value:null,updated_at:new Date().toISOString()};states.set(row.key,row);return respond(row)}
  if(table==='case_mio_user_state')return respond([...states.values()])
  if(table==='team_members'){const m={id:'synthetic-member',email,first_name:'Auth',last_name:'Recovery',is_active:true,page_access:[]};return respond(single?m:[m])}
  return respond(single?null:[])
 })
 if(poisonLock){
  const old=await context.newPage();await old.goto(origin+'/__old_tab__')
  await old.evaluate(key=>{window.__held=false;void navigator.locks.request('lock:'+key,()=>{window.__held=true;return new Promise(()=>{})}).catch(()=>{})},tokenKey)
  await old.waitForFunction(()=>window.__held)
 }
 const page=await context.newPage()
 page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='warning')warnings.push(msg.text())})
 await page.addInitScript(({session,tokenKey,poisonLock})=>{
  if(!sessionStorage.getItem('auth-test-seeded')){localStorage.setItem(tokenKey,JSON.stringify(session));localStorage.setItem('unrelated-preserved','do-not-delete');sessionStorage.setItem('auth-test-seeded','true')}
  window.__authLockRequests=0
  const request=navigator.locks.request.bind(navigator.locks)
  navigator.locks.request=(name,...args)=>{
    if(name==='lock:'+tokenKey){window.__authLockRequests++;if(poisonLock)return new Promise(()=>{})}
    return request(name,...args)
  }
 },{session:sessionFor(seconds),tokenKey,poisonLock})
 await page.goto(origin+'/#withdrawals',{waitUntil:'domcontentloaded'})
 return{context,page,errors,warnings,states,stats}
}
async function ready(test){
 try{
  await test.page.getByRole('heading',{name:'Withdrawal dashboard',exact:true}).waitFor({timeout:25000})
  await test.page.getByRole('button',{name:'Mio state: saved to Supabase',exact:true}).waitFor({timeout:15000})
  assert.deepEqual(test.errors,[])
  assert.equal(await test.page.evaluate(()=>window.__authLockRequests),0)
  assert.equal(await test.page.evaluate(()=>localStorage.getItem('unrelated-preserved')),'do-not-delete')
  assert.equal(test.states.get('caseMioSnapshotGraphShowInvoicesV259').raw_value,'true')
  assert.equal(test.warnings.some(w=>/orphaned lock|not released within/.test(w)),false)
 }catch(error){await test.page.screenshot({path:'test-results/auth-failure.png'});fs.writeFileSync('test-results/auth-failure.txt',String(error)+'\n'+test.errors.join('\n')+'\n'+await test.page.locator('body').innerText());throw error}
}
try{
 for(const seconds of [3600,30,-30]){
  const t=await setup({seconds});try{await ready(t);if(seconds<90)assert.ok(t.stats.refreshes>0);await t.page.reload();await ready(t);console.log('PASS sign-in and reload with token lifetime '+seconds+'s')}finally{await t.context.close()}
 }
 const blocked=await setup({seconds:30,poisonLock:true});try{await ready(blocked);await blocked.page.screenshot({path:'test-results/auth-lock-recovered.png'});console.log('PASS startup with old tab holding auth lock and non-resolving Web Locks')}finally{await blocked.context.close()}
 const outage=await setup({seconds:-30,mode:'offline'});try{
  await outage.page.getByRole('heading',{name:'Cloud data could not be loaded',exact:true}).waitFor({timeout:25000})
  assert.equal(outage.stats.writes,0);assert.equal(outage.stats.reads,0)
  assert.ok(await outage.page.evaluate(key=>localStorage.getItem(key),tokenKey))
  assert.equal(await outage.page.evaluate(()=>localStorage.getItem('unrelated-preserved')),'do-not-delete')
  outage.stats.mode='ok';await outage.page.getByRole('button',{name:'Retry',exact:true}).click();await ready(outage)
  console.log('PASS offline startup fails closed; Retry recovers without clearing storage')
 }finally{await outage.context.close()}
 const revoked=await setup({seconds:-30,mode:'revoked'});try{
  await revoked.page.getByRole('heading',{name:'Case Controller Login',exact:true}).waitFor({timeout:25000})
  assert.equal(revoked.stats.writes,0);assert.equal(revoked.stats.reads,0);assert.deepEqual(revoked.errors,[])
  assert.equal(await revoked.page.evaluate(()=>localStorage.getItem('unrelated-preserved')),'do-not-delete')
  console.log('PASS revoked session requires login; never bypasses authentication')
 }finally{await revoked.context.close()}
}finally{await browser.close()}
