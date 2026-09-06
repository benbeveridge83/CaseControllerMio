// Complete built application, synthetic cloud only. Never contacts live services.
import {chromium} from 'playwright-core'
import JSZip from 'jszip'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {chunkRows} from './cloud-chunk-fixture.js'
const require=createRequire(import.meta.url),browser=await chromium.launch({headless:true,...(process.env.MIO_CHROMIUM_PATH ? {executablePath:process.env.MIO_CHROMIUM_PATH} : {})})
fs.mkdirSync('test-results',{recursive:true})
const owner='00000000-0000-4000-8000-000000000300',email='template-test@example.invalid',now=new Date().toISOString()
const user={id:owner,email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:now}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),exp=Math.floor(Date.now()/1000)+3600
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,email,role:'authenticated',exp,aud:'authenticated'})}.test`,refresh_token:'test-only',expires_at:exp,expires_in:3600,token_type:'bearer',user}
const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',address='101 Sample Street, Test City, TX 00000'
const p=t=>`<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`
const xml=`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${ns}"><w:body><w:p><w:r><w:t>NOTICE: THIS DOCUMENT</w:t><w:br/><w:t>CONTAINS SENSITIVE DATA.</w:t></w:r></w:p>${p('CAUSE NO. OLD-001')}${p('[[MIO_BLOCK:caption]]')}${p('MOTION FOR WITHDRAWAL OF ATTORNEY')}<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Mailing address: 101 Sample </w:t></w:r><w:r><w:t>Street, Test City, TX 00000</w:t></w:r></w:p>${p('Alex asked Alex to call.')}${p('Phone: 555-0100; email: old@example.invalid')}${p('[[MIO_BLOCK:signature]]')}<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6360"/></w:tblGrid><w:tr><w:tc>${p('Date')}</w:tc><w:tc>${p('Setting / Deadline')}</w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
const zip=new JSZip();zip.file('word/document.xml',xml)
zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
zip.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')
const encoded='data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,'+await zip.generateAsync({type:'base64',compression:'DEFLATE'})
const cause={id:'cause-binding',kind:'field',file_id:'word-a',label:'Cause number',field_key:'cause_number',data_source:'matter.cause_number',paragraph_start:1,paragraph_end:1,start_offset:10,end_offset:17,source_text:'OLD-001',is_active:true}
const template={id:'template-safe',name:'Synthetic withdrawal',status:'approved',engine:'docx_assembly',is_active:true,fields:[{id:'cause-field',label:'Cause number',key:'cause_number',source:'matter.cause_number',type:'text'}],bindings:[cause],files:[{id:'word-a',name:'Motion.docx',file_data:encoded,include_by_default:true},{id:'word-b',name:'Other.docx',file_data:encoded,include_by_default:false}]}
const profile={active_signature_block_id:'sig-test',default_case_style_id:'@divorce',case_styles:[],signature_blocks:[{id:'sig-test',name:'Synthetic signature',attorney_name:'Test Attorney',firm_name:'Test Firm',signature_text:'/s/ {{attorney_name}}\n{{firm_name}}',is_active:true}]}
const matterId='00000000-0000-4000-8000-000000000301'
const matter={id:matterId,name:'Synthetic matter',case_type:'Divorce',is_active:true,case_status:'Active',cause_number:'NEW-001',created_at:now,clients:{first_name:'Replacement',last_name:'Client',email:'new@example.invalid'},courts:{court_name:'300th Judicial District Court',county:'Brazoria'}}
const states=new Map(Object.entries({caseMioDraftingProfile:profile,caseMioDraftingTemplates:[template]}).map(([key,value])=>[key,{key,raw_value:JSON.stringify(value),updated_at:now}]))
const failures={writes:false},errors=[],dialogs=[]
let page,context
async function open(hash='settings'){
 context=await browser.newContext({viewport:{width:1720,height:1100}});page=await context.newPage();page.setDefaultTimeout(15000)
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss()})
 await context.addInitScript({path:require.resolve('jszip/dist/jszip.min.js')})
 await context.addInitScript(({session})=>{
  localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session));window.__appDiskWrites=[];window.__docxResults=[]
  const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===localStorage&&/^(caseMio|caseController)/.test(k)&&!/^caseMio(BackgroundLeaseV258:|SupabaseSessionV1$)/.test(k))window.__appDiskWrites.push(k);return set.call(this,k,v)}
  const read=FileReader.prototype.readAsDataURL;FileReader.prototype.readAsDataURL=function(blob){if(blob.type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document')blob.arrayBuffer().then(buffer=>{let str='';new Uint8Array(buffer).forEach(byte=>str+=String.fromCharCode(byte));window.__docxResults.push(btoa(str))});return read.call(this,blob)}
 },{session})
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  if(['localhost','127.0.0.1'].includes(url.hostname))return url.pathname.startsWith('/api/')?respond({connected:false,data:[]}):route.continue()
  if(!url.hostname.endsWith('.supabase.co'))return respond({})
  if(url.pathname.includes('/auth/v1/'))return respond(url.pathname.endsWith('/user')?user:session)
  const table=url.pathname.split('/').pop(),single=req.headers().accept?.includes('vnd.pgrst.object')
  if(table==='mio_cloud_state_read_chunks_v297')return respond(chunkRows([...states.values()].map(r=>({...r,user_id:owner})),req.postDataJSON()))
  if(table==='mio_cloud_state_write_v277'){
   const a=req.postDataJSON(),old=states.get(a.p_key)
   if(failures.writes&&a.p_key==='caseMioDraftingTemplates')return respond({message:'Synthetic save unavailable'},503)
   if(old?.raw_value!==a.p_raw&&(!!old!==a.p_expected_exists||old&&old.updated_at!==a.p_expected_at))return respond({code:'PT409',message:'Synthetic stale write'},409)
   const row={key:a.p_key,raw_value:a.p_raw,updated_at:new Date().toISOString()};states.set(a.p_key,row);return respond(row)
  }
  if(table==='case_mio_user_state'){
   let data=[...states.values()].sort((a,b)=>a.key.localeCompare(b.key));const k=url.searchParams.get('key');if(k?.startsWith('eq.'))data=data.filter(r=>r.key===k.slice(3));if(k?.startsWith('neq.'))data=data.filter(r=>r.key!==k.slice(4));data=data.slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||1000));const fields=(url.searchParams.get('select')||'*').split(',');if(!fields.includes('*'))data=data.map(r=>Object.fromEntries(fields.map(f=>[f,r[f]])));return respond(single?data[0]||null:data)
  }
  if(table==='matters')return respond(single?matter:[matter])
  if(table==='team_members'){const m={id:'test-member',email,first_name:'Synthetic',last_name:'Attorney',is_active:true,page_access:[]};return respond(single?m:[m])}
  return respond(single?null:[])
 })
 await page.goto('http://127.0.0.1:4173/?safe-test='+Date.now()+'#'+hash,{waitUntil:'domcontentloaded'})
 await page.getByRole('button',{name:'Mio state: saved to Supabase',exact:true}).waitFor({timeout:60000})
}
async function builder(){
 await page.getByRole('button',{name:'Mio state: saved to Supabase',exact:true}).waitFor({timeout:60000})
 if(!await page.getByRole('heading',{name:'Mio Drafting Studio',exact:true}).count()){
  const drafting=page.getByRole('button',{name:/Drafting/,exact:false});if(!await drafting.count())throw new Error('Drafting navigation not found: '+(await page.getByRole('button').allTextContents()).join('|'));await drafting.first().click()
 }
 await page.getByRole('heading',{name:'Mio Drafting Studio',exact:true}).waitFor()
 await page.getByRole('button',{name:/Visual Template Builder/i}).click()
 const select=page.locator('select').filter({has:page.locator('option[value="template-safe"]')}).first()
 await select.selectOption('template-safe')
 await page.locator('[data-mio-block="caption"]').waitFor()
}
async function highlight(index,needle,occurrence=0){
 await page.locator('#drafting-paragraph-'+index).scrollIntoViewIfNeeded()
 await page.evaluate(({index,needle,occurrence})=>{
  const p=document.getElementById('drafting-paragraph-'+index),spans=Array.from(p.querySelectorAll('[data-mio-source-start]:not([data-mio-field-id])'));let count=0
  for(const span of spans){let at=span.textContent.indexOf(needle);while(at>=0){if(count++===occurrence){const r=document.createRange();r.setStart(span.firstChild,at);r.setEnd(span.firstChild,at+needle.length);const s=getSelection();s.removeAllRanges();s.addRange(r);span.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return}at=span.textContent.indexOf(needle,at+needle.length)}}throw new Error('Source text not found: '+needle)
 },{index,needle,occurrence})
 await page.getByRole('heading',{name:'Choose auto-fill source',exact:true}).waitFor()
}
async function pick(label,category='Parties & children'){
 await page.getByRole('button',{name:category,exact:false}).click()
 await page.getByRole('button',{name:label}).click()
 await page.getByRole('heading',{name:'Choose auto-fill source',exact:true}).waitFor({state:'hidden'})
}
const savedTemplate=()=>JSON.parse(states.get('caseMioDraftingTemplates').raw_value).find(t=>t.id==='template-safe')
const ack=()=>page.getByLabel('Template save status').filter({hasText:'Template saved to Supabase'}).waitFor({timeout:45000})
try{
 await open();await builder()
 assert.deepEqual(errors,[])
 assert.match(await page.locator('#drafting-paragraph-1').innerText(),/Cause number/)
 assert.doesNotMatch(await page.locator('#drafting-paragraph-1').innerText(),/OLD-001/)
 const caption=page.getByRole('table',{name:'Caption fields'});assert.equal(await caption.locator('td').count(),3);assert.match(await caption.innerText(),/Court name/);assert.match(await caption.locator('td').nth(1).innerText(),/\u00a7/)
 await caption.screenshot({path:'test-results/caption-preview.png'})
 await page.getByRole('button',{name:'Field Selector',exact:true}).click()
 await highlight(4,address);await pick(/Client.*mailing address/);await ack()
 assert.equal(savedTemplate().bindings.find(b=>b.field_key==='client_address_inline').source_text,address)
 assert.equal(savedTemplate().fields.find(f=>f.key==='client_address_inline').source,'matter.client_address')
 assert.doesNotMatch(await page.locator('#drafting-paragraph-4').innerText(),/101 Sample/)
 await page.getByRole('button',{name:/Template Library/i}).click();await builder()
 assert.match(await page.locator('#drafting-paragraph-4').innerText(),/mailing address/);assert.doesNotMatch(await page.locator('#drafting-paragraph-4').innerText(),/101 Sample/)
 await page.reload();await builder();assert.doesNotMatch(await page.locator('#drafting-paragraph-4').innerText(),/101 Sample/)
 const fileSelect=page.locator('select').filter({has:page.locator('option[value="word-b"]')}).first();await fileSelect.selectOption('word-b');await page.locator('#drafting-paragraph-4').filter({hasText:'101 Sample'}).waitFor();await fileSelect.selectOption('word-a');await page.locator('#drafting-paragraph-4').filter({hasText:'mailing address'}).waitFor()
 if(await page.getByRole('button',{name:'Field Selector',exact:true}).count())await page.getByRole('button',{name:'Field Selector',exact:true}).click()
 await highlight(5,'Alex',1);await pick(/Client.*full name/);await ack()
 assert.equal(savedTemplate().bindings.find(b=>b.field_key==='client_name').start_offset,11)
 await highlight(5,'Alex',0);await pick(/Client.*full name/);await ack()
 assert.equal(savedTemplate().bindings.filter(b=>b.field_key==='client_name').length,2)
 await highlight(6,'555-0100');await pick(/Client.*phone/);await ack()
 failures.writes=true
 await highlight(6,'old@example.invalid');await pick(/Client.*email/)
 await page.getByLabel('Template save status').filter({hasText:'Not saved:'}).waitFor({timeout:45000})
 assert.doesNotMatch(await page.locator('#drafting-paragraph-6').innerText(),/old@example.invalid/)
 failures.writes=false;await page.getByRole('button',{name:'Retry template save',exact:true}).click();await ack()
 assert.equal(savedTemplate().files[0].file_data,encoded)
 assert.deepEqual(await page.evaluate(()=>window.__appDiskWrites),[])
 await page.screenshot({path:'test-results/template-field-builder.png',fullPage:true})
 await context.close()
 const values={cause_number:'NEW-001',client_address_inline:'202 Replacement Avenue',client_name:'Replacement Client',client_phone:'555-0200',client_email:'new@example.invalid',petitioner_name:'Petitioner Test',respondent_name:'Respondent Test',children_names:'Child Alpha; Child Beta',court_name:'300th Judicial District Court',county:'Brazoria',case_style_id:'@divorce',attorney_signature_block:'/s/ Test Attorney\nTest Firm'}
 states.set('caseMioDraftingSessionV278',{key:'caseMioDraftingSessionV278',raw_value:JSON.stringify({matter_id:matterId,template_id:'template-safe',selected_file_names:['word-a'],field_values:values}),updated_at:new Date().toISOString()})
 await open('drafting')
 await page.getByRole('heading',{name:'Preview and customize this document',exact:true}).waitFor({timeout:30000})
 await page.evaluate(()=>{window.__docxResults=[]})
 const generate=page.getByRole('button',{name:/^Generate/}).first();await generate.waitFor();await generate.click()
 await page.waitForFunction(()=>window.__docxResults?.length>0,undefined,{timeout:45000})
 const result=Buffer.from(await page.evaluate(()=>window.__docxResults.at(-1)),'base64'),output=await JSZip.loadAsync(result),generated=await output.file('word/document.xml').async('string')
 const check=await page.evaluate(({xml,ns})=>{const d=new DOMParser().parseFromString(xml,'application/xml'),tables=[...d.getElementsByTagNameNS(ns,'tbl')];return {invalid:d.getElementsByTagName('parsererror').length,tables:tables.map(t=>[...t.getElementsByTagNameNS(ns,'tc')].map(c=>c.textContent)),text:[...d.getElementsByTagNameNS(ns,'t')].map(t=>t.textContent).join(' '),notices:[...d.getElementsByTagNameNS(ns,'p')].filter(p=>p.textContent.replace(/\s/g,'').includes('NOTICE:THISDOCUMENTCONTAINSSENSITIVEDATA')).length}},{xml:generated,ns})
 assert.equal(check.invalid,0);assert.equal(check.tables[0].length,3);assert.match(check.tables[0][1],/\u00a7/);assert.match(check.tables[0][2],/300TH JUDICIAL DISTRICT/);assert.match(check.tables[0][2],/BRAZORIA COUNTY, TEXAS/);assert.equal(check.notices,1)
 assert.match(check.text,/202 Replacement Avenue/);assert.doesNotMatch(check.text,/101 Sample|OLD-001|old@example.invalid|\[\[MIO_BLOCK:/)
 assert.match(generated,/w:val="both"/);assert.equal(check.tables.at(-1).length,2)
 fs.writeFileSync('test-results/mio-synthetic-generated.docx',result);fs.writeFileSync('test-results/mio-synthetic-generated.xml',generated)
 assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);assert.deepEqual(await page.evaluate(()=>window.__appDiskWrites),[])
 console.log('PASS: built-app startup, saved field labels, automatic field selector, exact repeated occurrence, second field after a chip, reopen/reload persistence, file scoping, failed-save recovery, no app disk writes, actual generated DOCX caption/table/notice/field values')
}catch(e){console.log('BROWSER_FAILURE',String(e),'ERRORS',errors,'DIALOGS',dialogs);if(page){console.log((await page.locator('body').innerText()).slice(0,18000));await page.screenshot({path:'test-results/template-safe-failure.png',fullPage:true})}throw e}finally{await browser.close()}
