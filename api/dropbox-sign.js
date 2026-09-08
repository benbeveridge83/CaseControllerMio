const API='https://api.hellosign.com/v3'
const json=(res,status,body)=>res.status(status).json(body)
const clean=v=>String(v||'').trim()
const testMode=()=>String(process.env.DROPBOX_SIGN_TEST_MODE||'true').toLowerCase()!=='false'
function authHeader(){const key=clean(process.env.DROPBOX_SIGN_API_KEY);if(!key)throw new Error('DROPBOX_SIGN_API_KEY is not configured in Vercel.');return 'Basic '+Buffer.from(key+':').toString('base64')}
async function call(path,{method='GET',body,headers={}}={}){const response=await fetch(API+path,{method,headers:{Authorization:authHeader(),...headers},body});const text=await response.text();let data;try{data=JSON.parse(text)}catch{data={message:text}}if(!response.ok)throw new Error(data?.error?.error_msg||data?.error?.error_name||data?.message||('Dropbox Sign request failed ('+response.status+').'));return data}
async function readJson(req){if(req.body&&typeof req.body==='object')return req.body;const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString('utf8');return raw?JSON.parse(raw):{}}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store')
 try{
  if(req.method==='GET'){
   const action=clean(req.query?.action||'status')
   if(action==='status'){const data=await call('/account');return json(res,200,{connected:true,account_email:data?.account?.email_address||'',account_id:data?.account?.account_id||'',test_mode:testMode(),client_id_configured:!!clean(process.env.DROPBOX_SIGN_CLIENT_ID)})}
   if(action==='request'){const id=clean(req.query?.signature_request_id);if(!id)return json(res,400,{error:'signature_request_id is required'});const data=await call('/signature_request/'+encodeURIComponent(id));return json(res,200,{signature_request:data.signature_request})}
   if(action==='files'){const id=clean(req.query?.signature_request_id);if(!id)return json(res,400,{error:'signature_request_id is required'});const response=await fetch(API+'/signature_request/files/'+encodeURIComponent(id)+'?file_type=pdf',{headers:{Authorization:authHeader()}});if(!response.ok)throw new Error('Dropbox Sign could not return the completed PDF.');const bytes=Buffer.from(await response.arrayBuffer());res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="dropbox-sign-'+id+'.pdf"');return res.status(200).send(bytes)}
   return json(res,400,{error:'Unsupported action.'})
  }
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'})
  const body=await readJson(req),action=clean(body.action)
  if(action==='send'){
   const files=Array.isArray(body.files)?body.files:[],signers=Array.isArray(body.signers)?body.signers:[]
   if(!files.length)return json(res,400,{error:'At least one PDF is required.'})
   if(!signers.length||signers.some(s=>!clean(s.email_address)||!clean(s.name)))return json(res,400,{error:'Each signer needs a name and email address.'})
   const form=new FormData();form.set('title',clean(body.title)||'Signature request');form.set('subject',clean(body.subject)||clean(body.title)||'Signature request');form.set('message',clean(body.message)||'Please review and sign the attached document.');form.set('test_mode',testMode()?'1':'0')
   const clientId=clean(process.env.DROPBOX_SIGN_CLIENT_ID);if(clientId)form.set('client_id',clientId)
   if(body.metadata)for(const[k,v]of Object.entries(body.metadata))form.set('metadata['+k+']',String(v).slice(0,500))
   signers.forEach((s,i)=>{form.set(`signers[${i}][email_address]`,clean(s.email_address));form.set(`signers[${i}][name]`,clean(s.name));form.set(`signers[${i}][order]`,String(Number.isFinite(Number(s.order))?Number(s.order):i))})
   files.forEach((file,i)=>{const raw=clean(file.base64).replace(/^data:[^;]+;base64,/,''),bytes=Buffer.from(raw,'base64');if(!bytes.length||bytes.length>25*1024*1024)throw new Error('Each signature file must be a non-empty PDF under 25 MB.');if(String(file.content_type||'application/pdf').toLowerCase()!=='application/pdf')throw new Error('Dropbox Sign workflow inputs must be reviewed PDFs.');form.append('files['+i+']',new Blob([bytes],{type:'application/pdf'}),clean(file.name)||('document-'+(i+1)+'.pdf'))})
   const data=await call('/signature_request/send',{method:'POST',body:form})
   return json(res,200,{signature_request:data.signature_request,test_mode:testMode()})
  }
  if(action==='cancel'){
   const id=clean(body.signature_request_id);if(!id)return json(res,400,{error:'signature_request_id is required'});const data=await call('/signature_request/cancel/'+encodeURIComponent(id),{method:'POST'});return json(res,200,data)
  }
  return json(res,400,{error:'Unsupported action.'})
 }catch(error){return json(res,500,{error:error.message||String(error)})}
}
