import {randomUUID,createHash} from 'node:crypto'
import {fail,clean} from './security.js'
import {normalizePersonal} from '../../src/discovery/personal.js'
import {analyzeDiscovery} from '../discovery-objections.js'
import {exportDiscoveryDocx} from '../../src/discovery/documents.js'
import {normalizeResponseReview,reviewProblems,responseAssembly,responseTitle,analysisType,clientResponseText,readyFileIds} from '../../src/portal/discoveryResponseReview.js'
const data=async q=>{const r=await q;if(r.error){if(r.error.code==='PT409')r.error.status=409;throw r.error}return r.data}
export async function discoverySources(db,ids,includeData=false){const rows=await data(db.rpc('mio_portal_discovery_sources',{p_sets:ids,p_include_data:includeData}));return Array.isArray(rows)?rows:[]}
export async function originalDiscoveryDownload(db,set){
 const row=(await discoverySources(db,[set.id],true))[0],doc=row?.document
 if(!doc||doc.matter_id!==set.matter_id)fail('The original discovery document is not available. Ask the firm to link its uploaded matter document.',404)
 const filename=String(doc.file_name||'Original discovery document').replace(/[\x00-\x1f/\\]/g,'_').slice(0,180),path=String(doc.storage_path||'')
 if(path){
  const parts=path.split('/');if(parts.some(p=>!p||p==='.'||p==='..')||parts.length<4||/%(?:2e|2f|5c|00)/i.test(path)||parts[1]!==set.matter_id||parts[2]!==doc.id)fail('The original document storage reference does not match this matter.',409)
  const signed=await data(db.storage.from('case-documents').createSignedUrl(path,300)),url=new URL(signed.signedUrl);url.searchParams.set('download',filename);return {url:url.toString(),filename}
 }
 const match=String(doc.file_data||'').match(/^data:([^;,]+);base64,([a-zA-Z0-9+/=\r\n]+)$/)
 if(!match||!['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'].includes(match[1])||match[2].length>36000000)fail('This original document needs to be saved in the matter document library before download.',409)
 const bytes=Buffer.from(match[2],'base64'),extension=match[1]==='application/pdf'?'pdf':match[1]==='text/plain'?'txt':'docx',stored='originals/'+set.matter_id+'/'+set.id+'/'+createHash('sha256').update(bytes).digest('hex')+'.'+extension
 const upload=await db.storage.from('portal-discovery').upload(stored,bytes,{contentType:match[1],upsert:false});if(upload.error&&!['409','Duplicate','ResourceAlreadyExists'].includes(String(upload.error.statusCode||upload.error.code)))throw upload.error
 const signed=await data(db.storage.from('portal-discovery').createSignedUrl(stored,300)),url=new URL(signed.signedUrl);url.searchParams.set('download',filename);return {url:url.toString(),filename}
}
export async function reviewContext(db,user){const raw=await data(db.rpc('mio_portal_discovery_review_context',{p_user:user.id}));const context=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};let personal,personal_error='';try{personal=normalizePersonal(context.personal||{})}catch{personal=normalizePersonal({});personal_error='Your saved objection rules could not be read. Repair them in Discovery Objections before running AI analysis.'}return {staff_id:user.id,personal,personal_error,templates:Array.isArray(context.templates)?context.templates:[]}}
const reviewSnapshot=set=>set.requests.map(r=>({id:r.id,client_version:set.answers.find(a=>a.request_id===r.id)?.version||0,review_version:set.reviews.find(v=>v.request_id===r.id)?.version||0,content_hash:createHash('sha256').update(JSON.stringify({text:r.request_text,files:set.files.filter(f=>f.request_id===r.id).map(f=>({id:f.id,status:f.status,filename:f.filename})).sort((a,b)=>a.id.localeCompare(b.id))})).digest('hex')}))
export async function reviewWorkspace(db,set,user){
 const [answers,files,reviews,exports,context]=await Promise.all([
  data(db.from('mio_portal_discovery_answers').select('*').eq('set_id',set.id)),
  data(db.from('mio_portal_discovery_files').select('id,request_id,filename,folder_name,size_bytes,status').eq('set_id',set.id).is('abandoned_at',null).in('status',['ready','uploading'])),
  data(db.from('mio_portal_discovery_reviews').select('*').eq('set_id',set.id)),
  data(db.from('mio_portal_discovery_response_drafts').select('id,filename,kind,created_at,request_versions').eq('set_id',set.id).order('created_at',{ascending:false}).limit(20)),reviewContext(db,user)
 ])
 const normalize=rows=>(rows||[]).map(v=>[v.id,v.client_version,v.review_version,v.content_hash]),current={...set,answers:answers||[],files:files||[],reviews:reviews||[]},snapshot=JSON.stringify(normalize(reviewSnapshot(current)));return {set:current,exports:(exports||[]).map(({request_versions,...draft})=>({...draft,outdated:JSON.stringify(normalize(request_versions))!==snapshot})),context}
}
export async function discoveryReviewAction(db,m,set,b,{user,analyze=analyzeDiscovery}={}){
 if(b.action==='staff_discovery_workspace')return reviewWorkspace(db,set,user)
 if(b.action==='staff_discovery_draft_download'){
  const draft=await data(db.from('mio_portal_discovery_response_drafts').select('*').eq('id',b.draft_id).eq('set_id',set.id).maybeSingle());if(!draft)fail('Response draft unavailable for this discovery set.',404)
  const signed=await data(db.storage.from('portal-discovery').createSignedUrl(draft.path,300)),url=new URL(signed.signedUrl);url.searchParams.set('download',draft.filename);return {url:url.toString()}
 }
 const workspace=await reviewWorkspace(db,set,user),s=workspace.set,r=s.requests.find(r=>r.id===b.request_id)
 if(b.action==='staff_discovery_analyze'){
  if(workspace.context.personal_error)fail(workspace.context.personal_error,409)
  if(!r)fail('Request unavailable.',404)
  const answer=s.answers.find(a=>a.request_id===r.id)
  const output=await analyze({regime:b.regime,level:b.level,context:String(b.context||''),strategy:b.strategy,personal:workspace.context.personal,requests:[{id:r.id,type:analysisType(s.discovery_type),number:r.request_number,request:r.request_text,response:clientResponseText(answer)}],...(b.retry?{retry:b.retry}:{})});return {...output,results:output.results.map(result=>({...result,client_version:answer?.version||0,request_text:r.request_text}))}
 }
 if(b.action==='staff_discovery_review_save'){
  if(!r)fail('Request unavailable.',404)
  if(!Number.isInteger(b.client_version)||b.client_version<0||!Number.isInteger(b.review_version)||b.review_version<0)fail('Refresh the review before saving.')
  let review;try{review=normalizeResponseReview(b.review)}catch(e){fail(e.message)}
  // The server supplies request wording and file identities; browser-provided copies
  // must match so an old screen cannot approve a newer request accidentally.
  if(review.request_text!==r.request_text)fail('Request wording changed. Refresh and compare before saving.',409)
  if(JSON.stringify(review.file_ids)!==JSON.stringify(readyFileIds(s,r.id)))fail('Client uploads changed. Refresh and review the new documents.',409)
  if(review.status==='approved'){const problems=reviewProblems(s,r,{review,client_version:b.client_version});if(problems.length)fail('Approval needs review: '+problems.join('; '),409)}
  const saved=await data(db.rpc('mio_portal_discovery_save_review',{p_set:s.id,p_request:r.id,p_client_version:b.client_version,p_review_version:b.review_version,p_review:review,p_staff:user.id}));return {review:saved}
 }
 if(b.action==='staff_discovery_assemble'){
  const working=b.working===true;let assembly;try{assembly=responseAssembly(s,{working})}catch(e){fail(e.message,409)}
  const bytes=await exportDiscoveryDocx({...assembly,privilegePlacement:'after_request',title:responseTitle(s.discovery_type),preamble:['DRAFT — ATTORNEY REVIEW BEFORE SERVICE',m.name||'',s.title,'Client responses and selected attorney objections. Case caption, signature, service certificate and any required verification must be completed in your response form.']})
  const id=randomUUID(),filename=responseTitle(s.discovery_type).replace(/[^a-z0-9 -]/gi,'')+' - '+(working?'working draft':'reviewed draft')+'.docx',path='assembled/'+m.id+'/'+s.id+'/'+id+'.docx'
  await data(db.storage.from('portal-discovery').upload(path,bytes,{contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',upsert:false}))
  const draft={id,set_id:s.id,path,filename,kind:working?'working':'reviewed',created_by:user.id,request_versions:reviewSnapshot(s),created_at:new Date().toISOString()}
  await data(db.from('mio_portal_discovery_response_drafts').insert(draft))
  const signed=await data(db.storage.from('portal-discovery').createSignedUrl(path,300)),url=new URL(signed.signedUrl);url.searchParams.set('download',filename)
  return {draft:{id,filename,kind:draft.kind,created_at:draft.created_at,outdated:false},url:url.toString(),pending:assembly.pending}
 }
 fail('Unsupported response review action.')
}
