import {randomUUID} from 'node:crypto'
import {clean,emailKey,fail} from './security.js'
const data=async q=>{const r=await q;if(r.error){if(r.error.code==='PT409')r.error.status=409;throw r.error}return r.data}
const TYPES=new Set(['production','interrogatories','disclosures','admissions'])
const MIME={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',heic:'image/heic',heif:'image/heif',txt:'text/plain',csv:'text/csv',zip:'application/zip',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
const answerForClient=a=>a?{request_id:a.request_id,client_answer:a.client_answer,client_comments:a.client_comments,rfp_status:a.rfp_status,needs_help:a.needs_help,version:a.version,updated_at:a.updated_at}:null
export function requestForPortal(r,i){return {id:clean(r.id),request_number:clean(r.request_number)||String(i+1),request_text:String(r.request_text||''),client_must_respond:r.client_must_respond!==false,attorney_comments:String(r.attorney_comments||'')}}
export async function discoveryList(db,m,{staff=false}={}){
 let query=db.from('mio_portal_discovery_sets').select('*').eq('matter_id',m.id).is('revoked_at',null).order('published_at')
 if(!staff)query=query.eq('client_id',m.client_id).eq('recipient_email',emailKey(m.clients?.email))
 const sets=await data(query),ids=(sets||[]).map(s=>s.id)
 if(!ids.length)return {sets:[]}
 const [answers,files]=await Promise.all([data(db.from('mio_portal_discovery_answers').select('*').in('set_id',ids)),data(db.from('mio_portal_discovery_files').select('id,set_id,request_id,filename,size_bytes,status').in('set_id',ids).is('abandoned_at',null).in('status',['ready','uploading']))])
 return {sets:sets.map(s=>({id:s.id,source_set_id:staff?s.source_set_id:undefined,title:s.title,discovery_type:s.discovery_type,client_instructions:s.client_instructions,client_response_due:s.client_response_due,updated_at:s.updated_at,requests:(s.requests||[]).map(requestForPortal),answers:(answers||[]).filter(a=>a.set_id===s.id).map(a=>staff?a:answerForClient(a)),files:(files||[]).filter(f=>f.set_id===s.id)}))}
}
async function selectedSet(db,m,b,{staff=false}={}){
 const s=await data(db.from('mio_portal_discovery_sets').select('*').eq('id',b.set_id).eq('matter_id',m.id).is('revoked_at',null).maybeSingle())
 if(!s||(!staff&&(s.client_id!==m.client_id||s.recipient_email!==emailKey(m.clients?.email))))fail('Discovery set unavailable for this matter.',404)
 return s
}
export async function discoveryAction(db,m,b,{staff=false,user}={}){
 const action=b.action
 if(action==='discovery_list'||action==='staff_discovery_list')return discoveryList(db,m,{staff})
 if(action==='staff_discovery_publish'&&staff){
  const source=b.set;if(!source||source.matter_id!==m.id||!clean(source.id)||!TYPES.has(source.discovery_type)||!Array.isArray(source.requests)||!source.requests.length||source.requests.length>300)fail('Select a prepared discovery set for this matter.')
  const requests=source.requests.map(requestForPortal)
  if(requests.some(r=>!r.id||!r.request_text)||new Set(requests.map(r=>r.id)).size!==requests.length)fail('Every request must have unique identification and text.')
  const existing=await data(db.from('mio_portal_discovery_sets').select('id,client_id,recipient_email').eq('matter_id',m.id).eq('source_set_id',source.id).maybeSingle())
  if(existing&&(existing.client_id!==m.client_id||existing.recipient_email!==emailKey(m.clients?.email)))fail('Client association changed. Review the existing assignment before releasing to another client.',409)
  const values={matter_id:m.id,client_id:m.client_id,recipient_email:emailKey(m.clients?.email),source_user_id:user.id,source_set_id:source.id,title:clean(source.title)||'Discovery responses',discovery_type:source.discovery_type,client_instructions:String(source.client_instructions||''),client_response_due:source.client_response_due||null,requests,updated_at:new Date().toISOString(),revoked_at:null}
  await data(db.from('mio_portal_discovery_sets').upsert(values,{onConflict:'matter_id,source_set_id'}));return {ok:true}
 }
 const s=await selectedSet(db,m,b,{staff}),r=(s.requests||[]).find(r=>r.id===b.request_id)
 if(!r)fail('Discovery request unavailable.',404)
 if(action==='staff_discovery_revision'&&staff){
  if(String(b.attorney_response||'').length>50000)fail('Revision is too long.')
  // Never rewrite the client's answer when saving the attorney's draft.
  const existing=await data(db.from('mio_portal_discovery_answers').select('request_id').eq('set_id',s.id).eq('request_id',r.id).maybeSingle())
  if(!existing){const result=await db.from('mio_portal_discovery_answers').insert({set_id:s.id,request_id:r.id});if(result.error&&result.error.code!=='23505')throw result.error}
  await data(db.from('mio_portal_discovery_answers').update({attorney_response:String(b.attorney_response||'')}).eq('set_id',s.id).eq('request_id',r.id));return {ok:true}
 }
 if(action==='discovery_save'){
  const v=b.answer||{};for(const k of ['client_answer','client_comments','rfp_status'])if(typeof (v[k]??'')!=='string'||String(v[k]||'').length>50000)fail('Answer is too long.')
  if(!Number.isInteger(b.version)||b.version<0)fail('Refresh the saved answer before editing.')
  let saved
  try{saved=await data(db.rpc('mio_portal_discovery_save_answer',{p_set:s.id,p_request:r.id,p_version:b.version,p_answer:v.client_answer||'',p_comments:v.client_comments||'',p_status:v.rfp_status||'',p_help:!!v.needs_help}))}
  catch(error){
   if(error.code!=='PT409'&&error.status!==409)throw error
   // A response can be lost after the transaction commits. Confirm an identical
   // retry instead of trapping a successfully saved answer in a conflict loop.
   const current=await data(db.from('mio_portal_discovery_answers').select('*').eq('set_id',s.id).eq('request_id',r.id).maybeSingle())
   if(!current||current.client_answer!==(v.client_answer||'')||current.client_comments!==(v.client_comments||'')||current.rfp_status!==(v.rfp_status||'')||current.needs_help!==!!v.needs_help)throw error
   saved=current
  }
  return {answer:answerForClient(Array.isArray(saved)?saved[0]:saved)}
 }
 if(action==='discovery_upload_begin'){
  if(s.discovery_type!=='production')fail('Upload documents under a production request.')
  const filename=clean(b.filename).replace(/[\x00-\x1f/\\]/g,'_').slice(0,180),extension=filename.split('.').pop().toLowerCase(),contentType=MIME[extension]
  if(!contentType||!Number.isInteger(b.size)||b.size<1||b.size>26214400)fail('Use a supported document or image up to 25 MB.')
  const id=randomUUID(),path=m.id+'/'+s.id+'/'+id+'/'+filename
  await data(db.from('mio_portal_discovery_files').insert({id,set_id:s.id,request_id:r.id,path,filename,content_type:contentType,size_bytes:b.size,status:'uploading'}))
  const signed=await data(db.storage.from('portal-discovery').createSignedUploadUrl(path))
  return {file_id:id,url:signed.signedUrl,content_type:contentType}
 }
 if(['discovery_upload_complete','discovery_upload_cancel','discovery_download'].includes(action)){
  const f=await data(db.from('mio_portal_discovery_files').select('*').eq('id',b.file_id).eq('set_id',s.id).eq('request_id',r.id).maybeSingle());if(!f||f.abandoned_at&&action!=='discovery_upload_cancel')fail('File unavailable.',404)
  if(action==='discovery_upload_cancel'){
   if(f.abandoned_at)return {ok:true}
   if(f.status==='ready')fail('This file is already uploaded. Refresh the portal to see it.',409)
   const canceled=await data(db.from('mio_portal_discovery_files').update({abandoned_at:new Date().toISOString()}).eq('id',f.id).eq('status','uploading').is('abandoned_at',null).select('id').maybeSingle())
   if(!canceled)fail('The upload changed in another window. Refresh before canceling.',409)
   return {ok:true}
  }
  if(action==='discovery_upload_complete'){
   if(f.status!=='ready'){
    const info=await data(db.storage.from('portal-discovery').info(f.path)),size=Number(info.size??info.metadata?.size)
    if(size!==Number(f.size_bytes))fail('Upload did not finish. Try uploading the file again.',409)
    const completed=await data(db.from('mio_portal_discovery_files').update({status:'ready'}).eq('id',f.id).eq('status','uploading').is('abandoned_at',null).select('id').maybeSingle())
    if(!completed)fail('The upload changed in another window. Refresh to confirm its status.',409)
   }
   return {file:{id:f.id,request_id:r.id,filename:f.filename,size_bytes:f.size_bytes,status:'ready'}}
  }
  if(f.status!=='ready')fail('File upload is not complete.',409)
  const signed=await data(db.storage.from('portal-discovery').createSignedUrl(f.path,300,{download:f.filename}));return {url:signed.signedUrl}
 }
 fail('Unsupported discovery action.')
}
