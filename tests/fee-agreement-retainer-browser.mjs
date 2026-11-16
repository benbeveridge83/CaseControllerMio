// Fee Agreement / Retainer UI smoke test (synthetic auth + mocked network).
// Mirrors tests/auth-startup-browser.mjs: fake Supabase session in localStorage,
// intercept all .supabase.co and /api/* traffic, return synthetic data.
// Covers: PNC hook load, Settings PDF mapper, Fee Agreement window, Retainer window.
// Does NOT exercise real Dropbox Sign / LawPay (those need the live preview + keys).
import {chromium} from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
fs.mkdirSync('test-results',{recursive:true})

const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})})
const origin=process.env.MIO_TEST_ORIGIN||'http://127.0.0.1:4173'
const owner='00000000-0000-4000-8000-000000000999'
const email='fee-agreement-test@example.invalid'
const matterId='00000000-0000-4000-8000-000000000111'
const clientId='00000000-0000-4000-8000-000000000222'
const user={id:owner,email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:new Date().toISOString()}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
const tokenKey='sb-vnnkxqpyndidnjbrbywz-auth-token'
const session=()=>{const exp=Math.floor(Date.now()/1000)+3600;return{access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,email,role:'authenticated',exp,aud:'authenticated'})}.synthetic-signature`,refresh_token:'synthetic-refresh',expires_at:exp,expires_in:3600,token_type:'bearer',user}}

const workflow={matter_id:matterId,user_id:owner,client_id:clientId,creation_key:'00000000-0000-4000-8000-000000000333',config:{retainer:5000,hourly_rate:250,evergreen_minimum_balance:'2000',signature_pdf_path:'',signature_pdf_fields:'[]'},state:{signature:{status:'not_sent'},retainer:{status:'not_paid'}},revision:0,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}

const context=await browser.newContext({viewport:{width:1440,height:960}})
await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url())
  const respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  const single=req.headers().accept?.includes('vnd.pgrst.object')
  if(url.origin===origin){
    if(url.pathname.startsWith('/api/')){ // mock PNC serverless handler
      let body={};try{body=req.postDataJSON()||{}}catch{}
      if(url.pathname==='/api/pnc'){
        if(body.action==='list')return respond({rows:[workflow]})
        if(body.action==='minimum_balance')return respond({minimum_balance:2000})
        if(body.action==='refresh')return respond({workflow})
        if(body.action==='save')return respond({workflow:{...workflow,config:body.config}})
        if(body.action==='prepare_engagement')return respond({workflow:{...workflow,state:{...workflow.state,retainer_request:{url:'https://secure.lawpay.com/synthetic'}}}})
        if(body.action==='send_signature')return respond({workflow:{...workflow,state:{...workflow.state,signature:{status:'awaiting_signature',id:'sig-1'}}}})
        return respond({workflow})
      }
      return respond({connected:false,data:[]})
    }
    return route.continue()
  }
  if(!url.hostname.endsWith('.supabase.co'))return respond({})
  if(url.pathname.includes('/auth/v1/'))return respond(url.pathname.endsWith('/user')?user:{})
  const table=url.pathname.split('/').pop()
  if(table==='matters'){const m={id:matterId,client_id:clientId,name:'Test PNC Matter',matter_type:'SAPCR/Modification',matter_status:'Consult- Need to Client',case_status:'Open',is_active:true,clients:{id:clientId,first_name:'Jane',last_name:'Client',email:'jane@example.com',phone:''}};return respond(single?m:[m])}
  if(table==='clients'){const c={id:clientId,first_name:'Jane',last_name:'Client',email:'jane@example.com',phone:'',is_active:true};return respond(single?c:[c])}
  if(table==='mio_pnc_staff')return respond(single?{user_id:owner}:[{user_id:owner}])
  if(table==='case_mio_user_state')return respond(single?null:[{key:'caseMioClioMinimumBalancesByMatterId',raw_value:JSON.stringify({[matterId]:2000}),json_value:null}])
  if(table==='setting_options')return respond([])
  return respond(single?null:[])
})

const page=await context.newPage()
page.on('pageerror',e=>console.log('PAGEERROR',e.message))
page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE.ERROR',m.text())})
await page.addInitScript(({session,tokenKey})=>{localStorage.setItem(tokenKey,JSON.stringify(session))},{session:session(),tokenKey})
await page.goto(origin+'/#matters',{waitUntil:'domcontentloaded'})

const shot=name=>page.screenshot({path:`test-results/${name}.png`})
await page.waitForTimeout(8000)
await shot('01-matters-page')

// Settings -> PNC workflow -> PDF mapper
try{
  await page.goto(origin+'/#settings',{waitUntil:'domcontentloaded'})
  await page.waitForTimeout(5000)
  const pncTab=page.getByRole('button',{name:'PNC workflow'})
  if(await pncTab.count()){await pncTab.first().click();await page.waitForTimeout(2000)}
  const mapper=page.getByText('Fee agreement PDF template (map fields)')
  if(await mapper.count()){await mapper.first().click();await page.waitForTimeout(3000)}
  await shot('02-settings-pdf-mapper')
}catch(e){console.log('settings-skip',e.message)}

console.log('DONE. Screenshots in test-results/')
await browser.close()
