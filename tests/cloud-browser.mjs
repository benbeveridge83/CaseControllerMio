// All remote requests are intercepted. No real account, client record, or API write is used.
import {chromium} from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
fs.mkdirSync('test-results',{recursive:true})
const browser=await chromium.launch({headless:true})
const id='00000000-0000-4000-8000-000000000277',email='storage-test@example.invalid'
const user={id,email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:new Date().toISOString()}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
const exp=Math.floor(Date.now()/1000)+3600
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:id,email,role:'authenticated',exp,aud:'authenticated'})}.test-signature`,refresh_token:'synthetic-test-token',expires_at:exp,expires_in:3600,token_type:'bearer',user}
async function open({loggedIn=false,legacy=false,failRead=false}={}){
 const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage(),errors=[],diskWrites=[],archives=[],states=new Map([['caseMioSnapshotGraphShowInvoicesV259',{key:'caseMioSnapshotGraphShowInvoicesV259',raw_value:'true',json_value:true,updated_at:'2026-09-05T00:00:00Z'}]])
 page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url())
  const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
  if(url.hostname==='127.0.0.1'||url.hostname==='localhost'){
    if(url.pathname.startsWith('/api/'))return respond({connected:false,data:[]})
    return route.continue()
  }
  if(!url.hostname.endsWith('.supabase.co'))return respond({})
  if(url.pathname.includes('/auth/v1/'))return respond(url.pathname.endsWith('/user')?user:session)
  const table=url.pathname.split('/').pop()
  if(table==='mio_cloud_state_write_v277'){
    const p=request.postDataJSON(),old=states.get(p.p_key)
    if(old?.raw_value!==p.p_raw&&(!!old!==p.p_expected_exists||(old&&old.updated_at!==p.p_expected_at)))return respond({code:'40001',message:'Synthetic stale write'},409)
    if(p.p_delete){states.delete(p.p_key);return respond({key:p.p_key,deleted:true})}
    const row={key:p.p_key,raw_value:p.p_raw,json_value:null,updated_at:new Date().toISOString()};states.set(p.p_key,row);return respond(row)
  }
  if(table==='case_mio_browser_recovery'){
    if(request.method()==='POST'){const rows=request.postDataJSON().map((r,i)=>({...r,id:String(archives.length+i+1)}));archives.push(...rows);return respond(rows,201)}
    return respond(archives)
  }
  if(table==='case_mio_user_state'){
    if(failRead&&request.method()==='GET')return respond({message:'Synthetic cloud read failure'},503)
    if(request.method()==='POST'){for(const row of request.postDataJSON())if(!states.has(row.key))states.set(row.key,row);return respond([],201)}
    let rows=[...states.values()];const key=url.searchParams.get('key');if(key?.startsWith('eq.'))rows=rows.filter(r=>r.key===key.slice(3))
    return respond(rows)
  }
  if(table==='team_members'){
    const member={id:'synthetic-member',email,first_name:'Storage',last_name:'Test',is_active:true,page_access:[]}
    return respond(request.headers().accept?.includes('vnd.pgrst.object')?member:[member])
  }
  return respond(request.headers().accept?.includes('vnd.pgrst.object')?null:[])
 })
 await page.addInitScript(({session,loggedIn,legacy})=>{
  if(!sessionStorage.getItem('test-initialized')){
    if(loggedIn)localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session))
    if(legacy){localStorage.setItem('caseMioSnapshotGraphShowInvoicesV259','false');localStorage.setItem('caseMioBrowserMigrationTestV277','synthetic-only')}
    sessionStorage.setItem('test-initialized','true')
  }
  window.__nativeAppWrites=[]
  const original=Storage.prototype.setItem
  Storage.prototype.setItem=function(key,value){if(this===window.localStorage&&/^(caseMio|caseController)/.test(key)&&!/^caseMio(BackgroundLeaseV258:|SupabaseSessionV1$)/.test(key))window.__nativeAppWrites.push(key);return original.call(this,key,value)}
 },{session,loggedIn,legacy})
 await page.goto('http://127.0.0.1:4173',{waitUntil:'domcontentloaded'})
 return{context,page,errors,archives,states,diskWrites}
}
try{
 const login=await open();await login.page.getByRole('heading',{name:'Case Controller Login'}).waitFor({timeout:30000});await login.page.screenshot({path:'test-results/login.png'});assert.deepEqual(login.errors,[]);await login.context.close()
 const migration=await open({loggedIn:true,legacy:true});await migration.page.getByRole('heading',{name:'Preserve older browser records'}).waitFor({timeout:30000});await migration.page.screenshot({path:'test-results/migration.png'})
 await migration.page.getByRole('button',{name:'These are my records: preserve in Supabase and continue',exact:true}).click()
 await migration.page.getByRole('button',{name:'Mio state: saved to Supabase',exact:true}).waitFor({timeout:45000})
 await migration.page.screenshot({path:'test-results/cloud-workspace.png'})
 assert.equal(migration.archives.length,2);assert.equal(migration.states.get('caseMioSnapshotGraphShowInvoicesV259').raw_value,'true')
 assert.equal(await migration.page.evaluate(()=>localStorage.getItem('caseMioBrowserMigrationTestV277')),null)
 assert.deepEqual(await migration.page.evaluate(()=>window.__nativeAppWrites),[])
 assert.deepEqual(migration.errors,[])
 await migration.page.reload();await migration.page.getByRole('button',{name:'Mio state: saved to Supabase',exact:true}).waitFor({timeout:45000});assert.deepEqual(migration.errors,[]);await migration.context.close()
 const failure=await open({loggedIn:true,legacy:true,failRead:true});await failure.page.getByRole('heading',{name:'Cloud data could not be loaded'}).waitFor({timeout:30000});assert.equal(await failure.page.evaluate(()=>localStorage.getItem('caseMioBrowserMigrationTestV277')),'synthetic-only');await failure.page.screenshot({path:'test-results/cloud-read-failure.png'});await failure.context.close()
 console.log('PASS: login, authenticated workspace, migration read-back, cloud wins conflicts, no new app disk writes, reload, and failed-read preservation')
}finally{await browser.close()}
