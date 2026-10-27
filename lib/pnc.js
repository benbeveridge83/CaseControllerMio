import {PUBLIC_SUPABASE_URL,PUBLIC_SUPABASE_KEY} from '../src/mioSupabasePublic.js'
import {createClient} from '@supabase/supabase-js'
import {randomBytes,randomUUID,createHash} from 'node:crypto'
import {paymentEvidence,signatureEvidence,readyToClient,PNC_STATUS,CONSULT_STATUS,CLIENT_STATUS,emailOK,emailHistory,templateText} from '../src/mioPncModel.js'
const clean=v=>String(v||'').trim(),stamp=()=>new Date().toISOString()
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})}
const unwrap=async q=>{const {data,error}=await q;if(error)throw error;return data}
function config(){const e=process.env;return {url:e.SUPABASE_URL||e.VITE_SUPABASE_URL||e.NEXT_PUBLIC_SUPABASE_URL||PUBLIC_SUPABASE_URL,key:e.SUPABASE_PUBLISHABLE_KEY||e.SUPABASE_ANON_KEY||e.VITE_SUPABASE_ANON_KEY||e.NEXT_PUBLIC_SUPABASE_ANON_KEY||PUBLIC_SUPABASE_KEY}}
function database(authorization=''){const {url,key}=config();if(!url||!key)fail('Server Supabase configuration is missing.',503);return createClient(url,key,{global:{headers:authorization?{Authorization:authorization}:{}},auth:{persistSession:false,autoRefreshToken:false}})}
async function identity(req){const authorization=clean(req.headers?.authorization);if(!/^Bearer\s+\S+/i.test(authorization))fail('Sign in to Mio.',401);const db=database(authorization),{data,error}=await db.auth.getUser(authorization.replace(/^Bearer\s+/i,''));if(error||!data?.user?.id)fail('Your Mio session could not be verified.',401);if(!data.user.email_confirmed_at)fail('Use a verified firm account.',403);const email=clean(data.user.email).toLowerCase(),allowed=clean(process.env.MIO_PNC_ALLOWED_EMAILS).toLowerCase().split(',').map(x=>x.trim());if(!email.endsWith('@beveridgelawfirm.com')&&!allowed.includes(email))fail('This account is not authorized for firm PNC workflows.',403);return {db,user:data.user}}
function readBody(req){if(req.body&&typeof req.body==='object')return req.body;try{return JSON.parse(req.body||'{}')}catch{fail('Invalid JSON request.')}}
async function boldsign(path,{method='GET',body,form}={}){const key=clean(process.env.boldsignapi);if(!key)fail('BoldSign is not configured: add boldsignapi to Vercel.',503);const headers={'X-API-KEY':key};if(body)headers['Content-Type']='application/json';const r=await fetch('https://api.boldsign.com'+path,{method,headers,body:form?form:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});const p=await r.json().catch(()=>({}));if(!r.ok){let dump='';if(form){try{dump=Array.from(form.entries()).filter(([k])=>k!=='Files').map(([k,v])=>k+'='+String(v).slice(0,80)).join(' | ')}catch{}}fail((p.error?.message||p.title||'BoldSign request failed')+(p.errors?': '+JSON.stringify(p.errors):'')+(dump?' [sent: '+dump+']':'')+(' ('+r.status+').'),502)}return p}
const payloadColumns='matter_id,user_id,client_id,creation_key,config,state,revision,created_at,updated_at'
async function owned(db,user,matterId){if(!/^[a-f0-9-]{36}$/i.test(clean(matterId)))fail('Select a PNC matter.');const w=await unwrap(db.from('mio_pnc_workflows').select(payloadColumns).eq('user_id',user.id).eq('matter_id',matterId).single());const m=await unwrap(db.from('matters').select('*,clients(*)').eq('id',matterId).single());if(!m||m.client_id!==w.client_id)fail('PNC client association changed. Review the matter.',409);return {w,m}}
async function patch(db,w,change){const v=await unwrap(db.from('mio_pnc_workflows').update({...change,revision:w.revision+1,updated_at:stamp()}).eq('matter_id',w.matter_id).eq('user_id',w.user_id).eq('revision',w.revision).select(payloadColumns).maybeSingle());if(!v)fail('This PNC changed in another window. Reload before retrying.',409);return v}
function amount(value){const n=Math.round(Number(value)*100);if(!Number.isSafeInteger(n)||n<100||n>100000000)fail('Enter an amount between $1 and $1,000,000.');return n}
async function payment(db,user,m,purpose,dollars,canCreate=true){
 const account=purpose==='consult'?'operating':'trust',n=amount(dollars),invoice='PNC-'+purpose+'-'+m.id+'-'+n
 const existing=await unwrap(db.from('lawpay_payment_requests').select('*').eq('created_by',user.id).eq('invoice_number',invoice).eq('account_key',account).order('created_at',{ascending:false}).limit(1).maybeSingle());if(existing)return normalizeLink(existing,m.clients?.email)
 if(!canCreate)fail('A previous payment-link preparation is still pending. Reopen and retry after checking LawPay requests.',409)
 const settings=await unwrap(db.from('lawpay_settings').select('operating_page_url,trust_page_url').eq('id',1).single()),page=settings[account+'_page_url'];if(!page)fail('Save the LawPay '+account+' payment page in Settings first.',409)
 const {data,error}=await db.functions.invoke('lawpay-gateway',{body:{action:'create_link',account_key:account,payment_page_url:page,amount_cents:n,reference:invoice,invoice_number:invoice,payer_name:[m.clients?.first_name,m.clients?.last_name].filter(Boolean).join(' '),payer_email:m.clients?.email,payer_phone:m.clients?.phone||'',matter_id:m.id,matter_name:m.name,client_id:m.client_id,client_name:[m.clients?.first_name,m.clients?.last_name].filter(Boolean).join(' '),lock_amount:true,lock_reference:true}})
 if(error||!data?.url)fail(data?.error||error?.message||'LawPay did not create a payment link.',502)
 const request=await unwrap(db.from('lawpay_payment_requests').select('*').eq('created_by',user.id).eq('invoice_number',invoice).eq('account_key',account).order('created_at',{ascending:false}).limit(1).single());if(Number(request.amount_cents)!==n)fail('LawPay request amount did not match. Do not send this request.',409)
 return normalizeLink(request,m.clients?.email)
}
function normalizeLink(r,email){const u=new URL(r.payment_url);if(email&&u.searchParams.has('email'))u.searchParams.set('email',email);u.searchParams.set('amount',(Number(r.amount_cents)/100).toFixed(2));u.searchParams.set('lockAmount','true');u.searchParams.set('lock_amount','true');return {...r,payment_url:u.toString()}}
async function requestFor(db,w,key){const id=w.state?.[key]?.id;if(!id)return null;return unwrap(db.from('lawpay_payment_requests').select('*').eq('id',id).eq('created_by',w.user_id).eq('matter_id',String(w.matter_id)).maybeSingle())}
async function verify(db,w,{signature=true,transactions=null}={}){
 const state={...w.state},warnings=[]
 for(const kind of ['consult','retainer']){const r=await requestFor(db,w,kind+'_request');if(!r){state[kind]={status:'not_paid',paid_cents:0,processing_cents:0,required_cents:0};continue}
  if(r.account_key!==(kind==='consult'?'operating':'trust')||Number(r.amount_cents)!==amount(w.config[kind==='consult'?'consult_fee':'retainer'])){state[kind]={status:'needs_review'};continue}
  // Exact immutable reference/request mapping, not payer-name or matter-only matching.
  const tx=transactions||await unwrap(db.from('lawpay_transactions').select('*').in('account_key',r.account_key==='trust'?['trust','echeck_trust','clientcredit_trust']:['operating','echeck_operating']).or('reference.eq.'+r.reference+',gateway_transaction_id.eq.'+(r.gateway_transaction_id||'__none__')+',raw->>mio_payment_request_id.eq.'+r.id).limit(1000))
  state[kind]=paymentEvidence(tx,r)
 }
 if(state.intake?.id){const i=await unwrap(db.from('mio_client_intake_requests').select('id,status,submitted_at,expires_at').eq('user_id',w.user_id).eq('id',state.intake.id).maybeSingle());if(i)state.intake={...state.intake,...i}}
 if(!state.signature?.id)state.signature={status:'not_sent'}
 if(signature&&state.signature?.id){try{const p=await boldsign('/v1/document/properties?documentId='+encodeURIComponent(state.signature.id));state.signature=signatureEvidence(p)}catch(e){state.signature={...state.signature,status:'unverified'};warnings.push(e.message)}}
 state.checked_at=stamp();state.warnings=warnings
 return {state,warnings}
}
async function syncPayments(db,w){const {data,error}=await db.functions.invoke('pnc-payment-status',{body:{matter_id:w.matter_id}});if(error||!data?.ok)fail('LawPay verification failed. '+(data?.error||error?.message||''),502);return data.transactions||[]}
async function saveEvergreenMinimum(db,w,m,value){
  if(value==null||value==='')return
  const cents=Math.round(Number(value)*100)
  if(!Number.isSafeInteger(cents)||cents<0)return
  const dollars=Number((cents/100).toFixed(2))
  // Persist the edited evergreen minimum to the matter finance field that
  // clientFinanceNumbers() reads in src/App.jsx, so the fee agreement and the
  // finance system do not drift apart. Non-fatal by design.
  const key='caseMioClioMinimumBalancesByMatterId',{data:row,error:readError}=await db.from('case_mio_user_state').select('raw_value,updated_at').eq('user_id',w.user_id).eq('key',key).maybeSingle();if(readError){console.warn('Could not read the evergreen minimum-balance store:',readError.message);return}let map={};try{map=row?.raw_value?JSON.parse(row.raw_value):{}}catch{map={}}if(!map||typeof map!=='object'||Array.isArray(map))map={};map[String(m.id)]=dollars;const {error:writeError}=await db.rpc('mio_cloud_state_write_v277',{p_user_id:w.user_id,p_key:key,p_raw:JSON.stringify(map),p_expected_at:row?.updated_at||null,p_expected_exists:!!row,p_delete:false,p_origin:'pnc-fee-agreement'});if(writeError)console.warn('Could not persist the evergreen minimum balance:',writeError.message)

}
async function signWithPdf(db,w,m,clientName,clientEmail,agreementDate){
  const fmt=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v||0))
  const values={client_name:clientName,client_email:clientEmail,first_name:m.clients?.first_name,last_name:m.clients?.last_name,date:agreementDate||new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago'}).format(new Date()),retainer:fmt(w.config.retainer),retainer_amount:fmt(w.config.retainer),hourly_rate:fmt(w.config.hourly_rate),evergreen_minimum_balance:fmt(w.config.evergreen_minimum_balance),matter_name:m.name,case_type:m.matter_type}
  try{const cv=JSON.parse(w.config.agreement_custom_fields||'{}');for(const k of Object.keys(cv||{}))values[k]=String(cv[k]??'')}catch{}
  let fields=[];try{fields=JSON.parse(w.config.signature_pdf_fields||'[]')}catch{fail('Fee-agreement PDF field map must be a JSON array.')}
  if(!Array.isArray(fields))fail('Fee-agreement PDF field map must be a JSON array.')
  const path=clean(w.config.signature_pdf_path);if(!path)fail('Upload the fee agreement PDF in PNC Settings first.');const {data:pdf,error:dlError}=await db.storage.from('fee-agreement-templates').download(path);if(dlError||!pdf)fail('Could not load the fee agreement PDF from storage: '+(dlError?.message||'missing file'),502)
  const formFields=fields.map(f=>{const sem=clean(f.semantic||f.name),isSig=clean(f.type)==='signature'||sem==='client_signature';return {id:f.api_id||f.id||sem,fieldType:isSig?'Signature':'TextBox',pageNumber:Number(f.page||0)+1,x:Number(f.x||0),y:Number(f.y||0),width:Number(f.width||100),height:Number(f.height||20),isRequired:f.required===true,value:isSig?undefined:String(values[sem]??'')}}).filter(f=>f.id)
  const cc=String(w.config.signature_cc||'office@beveridgelawfirm.com,ben@beveridgelawfirm.com').split(',').map(clean).filter(emailOK)
  const form=new FormData()
  form.set('Title',templateText(clean(w.config.signature_email_subject)||'Fee agreement - Beveridge Law Firm',values))
  form.set('Message',templateText(clean(w.config.signature_email_message)||'Please review and sign your fee agreement.',values))
  form.set('Signers[0].Name',clientName)
  form.set('Signers[0].EmailAddress',clientEmail)
  form.set('Signers[0].SignerType','Signer')
  formFields.forEach((f,i)=>{const p=`Signers[0].FormFields[${i}]`;form.set(`${p}.Id`,f.id);form.set(`${p}.Type`,f.fieldType);form.set(`${p}.PageNumber`,String(f.pageNumber));form.set(`${p}.Bounds.X`,String(f.x));form.set(`${p}.Bounds.Y`,String(f.y));form.set(`${p}.Bounds.Width`,String(f.width));form.set(`${p}.Bounds.Height`,String(f.height));form.set(`${p}.IsRequired`,f.isRequired?'true':'false');if(f.value!==undefined)form.set(`${p}.Value`,f.value)})
  cc.forEach((email,i)=>form.set(`CC[${i}].EmailAddress`,email))
  form.append('Files',new Blob([Buffer.from(await pdf.arrayBuffer())],{type:'application/pdf'}),'fee-agreement.pdf')
  return boldsign('/v1/document/send',{method:'POST',form})
}
export default async function pncHandler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');const json=(n,v)=>res.status(n).json(v)
 try{
  if(!['GET','POST'].includes(req.method))return json(405,{error:'Method not allowed.'})
  const b=readBody(req),action=clean(b.action||req.query?.action||'list')
  if(req.query?.integration==='client_intake'&&['load','submit'].includes(action)){
   if(req.method!=='POST')fail('Use POST.',405)
   const db=database(),data=await unwrap(db.rpc('mio_intake_access_v313',{p_token:clean(b.token),p_answers:action==='submit'?b.answers:null}));return json(200,data)
  }
  const {db,user}=await identity(req)
  if(req.method!=='POST'&&!['list'].includes(action))fail('Use POST for changes.',405)
  if(req.query?.integration==='client_intake')return await intakeAdmin(db,user,b,action,req,res)
  if(action==='list'){const rows=await unwrap(db.from('mio_pnc_workflows').select(payloadColumns).eq('user_id',user.id).order('created_at',{ascending:false}));return json(200,{rows})}
  if(action==='create'){
   const data=await unwrap(db.rpc('mio_create_pnc_v313',{p_key:b.key,p_first:clean(b.first_name),p_last:clean(b.last_name),p_email:clean(b.email),p_phone:clean(b.phone),p_case_type:clean(b.case_type),p_existing_client:b.existing_client_id||null}));return json(200,data)
  }
  if(req.method!=='POST'&&!['list'].includes(action))fail('Use POST for changes.',405)
  if(action==='close'){
   await unwrap(db.from('mio_pnc_staff').select('user_id').eq('user_id',user.id).single())
   if(b.confirmed!==true)fail('Confirm closing the matter.')
   const m=await unwrap(db.from('matters').select('id,matter_status').eq('id',b.matter_id).single())
   if(![PNC_STATUS,CONSULT_STATUS].includes(m.matter_status))fail('This matter is no longer in a PNC stage.',409)
   const updated=await unwrap(db.from('matters').update({matter_status:'Closed',case_status:'Closed',matter_status_changed_at:stamp()}).eq('id',m.id).eq('matter_status',m.matter_status).select('id,matter_status').single())
   return json(200,{matter:updated})
  }
  if(action==='initialize'){const m=await unwrap(db.from('matters').select('id,client_id,matter_status').eq('id',b.matter_id).single());if(!m.client_id||![PNC_STATUS,CONSULT_STATUS].includes(m.matter_status))fail('This is not a linked PNC matter.');const w=await unwrap(db.from('mio_pnc_workflows').insert({matter_id:m.id,client_id:m.client_id,user_id:user.id,creation_key:randomUUID()}).select(payloadColumns).single());return json(200,{workflow:w})}
  const {w:initial,m}=await owned(db,user,b.matter_id||req.query?.matter_id);let w=initial
  if(action==='save'){
   if(Number(b.revision)!==w.revision)fail('This row changed. Reopen before editing.',409)
   if(w.state.signature_sending)fail('Signature send outcome needs reconciliation before editing.',409)
   const keys=['consult_fee','retainer','hourly_rate','evergreen_minimum_balance','include_intake','intake_template','include_date','consultation_start','duration','time_zone','location','consult_subject','consult_body','consultation_body','intake_body','signature_email_subject','signature_email_message','signature_cc','signature_pdf_path','signature_pdf_fields','sender_email','agreement_custom_fields','retainer_email_subject','retainer_email_body']
   const c={...w.config};for(const k of keys)if(Object.hasOwn(b.config||{},k))c[k]=b.config[k]
   if(c.consult_fee!=null&&c.consult_fee!=='')amount(c.consult_fee);if(c.retainer!=null)amount(c.retainer)
   if(w.state.consult_request&&Number(c.consult_fee)!==Number(w.config.consult_fee))fail('Consultation link already created. Its amount is locked to avoid mismatched payments.',409)
   if((w.state.signature?.id||w.state.signature_sending)&&Number(c.retainer)!==Number(w.config.retainer))fail('The fee agreement already exists. Its retainer amount is locked.',409)
   for(const key of ['include_date','consultation_start','duration','time_zone','location'])if(w.state.calendar_delivery&&JSON.stringify(c[key])!==JSON.stringify(w.config[key]))fail('The calendar invitation already exists. Change it in your calendar rather than creating a duplicate.',409)
   if(w.state.intake&&JSON.stringify(c.intake_template)!==JSON.stringify(w.config.intake_template))fail('An intake link already exists. Its form snapshot is fixed.',409)
   w=await patch(db,w,{config:c});return json(200,{workflow:w})
  }
  if(action==='prepare_consult'){
   if(m.matter_status!==PNC_STATUS)fail('This matter is not awaiting consultation.',409)
   if(!emailOK(m.clients?.email))fail('The client needs a valid email.')
   amount(w.config.consult_fee);if(w.config.include_intake&&!w.config.intake_template?.questions?.length)fail('Choose an intake form before creating links.');
   if(w.config.include_intake&&w.state.intake?.id&&!(Date.parse(w.state.intake.expires_at)>Date.now()))fail('The intake link has expired or its expiry is unavailable. Turn off Include intake form to send this email without it.',409)
   const canCreate=!w.state.consult_preparing;w=await patch(db,w,{state:{...w.state,consult_preparing:true}})
   const r=await payment(db,user,m,'consult',w.config.consult_fee,canCreate);let state={...w.state,consult_preparing:false,consult_request:{id:r.id,url:r.payment_url,amount_cents:r.amount_cents,account_key:r.account_key}}
   w=await patch(db,w,{state})
   if(w.config.include_intake&&!state.intake?.id){const t=w.config.intake_template;if(!t?.questions?.length)fail('Choose an intake form first.')
    const token=randomBytes(32).toString('hex'),id=randomUUID(),row={id,user_id:user.id,matter_id:m.id,matter_name:m.name,client_name:[m.clients.first_name,m.clients.last_name].filter(Boolean).join(' '),recipient_email:m.clients.email,title:t.name,template_snapshot:t,token_hash:createHash('sha256').update(token).digest('hex'),expires_at:new Date(Date.now()+14*86400000).toISOString()}
    await unwrap(db.from('mio_client_intake_requests').insert(row))
    const origin=new URL('https://'+req.headers.host).origin;state={...w.state,intake:{id,status:'pending',expires_at:row.expires_at,url:origin+'/#client-intake/'+token}};w=await patch(db,w,{state})
   }
   return json(200,{workflow:w})
  }
  if(action==='prepare_engagement'){
   if(m.matter_status!==CONSULT_STATUS)fail('Mark the consultation as moving forward first.',409)
   amount(w.config.retainer);
   const canCreate=!w.state.retainer_preparing;w=await patch(db,w,{state:{...w.state,retainer_preparing:true}})
   const r=await payment(db,user,m,'retainer',w.config.retainer,canCreate);w=await patch(db,w,{state:{...w.state,retainer_preparing:false,retainer_request:{id:r.id,url:r.payment_url,amount_cents:r.amount_cents,account_key:r.account_key}}})
   return json(200,{workflow:w})
  }
  if(action==='send_signature'){
   if(m.matter_status!==CONSULT_STATUS)fail('Move to Consult- Need to Client first.',409)
   const clientName=clean(b.client_name)||[m.clients.first_name,m.clients.last_name].filter(Boolean).join(' ').trim();const clientEmail=clean(b.client_email)||clean(m.clients?.email),agreementDate=clean(b.date);if(!emailOK(clientEmail))fail('A valid client email is required.')
   if(w.state.signature?.id)return json(200,{workflow:w})
   if(w.state.signature_sending)fail('A signature request may already have been sent. Check BoldSign and link its document ID before retrying.',409)
   if(!clean(w.config.signature_pdf_path))fail('Upload and map the fee agreement PDF in PNC Settings first.')
   if(b.confirmed!==true)fail('Confirm the fee-agreement send first.')
   await saveEvergreenMinimum(db,w,m,b.evergreen_minimum_balance)
   w=await patch(db,w,{state:{...w.state,signature_sending:stamp()}})
   try{
     const p=await signWithPdf(db,w,m,clientName,clientEmail,agreementDate)
     w=await patch(db,w,{state:{...w.state,signature_sending:null,signature:signatureEvidence(p)}});return json(200,{workflow:w})
   }catch(e){if(e.status){w=await patch(db,w,{state:{...w.state,signature_sending:null}})}throw e}
  }
  if(action==='link_signature'){
   const id=clean(b.signature_request_id||b.document_id);if(!id)fail('Paste the BoldSign document ID first.')
   const r=await boldsign('/v1/document/properties?documentId='+encodeURIComponent(id))
   w=await patch(db,w,{state:{...w.state,signature_sending:null,signature:signatureEvidence(r)}});return json(200,{workflow:w})
  }
  if(action==='reset_signature'){if(!w.state.signature_sending)fail('No signature send is pending reconciliation.');if(b.confirmed!==true)fail('Confirm that no BoldSign request was actually sent.');w=await patch(db,w,{state:{...w.state,signature_sending:null}});return json(200,{workflow:w})}
  if(action==='refresh'){
   const transactions=b.sync?await syncPayments(db,w):null
   const {state}=await verify(db,w,{transactions});w=await patch(db,w,{state});return json(200,{workflow:w})
  }
  if(action==='reset_preparation'){if(!['consult','retainer'].includes(b.kind)||b.confirmed!==true)fail('Confirm payment-link recovery.');w=await patch(db,w,{state:{...w.state,[b.kind+'_preparing']:false}});return json(200,{workflow:w})}
  if(action==='intake_answers'){if(!w.state.intake?.id)return json(200,{answers:{}});const r=await unwrap(db.from('mio_client_intake_requests').select('id,mio_client_intake_submissions(answers)').eq('user_id',user.id).eq('id',w.state.intake.id).single());return json(200,{answers:r.mio_client_intake_submissions?.[0]?.answers||{}})}
  if(action==='minimum_balance'){const matterId=clean(b.matter_id||req.query?.matter_id);if(!matterId)fail('Select a matter.',409);const row=await unwrap(db.from('case_mio_user_state').select('raw_value').eq('user_id',user.id).eq('key','caseMioClioMinimumBalancesByMatterId').maybeSingle());let map={};try{map=row?.raw_value?JSON.parse(row.raw_value):{}}catch{map={}}if(!map||typeof map!=='object'||Array.isArray(map))map={};const value=map[String(matterId)];return json(200,{minimum_balance:value==null?null:Number(value)})}
  if(action==='claim_delivery'){
   if(!['consult','engage','retainer_email','calendar'].includes(b.kind))fail('Invalid delivery kind.')
   const key=b.kind+'_delivery',old=w.state[key]
   if(old?.status==='sending'){if(b.kind==='calendar')return json(200,{workflow:w});fail('The prior email outcome is uncertain. Check Sent Items before retrying.',409)}
   if(old?.status==='sent'){
    if(b.kind==='calendar')return json(200,{workflow:w})
    if(b.resend!==true||clean(b.previous_reference)!==clean(old.reference))fail('This email was already sent. Review the latest history and explicitly confirm Send again.',409)
   }
   if(b.kind!=='calendar'&&b.recipient!=null&&clean(b.recipient).toLowerCase()!==clean(m.clients?.email).toLowerCase())fail('The client email changed. Reopen the consultation and confirm the updated recipient.',409)
   if(b.kind!=='calendar'&&!emailOK(m.clients?.email))fail('A valid client email is required.')
   const entry={status:'sending',at:stamp(),reference:randomUUID(),...(b.kind!=='calendar'?{kind:b.kind,recipient:clean(m.clients.email),sender:clean(w.config.sender_email)||'billing@beveridgelawfirm.com',subject:clean(b.subject).slice(0,1000),body:String(b.body||'').slice(0,50000)}:{})}
   const state={...w.state,[key]:entry}
   if(b.kind!=='calendar')state.email_history=[...emailHistory(w.state),entry]
   w=await patch(db,w,{state});return json(200,{workflow:w})
  }
  if(action==='reset_delivery'){
   if(!['consult','engage','retainer_email'].includes(b.kind)||b.confirmed!==true)fail('Confirm that no email was sent.')
   const old=w.state[b.kind+'_delivery'];if(old?.status!=='sending')fail('Only an uncertain attempt can be reviewed for retry. Use Send again for a sent email.',409)
   const reviewed_at=stamp(),history=emailHistory(w.state).map(row=>row.reference===old.reference?{...row,status:'unknown',reviewed_at}:row)
   w=await patch(db,w,{state:{...w.state,email_history:history,[b.kind+'_delivery']:{...old,status:'retry_approved',reviewed_at}}});return json(200,{workflow:w})
  }
  if(action==='record_delivery'){
   if(!['consult','engage','retainer_email','calendar'].includes(b.kind))fail('Invalid delivery kind.')
   const old=w.state[b.kind+'_delivery']
   if(b.kind!=='calendar'&&(!old||!['sending','sent'].includes(old.status)||!clean(b.reference)||old.reference!==clean(b.reference)))fail('This email attempt is no longer current. Reload its history before retrying.',409)
   if(!['sent','failed'].includes(b.status))fail('Invalid delivery status.')
   const entry={...old,status:clean(b.status),at:old?.status==='sent'?old.at:stamp(),reference:clean(b.reference),...(b.kind==='calendar'?{local_id:b.local_id||old?.local_id,local_saved:b.local_saved===true}: {})}
   const state={...w.state,[b.kind+'_delivery']:entry}
   if(b.kind!=='calendar')state.email_history=emailHistory(w.state).map(row=>row.reference===entry.reference?{...row,...entry}:row)
   w=await patch(db,w,{state});return json(200,{workflow:w})
  }
  if(action==='advance'){
   const next=m.matter_status===PNC_STATUS?CONSULT_STATUS:m.matter_status===CONSULT_STATUS?CLIENT_STATUS:null;if(!next)fail('This matter is not in a PNC stage.',409)
   if(b.confirmed!==true)fail('Confirm the status change.')
   if(next===CLIENT_STATUS){const transactions=await syncPayments(db,w);const {state}=await verify(db,w,{transactions});w=await patch(db,w,{state});if(!readyToClient(state))fail('A verified signed agreement and the full retainer paid or processing are both required.',409)}
   const updated=await unwrap(db.from('matters').update({matter_status:next,matter_status_changed_at:stamp()}).eq('id',m.id).eq('matter_status',m.matter_status).select('id,matter_status').single())
   return json(200,{workflow:w,matter:updated})
  }
  fail('Unsupported PNC action.')
 }catch(e){return json(e.status||500,{error:e.message||'PNC request failed.'})}
}
async function intakeAdmin(db,user,b,action,req,res){
 if(action==='list'){const matter=clean(b.matter_id||req.query.matter_id);const requests=await unwrap(db.from('mio_client_intake_requests').select('*,mio_client_intake_submissions(*)').eq('user_id',user.id).eq('matter_id',matter).order('created_at',{ascending:false}));return res.status(200).json({requests:requests.map(({token_hash,mio_client_intake_submissions,...r})=>({...r,submission:mio_client_intake_submissions?.[0]||null}))})}
 if(action==='create'){
  const m=await unwrap(db.from('matters').select('id').eq('id',b.matter_id).single());if(!m)fail('Matter not found.');if(!b.template_snapshot?.questions?.length)fail('An intake template is required.')
  const token=randomBytes(32).toString('hex'),row={user_id:user.id,matter_id:m.id,matter_name:clean(b.matter_name),client_name:clean(b.client_name),recipient_email:clean(b.recipient_email),title:clean(b.title),template_snapshot:b.template_snapshot,token_hash:createHash('sha256').update(token).digest('hex'),expires_at:new Date(Date.now()+Math.min(90,Math.max(1,Number(b.expires_days)||14))*86400000).toISOString()}
  const {token_hash,...request}=await unwrap(db.from('mio_client_intake_requests').insert(row).select('*').single());const origin=new URL('https://'+req.headers.host).origin;return res.status(200).json({request,link:origin+'/#client-intake/'+token})
 }
 if(action==='review'){const row=await unwrap(db.from('mio_client_intake_requests').update({reviewed_at:stamp(),reviewed_by:user.id,applied_keys:b.applied_keys||[]}).eq('id',b.request_id).eq('user_id',user.id).select('id').single());return res.status(200).json({request:row})}
 fail('Unsupported intake action.')
}
