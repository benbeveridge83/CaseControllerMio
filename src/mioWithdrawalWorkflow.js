// No provider operation is inferred from navigation or from a checked legacy box.
export const WITHDRAWAL_STEPS = [
  ['decision','Approve withdrawal','review','Preparation'],
  ['drafting','Prepare and approve motion / order','drafting','Preparation'],
  ['filing','File motion and verify acceptance','efile','Preparation'],
  ['service','Verify initial service / delivery','email','Preparation'],
  ['client_signature','Client signature / response','email','Agreed-order route'],
  ['opposing_signature','Counsel / pro se signature','email','Agreed-order route'],
  ['agreed_submission','Submit agreed order to court','email','Agreed-order route'],
  ['setting','Request and confirm setting','email','Hearing route'],
  ['notice','Draft, file, serve and mail hearing notice','drafting','Hearing route'],
  ['hearing','Hearing / submission outcome','calendar','Hearing route'],
  ['signed_order','Receive and verify signed order','documents','Signed order and closeout'],
  ['setting_cleanup','Review remaining court settings','need_to_set','Signed order and closeout'],
  ['reply_review','Review new correspondence','email','Signed order and closeout'],
  ['status_update','Approve Order Need to Close status','status','Signed order and closeout'],
  ['closeout_email','Send signed order and client-file links','email','Signed order and closeout'],
  ['close_workflow','Approve workflow completion','review','Signed order and closeout']
].map(([id,name,module,lane])=>({id,name,module,lane}))
export const STEP_STATUSES=['not_started','needs_action','needs_approval','waiting','complete','cancelled']
export const STATUS_LABELS={not_started:'Not started',needs_action:'Needs my action',needs_approval:'Needs my review / approval',waiting:'Waiting - no action now',complete:'Complete',cancelled:'Not active / superseded'}
const active=s=>['needs_action','needs_approval'].includes(s)
export const timestamp=v=>{const n=Date.parse(v||'');return Number.isFinite(n)?n:null}
const after=(at,days)=>new Date(timestamp(at)+days*86400000).toISOString()
const cleared=s=>['not_started','complete','cancelled'].includes(s)
export function newWithdrawal(matterId,startedAt=null,at=new Date().toISOString()) {
  if(!matterId)throw new Error('Select a matter.')
  if(startedAt&&(timestamp(startedAt)===null||timestamp(startedAt)>timestamp(at)))throw new Error('Use a valid withdrawal-entry date, not a future date.')
  return {schema_version:1,matter_id:String(matterId),status:'active',started_at:startedAt||null,routes:{agreed:true,hearing:true},
    steps:Object.fromEntries(WITHDRAWAL_STEPS.map(s=>[s.id,{status:s.id==='decision'?'needs_approval':'not_started',entered_at:at,attention_since:s.id==='decision'?at:null,due_at:null,waiting_on:'',note:'',evidence:null}])),
    source_versions:{},linked_documents:[],closeout:{links:{},links_verified:false}}
}
function setStep(state,id,patch,at) {
  const old=state.steps[id];if(!old)throw new Error('Unknown withdrawal step.')
  const next={...old,...patch}
  if(next.status!==old.status)next.entered_at=at
  next.attention_since=active(next.status)?(active(old.status)?old.attention_since||at:at):null
  if(next.status==='complete')next.completed_at=old.completed_at||at
  else if(old.status==='complete')next.completed_at=null
  state.steps[id]=next
}
function advance(s,at) {
  const done=id=>s.steps[id].status==='complete'
  const start=(id,patch={})=>{if(s.steps[id].status==='not_started')setStep(s,id,{status:'needs_action',...patch},at)}
  if(done('decision'))start('drafting')
  if(done('drafting'))start('filing')
  if(done('filing'))start('service')
  if(done('service')){if(s.routes.agreed){start('client_signature');start('opposing_signature')}if(s.routes.hearing)start('setting')}
  if(s.routes.agreed&&done('client_signature')&&done('opposing_signature'))start('agreed_submission',{status:'needs_approval'})
  if(s.routes.hearing&&done('setting'))start('notice')
  if(s.routes.hearing&&done('notice'))start('hearing',{status:'waiting',waiting_on:'Scheduled hearing / submission',due_at:s.steps.setting.due_at})
  if(done('agreed_submission')||done('hearing'))start('signed_order',{status:'waiting',waiting_on:'Court signed order',due_at:after(at,7)})
  if(done('signed_order')){
    start('status_update',{status:'needs_approval'});start('closeout_email')
    for(const id of ['client_signature','opposing_signature','agreed_submission','setting','notice','hearing']){
      if(!cleared(s.steps[id].status)){
        if(['setting','notice','hearing'].includes(id))start('setting_cleanup')
        setStep(s,id,{status:'cancelled',note:'Signed order verified. Superseded internally; external court settings are NOT automatically cancelled.'},at)
      }
    }
    if(s.steps.setting.due_at&&!done('hearing'))start('setting_cleanup')
  }
  if(['signed_order','status_update','closeout_email'].every(done)&&['setting_cleanup','reply_review'].every(id=>cleared(s.steps[id].status)))start('close_workflow',{status:'needs_approval'})
  if(done('close_workflow'))s.status='complete'
}
export function applyWithdrawalEvent(current,e,at=new Date().toISOString()) {
  if(!current||!e?.type)throw new Error('Workflow and event are required.')
  if(current.status!=='active')throw new Error('This workflow is closed.')
  if(e.source_key&&current.source_versions[e.source_key]===e.source_version)return current
  const s=JSON.parse(JSON.stringify(current)),id=e.step_id,step=s.steps[id]
  switch(e.type){
    case 'start_date':
      if(!e.reason?.trim()||timestamp(e.started_at)===null||timestamp(e.started_at)>timestamp(at))throw new Error('Provide a valid historical date and its source / reason.')
      s.started_at=e.started_at;break
    case 'routes':{
      if(!e.reason?.trim()||(!e.agreed&&!e.hearing))throw new Error('Keep at least one route and record the reason.')
      const old=s.routes;s.routes={agreed:!!e.agreed,hearing:!!e.hearing}
      for(const d of WITHDRAWAL_STEPS){const route=d.lane==='Agreed-order route'?'agreed':d.lane==='Hearing route'?'hearing':'';if(!route)continue
        if(!s.routes[route]&&s.steps[d.id].status==='not_started')setStep(s,d.id,{status:'cancelled',note:e.reason},at)
        else if(!s.routes[route]&&!['complete','cancelled'].includes(s.steps[d.id].status))setStep(s,d.id,{status:'needs_action',note:'Review outstanding work before stopping this route: '+e.reason},at)
        else if(s.routes[route]&&!old[route]&&s.steps[d.id].status==='cancelled'&&!s.steps[d.id].evidence)setStep(s,d.id,{status:'not_started',note:'Route re-enabled: '+e.reason},at)
      }break
    }
    case 'step_update':{
      if(!step||!STEP_STATUSES.includes(e.status)||e.status==='not_started')throw new Error('Choose a valid step status.')
      if(!e.note?.trim())throw new Error('Describe the update or evidence.')
      if(e.status==='waiting'&&(!e.waiting_on?.trim()||timestamp(e.due_at)===null))throw new Error('Specify what you are waiting on and when to follow up.')
      if(e.due_at&&timestamp(e.due_at)===null)throw new Error('Invalid date and time.')
      if(e.status==='complete'){
        if(!e.confirmed||!e.evidence?.reference?.trim())throw new Error('Completion needs your confirmation and an evidence reference.')
        if(step.status==='not_started'&&!e.historical_confirmed)throw new Error('Complete preceding steps, or attest that this is verified historical work.')
        if(id==='signed_order'&&!e.evidence.document_id)throw new Error('Select the actual signed-order document.')
        if(id==='setting'&&timestamp(e.due_at)===null)throw new Error('Record the confirmed hearing / submission date.')
        if(id==='status_update'&&!e.status_write_confirmed)throw new Error('Use the case-status approval button to update the matter itself.')
        if(id==='closeout_email'){
          if(!e.delivery_confirmed||!s.closeout.links_verified||!s.closeout.sent_at)throw new Error('Verify that the signed order and required links were sent and delivered.')
          s.closeout.delivery_confirmed=true
        }
        if(id==='close_workflow'&&(!['signed_order','status_update','closeout_email'].every(key=>s.steps[key].status==='complete')||!['setting_cleanup','reply_review'].every(key=>cleared(s.steps[key].status))))throw new Error('Complete signed-order, status, client-delivery and remaining review requirements first.')
      }
      setStep(s,id,{status:e.status,note:e.note,waiting_on:e.status==='waiting'?e.waiting_on:'',due_at:e.due_at||null,evidence:e.evidence||step.evidence},at);break
    }
    case 'documents_saved':
      if(!['drafting','notice'].includes(id))throw new Error('Invalid drafting step.')
      s.linked_documents=[...new Set([...s.linked_documents,...(e.document_ids||[])])]
      setStep(s,id,{status:'needs_approval',note:'New documents saved. Review the actual files; saving is not approval.',evidence:{reference:(e.document_ids||[]).join(', ')}},at);break
    case 'email_sent':
      if(!step)throw new Error('Unknown email step.')
      setStep(s,id,{status:'waiting',last_outbound_at:at,waiting_on:e.waiting_on||'Email response / delivery confirmation',due_at:after(at,7),note:'Send recorded; this is NOT proof of delivery.',evidence:{reference:e.reference||e.email_id}},at)
      if(id==='closeout_email'){s.closeout.sent_at=at;s.closeout.email_id=e.email_id;s.closeout.delivery_confirmed=false}
      if(id==='service')setStep(s,id,{status:'needs_approval',note:'Service email sent. Verify all recipients, enclosures and delivery; a single send does not complete service.'},at)
      break
    case 'email_received':{
      if(!step)throw new Error('Unknown email step.')
      const received=timestamp(e.received_at);if(received===null||received>timestamp(at))throw new Error('Invalid incoming-message time.')
      if((timestamp(step.last_outbound_at)!==null&&received<=timestamp(step.last_outbound_at))||(timestamp(step.last_incoming_at)!==null&&received<=timestamp(step.last_incoming_at)))return current
      s.steps[id].last_incoming_at=e.received_at
      setStep(s,['complete','cancelled'].includes(step.status)?'reply_review':id,{status:'needs_approval',source_step_id:id,note:'New reply received. Review it and decide the next action.',evidence:{reference:e.message_id}},e.received_at);break
    }
    case 'efile_update':
      if(!step)throw new Error('Unknown eFile step.')
      setStep(s,id,{status:e.status==='submitted'?'waiting':'needs_action',waiting_on:e.status==='submitted'?'Clerk acceptance / service confirmation':'',due_at:e.status==='submitted'?after(at,3):null,note:'eFile status: '+e.status+'. Verify provider evidence; submission is not acceptance.',evidence:{reference:e.reference}},at);break
    case 'closeout_details':
      for(const key of ['invoices','efilings','documents']){let url;try{url=new URL(e.links?.[key])}catch{throw new Error('Provide a client-accessible '+key+' link.')};if(url.protocol!=='https:'||url.username||url.password)throw new Error('Use HTTPS sharing links without embedded credentials.')}
      if(!e.links_verified)throw new Error('Confirm these links work for this client and expose only this matter.')
      if(!e.subject?.trim()||!['invoices','efilings','documents'].every(key=>e.body?.includes(e.links[key])))throw new Error('The prepared email must contain a subject and all three resource links.')
      s.closeout={links:e.links,links_verified:true,subject:e.subject,body:e.body,sent_at:null,delivery_confirmed:false}
      if(s.steps.closeout_email.status==='complete')setStep(s,'closeout_email',{status:'needs_action',note:'Client closeout changed; review and resend the revised content.'},at)
      break
    case 'module_opened':break
    default:throw new Error('Unknown workflow event.')
  }
  if(e.source_key)s.source_versions[e.source_key]=e.source_version
  advance(s,at);return s
}
export function workflowAttention(s,now=Date.now()) {
  if(!s)return{kind:'needs_action',needsMe:true,since:null,next:'Confirm current progress',step_id:'decision',waiting:[]}
  if(s.status==='complete')return{kind:'complete',needsMe:false,since:null,next:'Complete',waiting:[]}
  const actions=[],waiting=[]
  for(const d of WITHDRAWAL_STEPS){const step=s.steps[d.id];if(!step)continue
    if(active(step.status))actions.push({kind:step.status,since:timestamp(step.attention_since),next:d.name,step_id:d.id})
    else if(step.status==='waiting'){const due=timestamp(step.due_at);if(due!==null&&due<=now)actions.push({kind:'needs_action',since:due,next:'Follow up: '+d.name,step_id:d.id,overdue:true});else waiting.push(step.waiting_on||d.name)}
  }
  actions.sort((a,b)=>(a.since??Infinity)-(b.since??Infinity))
  return actions.length?{...actions[0],needsMe:true,count:actions.length,waiting}:waiting.length?{kind:'waiting',needsMe:false,since:null,next:'No action now - waiting',waiting}:{kind:'needs_action',needsMe:true,since:null,next:'Review workflow configuration',waiting}
}
export function sortWithdrawalRows(rows,mode='attention',now=Date.now()) {
  return [...rows].sort((a,b)=>{
    const aa=workflowAttention(a.state,now),bb=workflowAttention(b.state,now)
    if(mode==='attention'){const priority=Number(bb.needsMe)-Number(aa.needsMe);if(priority)return priority;if(aa.needsMe&&bb.needsMe){const age=(aa.since??Infinity)-(bb.since??Infinity);if(age&&!Number.isNaN(age))return age}}
    const ta=timestamp(a.state?.started_at||a.started_at),tb=timestamp(b.state?.started_at||b.started_at)
    if(ta===null&&tb!==null)return 1;if(tb===null&&ta!==null)return -1
    if(ta!==null&&tb!==null&&ta!==tb)return mode==='newest'?tb-ta:ta-tb
    return String(a.name||a.matter_id).localeCompare(String(b.name||b.matter_id))
  })
}
export function ageLabel(value,now=Date.now()) {const t=typeof value==='number'?value:timestamp(value);if(t===null||!Number.isFinite(t))return 'Unknown';const days=Math.floor(Math.max(0,now-t)/86400000);return days?`${days} day${days===1?'':'s'}`:'Today'}
