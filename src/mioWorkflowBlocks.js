// Reusable workflow definitions and document slots. Provider calls and file bytes stay outside state.
export const WORKFLOW_ACTIONS=[
 {id:'approve',label:'Review / approve decision',button:'Confirm this step'},
 {id:'draft_document',label:'Draft document',button:'Draft document',module:'drafting'},
 {id:'efile_document',label:'E-file document',button:'Prepare e-filing',module:'efile',input:true},
 {id:'draft_email',label:'Draft email',button:'Prepare email',module:'email',recipients:true},
 {id:'esign_document',label:'Send document for e-signatures',button:'Prepare signature request',input:true,recipients:true},
 {id:'review_document',label:'Receive / review document',button:'Review documents',module:'documents'},
 {id:'calendar',label:'Review calendar / setting',button:'Open calendar',module:'calendar'},
 {id:'matter_status',label:'Update matter / case status',button:'Approve status change'},
 {id:'finish',label:'Complete workflow',button:'Complete workflow'},
 {id:'manual',label:'Manual task / follow-up',button:'Record completion'}]
export const actionFor=id=>WORKFLOW_ACTIONS.find(a=>a.id===id)||WORKFLOW_ACTIONS.at(-1)
export const WORKFLOW_GRAPH_TYPES=[['matter_trust_funds','Trust amount'],['trust_minus_minimum','Trust - minimum balance'],['trust_minus_minimum_minus_wip','Trust - WIP - minimum balance'],['trust_minus_wip_minus_outstanding_minus_minimum','Trust - OB - WIP - minimum balance'],['trust_minus_outstanding','Trust - OB']]
export const DEFAULT_WITHDRAWAL_VIEW={matter_status:[],case_status:[],case_type:[],metric:'matter_trust_funds',days:'90',selected:'',markers:true,open:true,show:'active',sort:'attention',query:''}
export function normalizeWithdrawalView(value={}){
 const v={...DEFAULT_WITHDRAWAL_VIEW,...value}
 for(const k of ['matter_status','case_status','case_type'])v[k]=Array.isArray(v[k])?[...new Set(v[k].filter(x=>typeof x==='string'))]:[]
 if(!WORKFLOW_GRAPH_TYPES.some(([id])=>id===v.metric))v.metric='matter_trust_funds'
 if(!['30','90','180','all'].includes(v.days))v.days='90'
 if(!['active','needs','waiting','paused','complete','all'].includes(v.show))v.show='active'
 if(!['attention','oldest','newest'].includes(v.sort))v.sort='attention'
 v.query=String(v.query||'');v.selected=String(v.selected||'');return v
}
export function matchesWithdrawalView(row,v){return ['matter_status','case_status','case_type'].every(k=>!v[k]?.length||v[k].includes(row[k]))}
const copy=v=>JSON.parse(JSON.stringify(v)),validId=v=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,89}$/.test(v),done=s=>['complete','cancelled'].includes(s?.status),stamp=()=>new Date().toISOString()
export function defaultWithdrawalDefinition(){
 const rows=[['preparation','Preparation'],['agreed','Agreed-order route'],['hearing','Hearing route'],['closeout','Signed order and closeout']].map(([id,name])=>({id,name}))
 const slots=[['motion_draft','Draft motion to withdraw','draft'],['notice_draft','Draft notice of hearing','draft'],['order_draft','Draft withdrawal order','draft'],['order_attorney_signed','Order with attorney signature','signed'],['motion_filed','File-stamped motion','filed'],['notice_filed','File-stamped notice','filed'],['order_client_signed','Order with client signature','signed'],['order_counsel_signed','Order with counsel / party signature','signed'],['order_judge_signed','Judge-signed withdrawal order','signed']].map(([id,name,kind])=>({id,name,kind}))
 const specs=[
 ['decision','Approve withdrawal','preparation','approve',[],[],[]],
 ['drafting','Prepare and approve motion / order','preparation','draft_document',['decision'],[],['motion_draft','order_draft']],
 ['filing','File motion and verify acceptance','preparation','efile_document',['drafting'],['motion_draft'],['motion_filed']],
 ['service','Verify initial service / delivery','preparation','draft_email',['filing'],['motion_filed'],[]],
 ['client_signature','Client signature / response','agreed','esign_document',['service'],['order_attorney_signed'],['order_client_signed']],
 ['opposing_signature','Counsel / pro se signature','agreed','esign_document',['service'],['order_client_signed'],['order_counsel_signed']],
 ['agreed_submission','Submit agreed order to court','agreed','draft_email',['client_signature','opposing_signature'],['order_counsel_signed'],[]],
 ['setting','Request and confirm setting','hearing','draft_email',['service'],['motion_filed'],[]],
 ['notice','Prepare hearing notice','hearing','draft_document',['setting'],[],['notice_draft']],
 ['notice_filing','File notice and verify acceptance','hearing','efile_document',['notice'],['notice_draft'],['notice_filed']],
 ['hearing','Hearing / submission outcome','hearing','calendar',['notice_filing'],['notice_filed'],[]],
 ['signed_order','Receive and verify signed order','closeout','review_document',['agreed_submission','hearing'],[],['order_judge_signed']],
 ['setting_cleanup','Review remaining court settings','closeout','calendar',[],[],[]],
 ['reply_review','Review new correspondence','closeout','draft_email',[],[],[]],
 ['status_update','Approve Order- Need to Close status','closeout','matter_status',['signed_order'],['order_judge_signed'],[]],
 ['closeout_email','Send signed order and client-file links','closeout','draft_email',['signed_order'],['order_judge_signed'],[]],
 ['close_workflow','Approve workflow completion','closeout','finish',['status_update','closeout_email'],['order_judge_signed'],[]]]
 const steps=specs.map(([id,name,row_id,action,depends_on,input_slots,output_slots])=>({id,name,row_id,action,depends_on,input_slots,output_slots,dependency_mode:id==='signed_order'?'any':'all',manual_start:['setting_cleanup','reply_review'].includes(id),template_id:'',output_files:{},recipient_roles:id==='client_signature'||id==='closeout_email'?['client']:id==='opposing_signature'?['opposing_counsel']:id==='service'?['client','opposing_counsel']:['agreed_submission','setting'].includes(id)?['court']:[],target_field:'matter_status',target_value:id==='status_update'?'Order- Need to Close':''}))
 return{version:1,name:'Withdrawal',rows,slots,steps,completion_slot:'order_judge_signed'}
}
export function validateWorkflowDefinition(def){
 if(!def||def.version!==1||!Array.isArray(def.rows)||!Array.isArray(def.steps)||!Array.isArray(def.slots))throw new Error('Invalid workflow definition.')
 if(!def.rows.length||def.rows.length>20||def.steps.length>100||def.slots.length>50)throw new Error('Use 1-20 rows, at most 100 steps and 50 document slots.')
 const check=(items,label)=>{const ids=new Set();for(const x of items){if(!validId(x.id)||ids.has(x.id)||!String(x.name||'').trim()||String(x.name).length>160)throw new Error('Each '+label+' needs a unique ID and a name (up to 160 characters).');ids.add(x.id)}return ids}
 const rows=check(def.rows,'row'),slots=check(def.slots,'slot'),steps=check(def.steps,'step')
 for(const s of def.steps){
  if(!rows.has(s.row_id)||!WORKFLOW_ACTIONS.some(a=>a.id===s.action))throw new Error('Choose a row and action for '+s.name+'.')
  for(const k of ['input_slots','output_slots','depends_on']){if(!Array.isArray(s[k]))throw new Error('Invalid '+k);for(const id of s[k])if(!(k==='depends_on'?steps:slots).has(id)||k==='depends_on'&&id===s.id)throw new Error('A reference in '+s.name+' no longer exists.')}
  if(!['all','any'].includes(s.dependency_mode))throw new Error('Choose all or any prerequisites.')
  if(s.action==='matter_status'&&!['matter_status','case_status'].includes(s.target_field))throw new Error('Choose a valid status field.')
 }
 const visiting=new Set(),visited=new Set();function visit(id){if(visiting.has(id))throw new Error('Steps cannot depend on each other in a loop.');if(visited.has(id))return;visiting.add(id);def.steps.find(s=>s.id===id).depends_on.forEach(visit);visiting.delete(id);visited.add(id)}
 def.steps.forEach(s=>visit(s.id));if(def.completion_slot!=='order_judge_signed'||!slots.has(def.completion_slot))throw new Error('Keep the judge-signed completion document slot.');return def
}
export function removeWorkflowSteps(def,ids){
 const next=copy(def),removed=new Set(ids),byId=new Map(def.steps.map(s=>[s.id,s]))
 function upstream(id,seen=new Set()){if(!removed.has(id))return[id];if(seen.has(id))return[];return(byId.get(id)?.depends_on||[]).flatMap(k=>upstream(k,new Set([...seen,id])))}
 next.steps=next.steps.filter(s=>!removed.has(s.id)).map(s=>({...s,depends_on:[...new Set(s.depends_on.flatMap(id=>upstream(id)))].filter(id=>id!==s.id)}));return validateWorkflowDefinition(next)
}
export function removeWorkflowRow(def,id){if(def.rows.length===1)throw new Error('Keep at least one row.');const next=removeWorkflowSteps(def,def.steps.filter(s=>s.row_id===id).map(s=>s.id));next.rows=next.rows.filter(r=>r.id!==id);return validateWorkflowDefinition(next)}
export function resolveWorkflowSlot(state,id){const versions=state.document_slots?.[id]?.versions||[];return versions.find(v=>v.id===state.document_slots[id].current_version)||null}
export function configureWorkflow(state,definition,at=stamp()){
 validateWorkflowDefinition(definition);const s=copy(state);s.definition=copy(definition);s.document_slots=s.document_slots||{};s.workspace_notes=s.workspace_notes||[]
 for(const d of definition.steps)if(!s.steps[d.id])s.steps[d.id]={status:'not_started',entered_at:at,attention_since:null,evidence:null,waiting_on:'',due_at:null,note:''}
 for(const d of definition.slots)if(!s.document_slots[d.id])s.document_slots[d.id]={versions:[],current_version:null}
 return advanceWorkflow(s,at)
}
function patchStep(s,id,patch,at){const old=s.steps[id],active=['needs_action','needs_approval'].includes(patch.status||old.status);s.steps[id]={...old,...patch,entered_at:patch.status&&patch.status!==old.status?at:old.entered_at,attention_since:active?(old.attention_since||at):null,...(patch.status==='complete'?{completed_at:at}:{})}}
export function workflowBlockReason(state,step){const missing=(step.input_slots||[]).filter(id=>!resolveWorkflowSlot(state,id)?.verified);return missing.length?'Needs input: '+missing.map(id=>state.definition.slots.find(s=>s.id===id)?.name||id).join(', '):''}
export function advanceWorkflow(s,at=stamp()){
 if(!s.definition||s.status!=='active')return s
 for(const d of s.definition.steps){const t=s.steps[d.id];if(t.status!=='not_started'||d.manual_start)continue;const deps=d.depends_on.map(id=>done(s.steps[id]));if(!deps.length||(d.dependency_mode==='any'?deps.some(Boolean):deps.every(Boolean)))patchStep(s,d.id,{status:'needs_action'},at)}return s
}
function attachVersion(s,slotId,e,at){
 if(!s.definition.slots.some(x=>x.id===slotId))throw new Error('Choose a document slot in this workflow.')
 if(!e.document_id||String(e.matter_id)!==String(s.matter_id))throw new Error('Select a saved document from this matter.')
 if(e.verified&&!e.confirmed)throw new Error('Review and confirm the actual document first.')
 const container=s.document_slots[slotId]||{versions:[]};if(container.versions.length>=100)throw new Error('This slot has 100 versions. Archive the process before adding more.')
 const version={id:e.version_id||e.document_id+'-'+at+'-'+container.versions.length,document_id:String(e.document_id),name:String(e.name||'Document'),matter_id:String(s.matter_id),verified:!!e.verified,recorded_at:at,source_step:e.step_id||'',source:String(e.source||'Attorney selected document')}
 s.document_slots[slotId]={...container,versions:[...container.versions,version],current_version:version.id};s.linked_documents=[...new Set([...(s.linked_documents||[]),version.document_id])]
}
export function applyWorkflowBlockEvent(current,e,at=stamp()){
 if(e.type==='workflow_configure'){if(current.status!=='active'||!e.confirmed)throw new Error('Confirm changes to an active workflow.');return configureWorkflow(current,e.definition,at)}
 if(!current.definition||['workflow_release','workflow_reactivate'].includes(e.type))return null
 if(current.status!=='active')throw new Error('This workflow is closed.')
 if(e.source_key&&current.source_versions?.[e.source_key]===e.source_version)return current
 const s=copy(current),d=s.definition.steps.find(x=>x.id===e.step_id),t=d?s.steps[d.id]:null
 if(s.paused&&!['workspace_pause','step_note','email_received','efile_update','email_sent'].includes(e.type))throw new Error('Resume this withdrawal before changing a step.')
 switch(e.type){
  case'slot_attach':attachVersion(s,e.slot_id,e,at);break
  case'slot_verify':{const v=resolveWorkflowSlot(s,e.slot_id);if(!v||!e.confirmed)throw new Error('Review and confirm the document first.');v.verified=true;v.verified_at=at;break}
  case'step_config':if(!t)throw new Error('Step no longer exists.');s.steps[d.id]={...t,template_id:e.template_id??t.template_id,recipient_ids:e.recipient_ids??t.recipient_ids,email_subject:e.email_subject??t.email_subject,email_body:e.email_body??t.email_body,signature_url:e.signature_url??t.signature_url,output_files:e.output_files??t.output_files};break
  case'workspace_pause':if(typeof e.paused!=='boolean')throw new Error('Choose pause or resume.');s.paused=e.paused;s.paused_at=e.paused?at:null;break
  case'step_note':if(!t||!String(e.note||'').trim())throw new Error('Choose a step and enter a note.');if(s.workspace_notes.length>=200)throw new Error('Note limit reached. Use matter documents.');s.workspace_notes.push({step_id:d.id,note:String(e.note).slice(0,4000),created_at:at});break
  case'start_date':if(!e.reason?.trim()||!Number.isFinite(Date.parse(e.started_at))||Date.parse(e.started_at)>Date.parse(at))throw new Error('Enter a valid past date and reason.');s.started_at=e.started_at;break
  case'module_opened':if(!t)throw new Error('Step no longer exists.');s.steps[d.id]={...t,input_versions:e.input_versions||t.input_versions||[]};break
  case'step_update':{
   if(!t||!['needs_action','needs_approval','waiting','complete','cancelled'].includes(e.status))throw new Error('Choose a valid step and status.')
   if(e.status==='waiting'&&(!e.waiting_on?.trim()||!Number.isFinite(Date.parse(e.due_at))))throw new Error('State who / what is awaited and a follow-up date.')
   if(e.status==='complete'){
    if(!e.confirmed||!e.evidence?.reference?.trim())throw new Error('Confirm completion and record a reference.')
    if(t.status==='not_started'&&!e.historical_confirmed)throw new Error('Complete prerequisites or confirm historical completion.')
    for(const[slot_id,output]of Object.entries(e.outputs||{})){if(!d.output_slots.includes(slot_id))throw new Error('Output slot is not assigned to this step.');attachVersion(s,slot_id,{...output,step_id:d.id,matter_id:s.matter_id,verified:true,confirmed:true},at)}
    const missing=d.output_slots.filter(id=>!resolveWorkflowSlot(s,id)?.verified)
    if(missing.length&&(!e.historical_confirmed||missing.includes(s.definition.completion_slot)))throw new Error('Supply and verify the output document(s): '+missing.map(id=>s.definition.slots.find(x=>x.id===id)?.name).join(', '))
    if(!e.historical_confirmed&&workflowBlockReason(s,d))throw new Error(workflowBlockReason(s,d))
    if(d.action==='matter_status'&&!e.status_write_confirmed)throw new Error('Use Approve status change to update the actual matter.')
    if(d.action==='finish'){
     if(!resolveWorkflowSlot(s,s.definition.completion_slot)?.verified)throw new Error('Verify the judge-signed withdrawal order before completing the process.')
     if(s.definition.steps.some(x=>x.id!==d.id&&!done(s.steps[x.id])&&(!x.manual_start||s.steps[x.id].status!=='not_started')))throw new Error('Complete or explicitly cancel the remaining active steps first.')
     s.status='complete'
    }
   }
   patchStep(s,d.id,{status:e.status,note:String(e.note||''),evidence:e.evidence||t.evidence,waiting_on:e.status==='waiting'?e.waiting_on:'',due_at:e.due_at||null},at);break
  }
  case'documents_saved':{
   if(!t||d.action!=='draft_document')throw new Error('Drafting step no longer matches this saved document. Link the file manually; do not regenerate it.')
   if(done(t))throw new Error('Draft saved to Documents, but its workflow step is already finished. Reopen the step before linking a replacement.')
   s.linked_documents=[...new Set([...(s.linked_documents||[]),...(e.document_ids||[])])]
   patchStep(s,d.id,{status:'needs_approval',candidate_documents:e.document_ids||[],note:'Drafts saved. Assign any unmapped outputs and review the actual files.'},at)
   const docs=e.documents||[]
   for(const slot of d.output_slots){const name=(t.output_files||d.output_files)?.[slot],document=name?docs.find(x=>x.source_file_name===name):d.output_slots.length===1&&docs.length===1?docs[0]:null;if(document)attachVersion(s,slot,{...document,document_id:document.id,matter_id:s.matter_id,step_id:d.id,verified:false,source:'Generated from linked drafting template'},at)}break
  }
  case'efile_update':if(!t)throw new Error('Filing result belongs to a retired step. Review saved filing history.');if(done(t))return current;patchStep(s,d.id,{status:e.status==='accepted'?'needs_approval':['failed','rejected'].includes(e.status)?'needs_action':'waiting',waiting_on:e.status==='accepted'?'File-stamped output for review':'Filing provider / clerk',due_at:new Date(Date.parse(at)+86400000).toISOString(),note:'Filing status: '+e.status+'. Acceptance does not populate a file-stamped slot without the actual file.',evidence:{reference:e.reference||''}},at);break
  case'email_sent':if(!t)throw new Error('Email belongs to a retired step.');if(done(t))return current;patchStep(s,d.id,{status:'waiting',last_outbound_at:at,waiting_on:d.action==='esign_document'?'Signed document from selected recipient(s)':'Email response / delivery confirmation',due_at:new Date(Date.parse(at)+7*86400000).toISOString(),evidence:{reference:e.reference||e.email_id},note:'Send recorded; awaiting response / delivery. Not proof of a signature.'},at);break
  case'email_received':if(!t)throw new Error('Email belongs to a retired step.');if(t.last_inbound_at&&String(e.received_at)<=t.last_inbound_at)return current;patchStep(s,d.id,{status:'needs_approval',last_inbound_at:e.received_at||at,note:'New correspondence received. Review it and attach any actual returned document.',evidence:{reference:e.message_id}},at);break
  default:throw new Error('This workflow action is not supported by the block editor. Refresh and review the step before continuing.')
 }
 if(e.source_key)s.source_versions={...s.source_versions,[e.source_key]:e.source_version};return advanceWorkflow(s,at)
}
export function workflowBlockAttention(s,now=Date.now()){
 if(!s?.definition)return null
 if(s.status==='released'||s.status==='complete')return{kind:s.status,needsMe:false,next:s.status==='released'?'Released from withdrawal':'Complete',waiting:[],since:null}
 if(s.paused)return{kind:'paused',needsMe:false,next:'Paused - resume when ready',waiting:[],since:null}
 const tasks=s.definition.steps.map(d=>({d,t:s.steps[d.id]})),actionable=tasks.filter(({t})=>['needs_action','needs_approval'].includes(t.status)||t.status==='waiting'&&t.due_at&&Date.parse(t.due_at)<=now)
 actionable.sort((a,b)=>(Date.parse(a.t.attention_since||a.t.due_at)||now)-(Date.parse(b.t.attention_since||b.t.due_at)||now))
 const first=actionable[0],waiting=tasks.filter(({t})=>t.status==='waiting').map(({t})=>t.waiting_on).filter(Boolean)
 return{kind:first?'needs':'waiting',needsMe:!!first,count:actionable.length,step_id:first?.d.id,since:first?.t.attention_since||first?.t.due_at||null,next:first?(workflowBlockReason(s,first.d)||first.d.name):(waiting.join('; ')||'No active step - review prerequisites / start a manual step'),waiting}
}
