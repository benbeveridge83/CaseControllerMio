// Synthetic fixtures only. External requests are intercepted; no real mail or filings.
import {chromium} from 'playwright-core'
import JSZip from 'jszip'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {newWithdrawal,applyWithdrawalEvent} from '../src/mioWithdrawalWorkflow.js'
const require=createRequire(import.meta.url),browser=await chromium.launch({headless:true})
fs.mkdirSync('test-results',{recursive:true})
const owner='00000000-0000-4000-8000-000000000279',email='workflow-test@example.invalid',now=new Date().toISOString()
const ago=days=>new Date(Date.now()-days*86400000).toISOString(),future=days=>new Date(Date.now()+days*86400000).toISOString()
const user={id:owner,email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:now}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),exp=Math.floor(Date.now()/1000)+3600
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,email,role:'authenticated',exp,aud:'authenticated'})}.test`,refresh_token:'test-only',expires_at:exp,expires_in:3600,token_type:'bearer',user}
const ids=['00000000-0000-4000-8000-000000000281','00000000-0000-4000-8000-000000000282','00000000-0000-4000-8000-000000000283']
const matters=ids.map((id,i)=>({id,name:['Alpha matter','Beta matter','Gamma matter'][i],case_type:i===0?'Divorce':'Modification',is_active:true,case_status:'Active',cause_number:`TEST-${i+1}`,created_at:ago(90),clients:{first_name:['Alpha','Beta','Gamma'][i],last_name:'Client',email:`client${i}@example.invalid`},courts:{court_name:'Synthetic court',county:'Synthetic'}}))
const a=newWithdrawal(ids[0],ago(15),ago(7)),b=newWithdrawal(ids[1],ago(30),ago(3)),c=newWithdrawal(ids[2],ago(4),ago(2))
b.steps.decision={...b.steps.decision,status:'waiting',attention_since:null,waiting_on:'Client response',due_at:future(5),last_outbound_at:ago(3)}
const workflows=new Map([a,b,c].map(state=>[state.matter_id,{owner_id:owner,matter_id:state.matter_id,state,revision:1}]))
const xml='<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{case_caption_text}}</w:t></w:r></w:p><w:p><w:r><w:t>{{attorney_signature_block}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
const zip=new JSZip();zip.file('word/document.xml',xml);zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
const encoded='data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,'+await zip.generateAsync({type:'base64'})
const profile={active_signature_block_id:'sig-test',default_case_style_id:'sapcr-test',case_styles:[{id:'divorce-test',name:'Test Divorce',kind:'divorce',requires_children:false,line_1:'IN THE MATTER OF THE MARRIAGE OF',line_2:'{{client_name}}',is_active:true},{id:'sapcr-test',name:'Test SAPCR',kind:'sapcr',line_1:'IN THE INTEREST OF',line_2:'{{client_name}}',is_active:true}],signature_blocks:[{id:'sig-test',name:'Test signature',attorney_name:'Test Attorney',firm_name:'Synthetic Firm',signature_text:'/s/ {{attorney_name}}\n{{firm_name}}',is_active:true}]}
const template={id:'template-test',name:'Synthetic Word template',status:'approved',engine:'docx_assembly',is_active:true,fields:[],bindings:[],files:[{id:'word-a',name:'Motion.docx',file_data:encoded,include_by_default:true},{id:'word-b',name:'Order.docx',file_data:encoded,include_by_default:true}]}
const states=new Map(Object.entries({caseMioDraftingProfile:profile,caseMioDraftingTemplates:[template],caseMioDraftingSessionV278:{matter_id:ids[0],template_id:template.id,selected_file_names:['word-a','word-b'],field_values:{}}}).map(([key,value])=>[key,{key,raw_value:JSON.stringify(value),json_value:value,updated_at:ago(1)}]))
const context=await browser.newContext({viewport:{width:1500,height:1000}}),page=await context.newPage(),errors=[],events=[]
page.on('pageerror',error=>errors.push(error.message))
await context.addInitScript({path:require.resolve('jszip/dist/jszip.min.js')})
await context.addInitScript(({session})=>{localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session));window.__appDiskWrites=[];const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(this===localStorage&&/^(caseMio|caseController)/.test(key)&&!/^caseMio(BackgroundLeaseV258:|SupabaseSessionV1$)/.test(key))window.__appDiskWrites.push(key);return original.call(this,key,value)}},{session})
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 if(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='4173'){if(url.pathname.startsWith('/api/'))return respond({connected:false,data:[]});return route.continue()}
 if(!url.hostname.endsWith('.supabase.co'))return respond({})
 if(url.pathname.includes('/auth/v1/'))return respond(url.pathname.endsWith('/user')?user:session)
 const table=url.pathname.split('/').pop(),single=req.headers().accept?.includes('vnd.pgrst.object')
 if(table==='mio_cloud_state_write_v277'){const p=req.postDataJSON(),old=states.get(p.p_key);if(old?.raw_value!==p.p_raw&&(!!old!==p.p_expected_exists||old&&old.updated_at!==p.p_expected_at))return respond({code:'40001',message:'Stale write'},409);const row={key:p.p_key,raw_value:p.p_raw,json_value:null,updated_at:new Date().toISOString()};states.set(p.p_key,row);return respond(row)}
 if(table==='case_mio_user_state'){let data=[...states.values()];const key=url.searchParams.get('key');if(key?.startsWith('eq.'))data=data.filter(r=>r.key===key.slice(3));return respond(single?data[0]||null:data)}
 if(table==='matters')return respond(single?matters[0]:matters)
 if(table==='mio_withdrawal_workflows'){let rows=[...workflows.values()];const id=url.searchParams.get('matter_id');if(id?.startsWith('eq.'))rows=rows.filter(r=>r.matter_id===id.slice(3));return respond(single?rows[0]||null:rows)}
 if(table==='mio_save_withdrawal_v1'){const p=req.postDataJSON(),old=workflows.get(p.p_matter_id);if((old?.revision||0)!==p.p_expected_revision)return respond({code:'40001',message:'Stale workflow'},409);const row={owner_id:owner,matter_id:p.p_matter_id,revision:(old?.revision||0)+1,state:p.p_state};workflows.set(p.p_matter_id,row);events.push({event_id:p.p_event_id,event:p.p_event,revision:row.revision,recorded_at:new Date().toISOString()});return respond(row)}
 if(table==='mio_withdrawal_events')return respond(events)
 if(table==='team_members'){const m={id:'test-member',email,first_name:'Synthetic',last_name:'Attorney',is_active:true,page_access:[]};return respond(single?m:[m])}
 return respond(single?null:[])
})
try{
 await page.goto('http://127.0.0.1:4173/#withdrawals',{waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Withdrawal dashboard',exact:true}).waitFor({timeout:60000})
 const names=()=>page.locator('.mio-wd-table tbody tr td:first-child strong').allTextContents()
 assert.deepEqual(await names(),['Alpha matter','Gamma matter','Beta matter'])
 await page.getByLabel(/^Sort/).selectOption('oldest');assert.deepEqual(await names(),['Beta matter','Alpha matter','Gamma matter'])
 await page.getByLabel(/^Sort/).selectOption('attention');await page.screenshot({path:'test-results/withdrawal-dashboard.png'})
 await page.locator('.mio-wd-table tbody tr').filter({hasText:'Alpha matter'}).getByRole('button',{name:'Review',exact:true}).click()
 await page.locator('.mio-wd-step').filter({hasText:'Approve withdrawal'}).getByRole('button',{name:'Record update / evidence'}).click()
 await page.getByLabel(/^Status/).selectOption('waiting');await page.getByLabel('Update / evidence explanation').fill('Synthetic waiting update');await page.getByLabel('Waiting on',{exact:true}).fill('Client');await page.getByLabel('Follow-up due').fill(dateInput(future(2)))
 await page.getByRole('button',{name:'Save to workflow',exact:true}).click();await page.locator('dialog[open]').waitFor({state:'hidden'})
 assert.equal(workflows.get(ids[0]).state.steps.decision.status,'waiting')
 const changed=workflows.get(ids[1]);changed.state=applyWithdrawalEvent(changed.state,{type:'email_received',step_id:'decision',message_id:'synthetic-reply',received_at:ago(.05),source_key:'synthetic-thread',source_version:'reply'},now);changed.revision++
 await page.getByRole('button',{name:'Refresh linked activity',exact:true}).click();await page.waitForTimeout(300);assert.match(await page.locator('.mio-wd-table tbody tr').filter({hasText:'Beta matter'}).innerText(),/NEEDS ME/)
 await page.reload();await page.getByRole('heading',{name:'Withdrawal dashboard',exact:true}).waitFor({timeout:60000});assert.match(await page.locator('.mio-wd-table tbody tr').filter({hasText:'Alpha matter'}).innerText(),/WAITING/)
 // A changed query forces a new document load; this app does not route on an arbitrary hash-only browser change.
 await page.goto('http://127.0.0.1:4173/?test-view=drafting#drafting',{waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Preview and customize this document',exact:true}).waitFor({timeout:60000})
 await page.getByRole('button',{name:'Signature block',exact:true}).click();await page.getByRole('dialog').waitFor();assert.match(await page.locator('.mio-component-paper').innerText(),/Test Attorney/)
 await page.getByLabel('Edit populated wording').fill('Custom Attorney - this motion only')
 await page.getByRole('button',{name:'Apply to this document',exact:true}).click()
 await page.getByLabel(/^File to customize/).selectOption('word-b')
 await page.getByRole('button',{name:'Signature block',exact:true}).click();assert.doesNotMatch(await page.locator('.mio-component-paper').innerText(),/Custom Attorney/);await page.getByRole('button',{name:'Close preview',exact:true}).click()
 await page.getByLabel(/^File to customize/).selectOption('word-a');await page.getByRole('button',{name:'Signature block (customized)',exact:true}).click();assert.match(await page.locator('.mio-component-paper').innerText(),/Custom Attorney/);await page.screenshot({path:'test-results/drafting-component-preview.png'});await page.getByRole('button',{name:'Close preview',exact:true}).click()
 await page.getByRole('button',{name:'Drafting settings',exact:true}).click();await page.getByRole('heading',{name:'Case type connections and reusable components',exact:true}).waitFor();await page.getByLabel(/^Modification/).selectOption('divorce-test');await page.getByRole('button',{name:'Save shared defaults',exact:true}).click();await page.getByText('Saved to Supabase',{exact:true}).first().waitFor();assert.equal(JSON.parse(states.get('caseMioDraftingProfile').raw_value).case_type_style_map.Modification,'divorce-test');await page.screenshot({path:'test-results/drafting-bottom-settings.png'})
 await page.waitForTimeout(800);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__appDiskWrites),[])
 console.log('PASS: dashboard attention and age sorts, waiting update, reply promotion, reload, per-file populated editable preview, shared settings and no app data written to browser storage')
}catch(error){await page.screenshot({path:'test-results/failure.png',fullPage:true});fs.writeFileSync('test-results/failure.txt',String(error)+'\n'+errors.join('\n')+'\n'+await page.locator('body').innerText());throw error}finally{await browser.close()}
function dateInput(v){const d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
