// All external requests are intercepted. No real account or production write is used.
import {chromium} from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {chunkRows} from './cloud-chunk-fixture.js'
fs.mkdirSync('test-results',{recursive:true})
const browser=await chromium.launch({headless:true})
const id='00000000-0000-4000-8000-000000000297',email='startup-test@example.invalid'
const user={id,email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:new Date().toISOString()}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),exp=Math.floor(Date.now()/1000)+3600
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:id,email,role:'authenticated',exp,aud:'authenticated'})}.test-signature`,refresh_token:'synthetic-test-token',expires_at:exp,expires_in:3600,token_type:'bearer',user}
async function open({loggedIn=false,legacy=false,failRead=false,large=false}={}){
 const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage()
 const errors=[],reads=[],writes=[],archives=[],settings={failRead},states=new Map([['caseMioSnapshotGraphShowInvoicesV259',{key:'caseMioSnapshotGraphShowInvoicesV259',raw_value:'true',updated_at:'2026-09-05T00:00:00Z'}]])
 if(large)for(let i=0;i<215;i++)states.set('caseMioFixture'+i,{key:'caseMioFixture'+i,raw_value:JSON.stringify(i===0?'x'.repeat(3500000):'fixture '+i),updated_at:'2026-09-05T00:00:00Z'})
 page.on('pageerror',error=>errors.push(error.message))
 context.on('page',p=>p.on('pageerror',error=>errors.push(error.message)))
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url())
  const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
  if(['127.0.0.1','localhost'].includes(url.hostname))return url.pathname.startsWith('/api/')?respond({connected:false,data:[]}):route.continue()
  if(!url.hostname.endsWith('.supabase.co'))return respond({})
  if(url.pathname.includes('/auth/v1/'))return respond(url.pathname.endsWith('/user')?user:session)
  const table=url.pathname.split('/').pop()
  if(table==='mio_cloud_state_read_chunks_v297'){
    const p=request.postDataJSON();reads.push(p)
    assert.equal(p.p_user_id,id);assert.ok(p.p_keys.length<=4&&p.p_chunk_chars*p.p_keys.length<=262144)
    if(settings.failRead)return respond({message:'Synthetic gateway timeout'},504)
    if(large&&p.p_keys.includes('caseMioFixture0')&&p.p_keys.length>1)return respond({message:'Synthetic grouped-read timeout'},504)
    const data=chunkRows([...states.values()].map(row=>({...row,user_id:id})),p)
    assert.ok(data.reduce((n,row)=>n+Array.from(row.raw_value).length,0)<=262144)
    await new Promise(resolve=>setTimeout(resolve,large?12:0))
    return respond(data)
  }
  if(table==='mio_cloud_state_write_v277'){
    const p=request.postDataJSON();writes.push(p)
    const old=states.get(p.p_key)
    if(old?.raw_value!==p.p_raw&&(!!old!==p.p_expected_exists||(old&&old.updated_at!==p.p_expected_at)))return respond({code:'40001',message:'Synthetic stale write'},409)
    if(p.p_delete){states.delete(p.p_key);return respond({key:p.p_key,deleted:true})}
    const row={key:p.p_key,raw_value:p.p_raw,updated_at:new Date().toISOString()};states.set(p.p_key,row);return respond(row)
  }
  if(table==='case_mio_browser_recovery'){
    if(request.method()==='POST'){const data=request.postDataJSON().map((r,i)=>({...r,id:String(archives.length+i+1)}));archives.push(...data);return respond(data,201)}
    return respond(archives)
  }
  if(table==='case_mio_user_state'){
    if(settings.failRead&&request.method()==='GET')return respond({message:'Synthetic cloud read failure'},503)
    if(request.method()==='POST'){for(const row of request.postDataJSON())if(!states.has(row.key))states.set(row.key,row);return respond([],201)}
    let data=[...states.values()].sort((a,b)=>a.key.localeCompare(b.key));const key=url.searchParams.get('key')
    if(key?.startsWith('eq.'))data=data.filter(r=>r.key===key.slice(3))
    if(key?.startsWith('neq.'))data=data.filter(r=>r.key!==key.slice(4))
    const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000)
    data=data.slice(offset,offset+limit)
    const fields=(url.searchParams.get('select')||'*').split(',')
    if(large&&fields.includes('raw_value'))return respond({message:'Bulk reads are too large'},504)
    return respond(fields.includes('*')?data:data.map(row=>Object.fromEntries(fields.map(field=>[field,row[field]]))))
  }
  if(table==='team_members'){
    const member={id:'synthetic-member',email,first_name:'Startup',last_name:'Test',is_active:true,page_access:[]}
    return respond(request.headers().accept?.includes('vnd.pgrst.object')?member:[member])
  }
  return respond(request.headers().accept?.includes('vnd.pgrst.object')?null:[])
 })
 await context.addInitScript(({session,loggedIn,legacy})=>{
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
 return{context,page,errors,reads,writes,archives,states,settings}
}
try{
 const started=Date.now(),f=await open({loggedIn:true,large:true})
 await f.page.getByRole('button',{name:'Mio state: saved to Supabase',exact:true}).waitFor({timeout:90000})
 await f.page.waitForTimeout(600)
 const coldMs=Date.now()-started,coldReads=f.reads.length
 // Add/change/delete on the server after the first tab loaded. Its RAM is stale.
 f.states.set('caseMioFixtureNew',{key:'caseMioFixtureNew',raw_value:'"new record"',updated_at:'2026-09-06T12:00:00Z'})
 f.states.set('caseMioFixture2',{key:'caseMioFixture2',raw_value:'"changed record"',updated_at:'2026-09-06T12:00:01Z'})
 f.states.delete('caseMioFixture1')
 const before=f.reads.length,warmStart=Date.now(),second=await f.context.newPage()
 await second.goto('http://127.0.0.1:4173/#withdrawals',{waitUntil:'domcontentloaded'})
 await second.getByRole('button',{name:'Mio state: saved to Supabase',exact:true}).waitFor({timeout:45000})
 const warmMs=Date.now()-warmStart,reads=f.reads.slice(before)
 assert.ok(reads.length<=4,`Warm tab reloaded too many groups: ${reads.length}`)
 assert.ok(!reads.some(p=>p.p_keys.includes('caseMioFixture0')),'Large unchanged record was downloaded again')
 assert.ok(reads.some(p=>p.p_keys.includes('caseMioFixture2')),'Changed server record was not refreshed')
 assert.ok(reads.some(p=>p.p_keys.includes('caseMioFixtureNew')),'New server record was not fetched')
 const beforeNavigation=f.reads.length
 await second.evaluate(()=>{location.hash='documents'})
 await second.waitForTimeout(500)
 assert.equal(f.reads.length,beforeNavigation,'Navigation restarted cloud hydration')
 assert.deepEqual(f.errors,[])
 assert.deepEqual(await second.evaluate(()=>window.__nativeAppWrites),[])
 await second.screenshot({path:'test-results/cloud-warm-tab.png'})
 console.log(JSON.stringify({test:'cold and warm new-window startup',coldMs,warmMs,coldReadRequests:coldReads,warmReadRequests:reads.length,largeRecordReused:true,serverChangesValidated:true,caseDataDiskWrites:0}))
 await f.context.close()
}finally{await browser.close()}
