import {randomUUID} from 'node:crypto'
import {clean,emailKey,fail} from './security.js'
import {descriptiveFilename,fileExtension} from '../../src/portal/discoveryFileNames.js'
const data=async q=>{const r=await q;if(r.error)throw r.error;return r.data}
const MIME={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',heic:'image/heic',heif:'image/heif',txt:'text/plain',csv:'text/csv',zip:'application/zip',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
const publicFile=f=>({id:f.id,filename:f.filename,original_filename:f.original_filename,size_bytes:f.size_bytes,created_at:f.created_at,status:f.status})
export async function documentRequests(db,m,{staff=false}={}){
 let q=db.from('mio_portal_document_requests').select('id,matter_id,client_id,recipient_email,title,summary,details,created_at,closed_at').eq('matter_id',m.id).order('created_at',{ascending:false})
 if(!staff)q=q.eq('client_id',m.client_id).eq('recipient_email',emailKey(m.clients?.email)).is('closed_at',null)
 const rows=await data(q),ids=(rows||[]).map(r=>r.id)
 if(!ids.length)return {requests:[]}
 const files=await data(db.from('mio_portal_document_files').select('id,request_id,filename,original_filename,size_bytes,status,created_at').in('request_id',ids).eq('status','ready').is('removed_at',null))
 return {requests:rows.map(r=>({id:r.id,title:r.title,summary:r.summary,details:r.details,closed_at:r.closed_at,created_at:r.created_at,files:(files||[]).filter(f=>f.request_id===r.id).map(publicFile)}))}
}
export async function documentAction(db,m,b,{staff=false}={}){
 const action=b.action
 if(action==='document_list'||action==='staff_document_list')return documentRequests(db,m,{staff})
 if(action==='staff_document_save'&&staff){
  const title=clean(b.title),summary=clean(b.summary),details=clean(b.details)
  if(!title||title.length>180||summary.length>500||details.length>12000)fail('Add a request name (up to 180 characters), a short note (up to 500), and details (up to 12,000).')
  const values={title,summary,details,updated_at:new Date().toISOString()}
  let result
  if(b.request_id){result=await data(db.from('mio_portal_document_requests').update(values).eq('id',b.request_id).eq('matter_id',m.id).eq('client_id',m.client_id).eq('recipient_email',emailKey(m.clients?.email)).is('closed_at',null).select('id').maybeSingle());if(!result)fail('Request unavailable for this client.',404)}
  else result=await data(db.from('mio_portal_document_requests').insert({...values,matter_id:m.id,client_id:m.client_id,recipient_email:emailKey(m.clients?.email)}).select('id').single())
  return {id:result.id}
 }
 const r=await data(db.from('mio_portal_document_requests').select('*').eq('id',b.request_id).eq('matter_id',m.id).maybeSingle())
 if(!r||(!staff&&(r.client_id!==m.client_id||r.recipient_email!==emailKey(m.clients?.email)||r.closed_at)))fail('Request unavailable for this client.',404)
 if(action==='staff_document_close'&&staff){await data(db.from('mio_portal_document_requests').update({closed_at:new Date().toISOString()}).eq('id',r.id).eq('matter_id',m.id));return {ok:true}}
 if(action==='document_upload_begin'){
  if(staff||r.closed_at)fail('This request is closed.',403)
  const original=clean(b.original_filename).replace(/[\x00-\x1f/\\]/g,'_').slice(0,180),filename=descriptiveFilename(b.filename,original),ext=fileExtension(original).slice(1).toLowerCase(),contentType=MIME[ext]
  if(!contentType||fileExtension(filename).toLowerCase()!=='.'+ext||!Number.isInteger(b.size)||b.size<1||b.size>26214400)fail('Choose a supported document or image up to 25 MB.')
  const id=randomUUID(),path=m.id+'/'+r.id+'/'+id+'/document.'+ext
  await data(db.from('mio_portal_document_files').insert({id,request_id:r.id,matter_id:m.id,path,filename,original_filename:original,content_type:contentType,size_bytes:b.size,status:'uploading'}))
  const signed=await data(db.storage.from('portal-documents').createSignedUploadUrl(path))
  return {file_id:id,url:signed.signedUrl,content_type:contentType}
 }
 const f=await data(db.from('mio_portal_document_files').select('*').eq('id',b.file_id).eq('request_id',r.id).eq('matter_id',m.id).is('removed_at',null).maybeSingle())
 if(!f)fail('File unavailable.',404)
 if(action==='document_upload_complete'){
  if(staff)fail('Only the client can upload files.',403)
  if(f.status!=='ready'){
   const info=await data(db.storage.from('portal-documents').info(f.path))
   if(Number(info.size??info.metadata?.size)!==Number(f.size_bytes))fail('Upload did not finish. Please retry.',409)
   const updated=await data(db.from('mio_portal_document_files').update({status:'ready'}).eq('id',f.id).eq('status','uploading').is('removed_at',null).select('*').maybeSingle())
   if(!updated)fail('The file changed. Refresh the request.',409)
   return {file:publicFile(updated)}
  }
  return {file:publicFile(f)}
 }
 if(action==='document_remove'){
  if(staff)fail('Only the client can remove a file.',403)
  const removed=await data(db.from('mio_portal_document_files').update({removed_at:new Date().toISOString()}).eq('id',f.id).is('removed_at',null).select('id').maybeSingle())
  if(!removed)fail('The file changed. Refresh the request.',409)
  // A removed file is immediately inaccessible even if storage cleanup fails.
  await db.storage.from('portal-documents').remove([f.path])
  return {ok:true}
 }
 if(action==='document_download'||action==='staff_document_download'){
  if(f.status!=='ready')fail('File upload is incomplete.',409)
  const signed=await data(db.storage.from('portal-documents').createSignedUrl(f.path,300)),url=new URL(signed.signedUrl)
  url.searchParams.set('download',f.filename);return {url:url.toString()}
 }
 fail('Unsupported document action.')
}
