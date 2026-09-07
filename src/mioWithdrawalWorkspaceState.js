import {newWithdrawal,applyWithdrawalEvent as baseApply,workflowAttention as baseAttention,sortWithdrawalRows as baseSort} from './mioWithdrawalWorkflow.js'
export {newWithdrawal}
export const completionLabels={decision:'Confirm withdrawal decision',drafting:'Motion / order reviewed and approved',filing:'Document e-filed and acceptance verified',service:'Service / delivery verified',client_signature:'Client signature / response reviewed',opposing_signature:'Counsel / party signature reviewed',agreed_submission:'Agreed order submitted to court',setting:'Hearing / submission date confirmed',notice:'Hearing notice filed and served',hearing:'Hearing / submission completed',signed_order:'Signed withdrawal order received',setting_cleanup:'Remaining court settings resolved',reply_review:'Correspondence reviewed',status_update:'Approve Order Need to Close',closeout_email:'Signed order and file links delivered',close_workflow:'Mark withdrawal complete'}
export const moduleLabels={drafting:'Yes, draft using this template',efile:'Prepare e-filing for review',email:'Open linked email',documents:'Open matter documents',calendar:'Open calendar',need_to_set:'Review court settings'}
export function canCompleteWithdrawal(s){return !!s&&!s.paused&&['signed_order','status_update','closeout_email'].every(k=>s.steps[k].status==='complete')&&['setting_cleanup','reply_review'].every(k=>['not_started','complete','cancelled'].includes(s.steps[k].status))}
export function applyWithdrawalEvent(current,event,at=new Date().toISOString()){
 if(!current||!event?.type)return baseApply(current,event,at)
 if(current.status!=='active')throw new Error('This workflow is closed.')
 if(event.source_key&&current.source_versions[event.source_key]===event.source_version)return current
 if(event.type==='workspace_pause'){
  if(typeof event.paused!=='boolean')throw new Error('Choose pause or resume.')
  return {...current,paused:event.paused,paused_at:event.paused?at:null}
 }
 if(event.type==='step_note'){
  if(!current.steps[event.step_id])throw new Error('Unknown withdrawal step.')
  const note=String(event.note||'').trim();if(!note||note.length>4000)throw new Error('Enter a note of 1 to 4,000 characters.')
  const notes=current.workspace_notes||[];if(notes.length>=200)throw new Error('This workflow has reached its note limit. Use the matter Documents for further detailed notes.')
  return {...current,workspace_notes:[...notes,{step_id:event.step_id,note,created_at:at}]}
 }
 if(current.paused&&!['email_received','email_sent','efile_update'].includes(event.type))throw new Error('Resume this withdrawal before changing a step.')
 if(event.type==='historical_complete'){
  const step=current.steps[event.step_id]
  if(!step)throw new Error('Unknown withdrawal step.')
  if(['complete','cancelled'].includes(step.status))return current
  if(!event.confirmed)throw new Error('Confirm that this step was already completed.')
  const reference=String(event.reference||'Attorney marked this step as already completed in Mio').trim()
  const s=JSON.parse(JSON.stringify(current))
  s.steps[event.step_id]={...s.steps[event.step_id],status:'complete',attention_since:null,waiting_on:'',due_at:null,note:String(event.note||'Already completed before or outside this workflow.'),evidence:{...(s.steps[event.step_id].evidence||{}),reference},completed_at:at,entered_at:at,historical_confirmed:true}
  return baseApply(s,{type:'module_opened',step_id:event.step_id},at)
 }
 if(event.type==='template_link'||event.type==='document_link'){
  const step=current.steps[event.step_id]
  if(!step||!(event.type==='document_link'?['drafting','notice','filing']:['drafting','notice']).includes(event.step_id)||['complete','cancelled'].includes(step.status))throw new Error('Link documents or templates to an unfinished drafting step.')
  const patch=event.type==='template_link'?{template_id:String(event.template_id||'')}:{document_ids:[...new Set((event.document_ids||[]).map(String))]}
  if(patch.document_ids?.length>30)throw new Error('Link at most 30 documents to a step.')
  return {...current,steps:{...current.steps,[event.step_id]:{...step,...patch}},linked_documents:patch.document_ids?[...new Set([...(current.linked_documents||[]),...patch.document_ids])]:current.linked_documents}
 }
 const next=baseApply(current,event,at)
 if(event.type==='documents_saved'&&next!==current)return {...next,steps:{...next.steps,[event.step_id]:{...next.steps[event.step_id],document_ids:[...new Set((event.document_ids||[]).map(String))]}}}
 return next
}
export function workflowAttention(s,now){return s?.paused&&s.status!=='complete'?{kind:'paused',needsMe:false,since:null,next:'Paused - resume when ready',waiting:[]}:baseAttention(s,now)}
export function sortWithdrawalRows(rows,mode,now){const sorted=baseSort(rows,mode,now);return mode==='attention'?[...sorted.filter(r=>!r.state?.paused),...sorted.filter(r=>r.state?.paused)]:sorted}
export function nextPrompt(s,id){
 const step=s?.steps?.[id]
 if(s?.paused)return 'This withdrawal is paused. Notes remain available; resume to continue the steps.'
 if(id==='drafting')return step?.document_ids?.length?'Draft saved or linked. Review the document, then mark this step complete.':'Withdrawal decision complete. The next step is to draft the motion / order. Use the connected template?'
 if(id==='filing')return 'Draft complete. Next: e-file the reviewed PDF. If it was already filed, use Already completed.'
 if(id==='notice')return 'Use the connected hearing-notice template, then verify filing, service and any required mailing. If already done, use Already completed.'
 return ''
}
export function withdrawalTimeEntries(entries,matterId){return (entries||[]).filter(e=>String(e.matter_id)===String(matterId)&&/^Withdrawal - /.test(e.matter_step||'')).sort((a,b)=>String(b.date||b.created_at||'').localeCompare(String(a.date||a.created_at||'')))}
