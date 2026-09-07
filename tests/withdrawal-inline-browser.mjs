// Synthetic fixtures only. No real mail, filings, accounts or case data.
import {chromium} from 'playwright-core'
import JSZip from 'jszip'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {newWithdrawal} from '../src/mioWithdrawalWorkspaceState.js'
import {chunkRows} from './cloud-chunk-fixture.js'
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
a.steps.decision={...a.steps.decision,status:'complete',evidence:{reference:'synthetic decision'},note:'Reviewed'};a.steps.drafting={...a.steps.drafting,status:'needs_action',attention_since:ago(7)}
const workflows=new Map([a,b,c].map(state=>[state.matter_id,{owner_id:owner,matter_id:state.matter_id,state,revision:1}]))
const xml='<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{case_caption_text}}</w:t></w:r></w:p><w:p><w:r><w:t>{{attorney_signature_block}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
const zip=new JSZip();zip.file('word/document.xml',xml);zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
const encoded='data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,'+await zip.generateAsync({type:'base64'})
const profile={withdrawal_templates:{motion:'template-test'},active_signature_block_id:'sig-test',default_case_style_id:'sapcr-test',case_styles:[{id:'divorce-test',name:'Test Divorce',kind:'divorce',requires_children:false,line_1:'IN THE MATTER OF THE MARRIAGE OF',line_2:'{{client_name}}',is_active:true},{id:'sapcr-test',name:'Test SAPCR',kind:'sapcr',line_1:'IN THE INTEREST OF',line_2:'{{client_name}}',is_active:true}],signature_blocks:[{id:'sig-test',name:'Test signature',attorney_name:'Test Attorney',firm_name:'Synthetic Firm',signature_text:'/s/ {{attorney_name}}\n{{firm_name}}',is_active:true}]}
const template={id:'template-test',name:'Synthetic Word template',status:'approved',engine:'docx_assembly',is_active:true,fields:[],bindings:[],files:[{id:'word-a',name:'Motion.docx',file_data:encoded,include_by_default:true},{id:'word-b',name:'Order.docx',file_data:encoded,include_by_default:true}]}
const docs=[{id:'pdf-a',matter_id:ids[0],file_name:'Alpha-reviewed-motion.pdf',file_type:'application/pdf',file_data_url:'data:application/pdf;base64,'+Buffer.from('%PDF-1.4\n% Synthetic test only').toString('base64')},{id:'pdf-b',matter_id:ids[1],file_name:'Beta-private-motion.pdf',file_type:'application/pdf'}]
const states=new Map(Object.entries({caseControllerDocuments:docs,caseMioBillingEntries:[{id:'prior-a',matter_id:ids[0],matter_step:'Withdrawal - Prepare and approve motion / order',date:now.slice(0,10),description:'Earlier withdrawal review',billing_time:.2,amount:60},{id:'prior-b',matter_id:ids[1],matter_step:'Withdrawal - Draft',description:'Other client private time',billing_time:.9,amount:270}],caseMioDraftingProfile:profile,caseMioDraftingTemplates:[template],caseMioDraftingSessionV278:{matter_id:ids[0],template_id:template.id,selected_file_names:['word-a','word-b'],field_values:{}}}).map(([key,value])=>[key,{key,raw_value:JSON.stringify(value),json_value:value,updated_at:ago(1)}]))
const context=await browser.newContext({viewport:{width:1600,height:1100}}),page=await context.newPage(),errors=[],events=[]
page.on('pageerror',error=>errors.push(error.message))
page.on('dialog',async dialog=>{if(dialog.type()==='beforeunload'||dialog.type()==='confirm')await dialog.accept();else await dialog.dismiss()})
await context.addInitScript({path:require.resolve('jszip/dist/jszip.min.js')})
await context.addInitScript(({session})=>{localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session));window.__appDiskWrites=[];const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(this===localStorage&&/^(caseMio|caseController)/.test(key)&&!/^caseMio(BackgroundLeaseV258:|SupabaseSessionV1$)/.test(key))window.__appDiskWrites.push(key);return original.call(this,key,value)}},{session})
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 if(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='4173'){if(url.pathname.startsWith('/api/'))return respond({connected:false,data:[]});return route.continue()}
 if(!url.hostname.endsWith('.supabase.co')){if(req.method()!=='GET')throw new Error('Unexpected external write: '+url.hostname+url.pathname);return respond({})}
 if(url.pathname.includes('/auth/v1/'))return respond(url.pathname.endsWith('/user')?user:session)
 const table=url.pathname.split('/').pop(),single=req.headers().accept?.includes('vnd.pgrst.object')
 if(table==='mio_cloud_state_read_chunks_v297')return respond(chunkRows([...states.values()].map(row=>({...row,user_id:owner})),req.postDataJSON()))
 if(table==='mio_cloud_state_write_v277'){const p=req.postDataJSON(),old=states.get(p.p_key);if(old?.raw_value!==p.p_raw&&(!!old!==p.p_expected_exists||old&&old.updated_at!==p.p_expected_at))return respond({code:'40001',message:'Stale write'},409);const row={key:p.p_key,raw_value:p.p_raw,json_value:null,updated_at:new Date().toISOString()};states.set(p.p_key,row);return respond(row)}
 if(table==='case_mio_user_state'){let data=[...states.values()];const key=url.searchParams.get('key');if(key?.startsWith('eq.'))data=data.filter(r=>r.key===key.slice(3));return respond(single?data[0]||null:data)}
 if(table==='documents')return respond(single?null:docs)
 if(table==='billing_entries'&&req.method()==='POST')return respond(single?req.postDataJSON():[req.postDataJSON()])
 if(table==='matters')return respond(single?matters[0]:matters)
 if(table==='mio_withdrawal_workflows'){let rows=[...workflows.values()];const id=url.searchParams.get('matter_id');if(id?.startsWith('eq.'))rows=rows.filter(r=>r.matter_id===id.slice(3));return respond(single?rows[0]||null:rows)}
 if(table==='mio_save_withdrawal_v1'){const p=req.postDataJSON(),old=workflows.get(p.p_matter_id);if((old?.revision||0)!==p.p_expected_revision)return respond({code:'40001',message:'Stale workflow'},409);const row={owner_id:owner,matter_id:p.p_matter_id,revision:(old?.revision||0)+1,state:p.p_state};workflows.set(p.p_matter_id,row);events.push({event_id:p.p_event_id,event:p.p_event,revision:row.revision,recorded_at:new Date().toISOString()});return respond(row)}
 if(table==='mio_withdrawal_events')return respond(events)
 if(table==='team_members'){const m={id:'test-member',email,first_name:'Synthetic',last_name:'Attorney',is_active:true,page_access:[]};return respond(single?m:[m])}
 return respond(single?null:[])
})
const settle=async fn=>{for(let i=0;i<100;i++){if(fn())return;await page.waitForTimeout(100)}assert.ok(fn(),'State did not settle')}
try{
 await page.goto('http://127.0.0.1:4173/#withdrawals',{waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Withdrawal dashboard',exact:true}).waitFor({timeout:60000})
 assert.match(await page.locator('body').innerText(),/Mio V304/)
 await page.getByLabel('Case type',{exact:true}).selectOption('Divorce')
 await page.getByLabel('Specific matter',{exact:true}).selectOption(ids[0])
 await page.getByRole('button',{name:'Hide graph',exact:true}).click()
 const alpha=()=>page.locator('tr.mio-wd-summary').filter({hasText:'Alpha matter'})
 await alpha().getByRole('button',{name:'Review',exact:true}).click()
 assert.equal(await alpha().evaluate(el=>el.nextElementSibling?.className),'mio-wd-expanded')
 const detail=()=>page.locator('.mio-wd-expanded'),draft=()=>detail().locator('.mio-wd-step').filter({hasText:'Prepare and approve motion / order'})
 assert.equal(await detail().count(),1)
 assert.equal(await detail().getByRole('button',{name:'Mark complete',exact:true}).isDisabled(),true)
 await draft().getByRole('button',{name:'Add note',exact:true}).click()
 await page.getByLabel('Step note',{exact:true}).fill('Synthetic inline note - no progress change')
 await page.getByRole('button',{name:'Save note',exact:true}).click()
 await page.locator('dialog[open]').waitFor({state:'hidden'})
 assert.equal(workflows.get(ids[0]).state.steps.drafting.status,'needs_action')
 assert.equal(workflows.get(ids[0]).state.workspace_notes[0].note,'Synthetic inline note - no progress change')
 await detail().getByRole('button',{name:'Pause',exact:true}).click()
 await detail().getByRole('button',{name:'Resume',exact:true}).waitFor()
 assert.equal(workflows.get(ids[0]).state.paused,true)
 assert.equal(await draft().getByRole('button',{name:'Yes, draft using this template',exact:true}).isDisabled(),true)
 await page.reload({waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Withdrawal dashboard',exact:true}).waitFor({timeout:60000})
 assert.match(await alpha().innerText(),/PAUSED/)
 await page.getByRole('button',{name:'Hide graph',exact:true}).click()
 await alpha().getByRole('button',{name:'Review',exact:true}).click()
 await detail().getByRole('button',{name:'Resume',exact:true}).click()
 await detail().getByRole('button',{name:'Pause',exact:true}).waitFor()
 await draft().getByLabel('Connected drafting template',{exact:true}).selectOption('template-test')
 await settle(()=>workflows.get(ids[0]).state.steps.drafting.template_id==='template-test')
 await draft().getByLabel('Saved documents to review (select one or more)',{exact:true}).selectOption('pdf-a')
 assert.doesNotMatch(await draft().getByLabel('Saved documents to review (select one or more)',{exact:true}).innerText(),/Beta-private/)
 await detail().getByText('All withdrawal time entries (1)',{exact:true}).click()
 assert.match(await detail().locator('.mio-wd-time').innerText(),/Earlier withdrawal review/)
 assert.doesNotMatch(await detail().locator('.mio-wd-time').innerText(),/Other client private time/)
 await draft().getByRole('button',{name:'Add time',exact:true}).click()
 await page.getByRole('heading',{name:'Add Billing Entry',exact:true}).waitFor()
 await page.getByPlaceholder('Examples: .1, 6m, 66 min, 1h 6 min, 1.1').fill('.3')
 await page.getByRole('button',{name:'Save Time Entry',exact:true}).click()
 await detail().getByText('All withdrawal time entries (2)',{exact:true}).waitFor()
 await draft().getByRole('button',{name:'Yes, draft using this template',exact:true}).click()
 await page.getByRole('button',{name:'Return to withdrawal row',exact:true}).waitFor({timeout:60000})
 await page.getByRole('heading',{name:'Generated editable Word documents',exact:true}).waitFor({timeout:60000})
 assert.equal(workflows.get(ids[0]).state.steps.drafting.status,'needs_action')
 await page.getByRole('button',{name:'Return to withdrawal row',exact:true}).click()
 await detail().waitFor()
 assert.equal(await alpha().getByRole('button',{name:'Collapse',exact:true}).count(),1)
 await draft().getByRole('button',{name:'Motion / order reviewed and approved',exact:true}).click()
 await page.getByLabel('I reviewed the actual evidence and confirm completion.',{exact:true}).check()
 await page.locator('dialog[open]').getByRole('button',{name:'Motion / order reviewed and approved',exact:true}).click()
 await page.locator('dialog[open]').waitFor({state:'hidden'})
 assert.equal(workflows.get(ids[0]).state.steps.filing.status,'needs_action')
 const filing=()=>detail().locator('.mio-wd-step').filter({hasText:'File motion and verify acceptance'})
 assert.equal(await filing().getByRole('button',{name:'Prepare e-filing for review',exact:true}).isDisabled(),true)
 await filing().getByLabel('Reviewed PDF for e-filing',{exact:true}).selectOption('pdf-a')
 assert.doesNotMatch(await filing().getByLabel('Reviewed PDF for e-filing',{exact:true}).innerText(),/Beta-private/)
 await page.screenshot({path:'test-results/withdrawal-inline.png',fullPage:true})
 await filing().getByRole('button',{name:'Prepare e-filing for review',exact:true}).click()
 await page.getByText('Reviewed PDF connected from Withdrawal.',{exact:false}).waitFor({timeout:15000})
 assert.match(await page.locator('body').innerText(),/Alpha-reviewed-motion.pdf/)
 assert.equal(workflows.get(ids[0]).state.steps.filing.status,'needs_action')
 assert.equal(events.some(e=>e.event.type==='efile_update'),false)
 await page.waitForTimeout(500)
 assert.deepEqual(errors,[])
 assert.deepEqual(await page.evaluate(()=>window.__appDiskWrites),[])
 console.log('PASS inline expansion; separate controls; pause/resume and note persistence; same-matter documents/time; connected template generation; explicit approval; PDF eFile handoff without submission; no case-data browser storage')
}catch(error){await page.screenshot({path:'test-results/failure.png',fullPage:true});fs.writeFileSync('test-results/failure.txt',String(error)+'\n'+errors.join('\n')+'\n'+await page.locator('body').innerText());throw error}finally{await browser.close()}
