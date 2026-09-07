import {WORKFLOW_GRAPH_TYPES,actionFor,resolveWorkflowSlot} from './mioWorkflowBlocks.js'
export const viewKey='caseMioWithdrawalViewV305',definitionKey='caseMioWithdrawalDefinitionV305'
export const stepFinished=t=>['complete','cancelled'].includes(t?.status)
export function graphValue(row,metric){
 const trust=Number(row.trust),wip=Number(row.wip),ob=Number(row.outstanding),min=Number(row.minimum)
 const values={matter_trust_funds:trust,trust_minus_minimum:trust-min,trust_minus_minimum_minus_wip:trust-wip-min,trust_minus_wip_minus_outstanding_minus_minimum:trust-ob-wip-min,trust_minus_outstanding:trust-ob}
 return values[metric]
}
export function clipGraphPoints(points,days,now=Date.now()){
 const sorted=(points||[]).filter(p=>Number.isFinite(Date.parse(p.date))&&Number.isFinite(p.balance)).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))
 if(days==='all')return sorted
 const from=now-Number(days)*86400000,prior=sorted.filter(p=>Date.parse(p.date)<from).at(-1)
 return [...(prior?[{...prior,date:new Date(from).toISOString(),graph_event_label:'Last recorded balance carried into this range'}]:[]),...sorted.filter(p=>Date.parse(p.date)>=from)]
}
export function stepOutputsReady(state,step){return step.output_slots.length>0&&step.output_slots.every(id=>resolveWorkflowSlot(state,id)?.verified)}
export function stepPrimary(state,step){
 const t=state.steps[step.id],a=actionFor(step.action)
 if(stepFinished(t))return {label:'Review completed step',mode:'review'}
 if(step.action==='finish'||step.action==='approve'||step.action==='manual')return {label:a.button,mode:'complete'}
 if(step.action==='matter_status')return {label:'Approve status change',mode:'action'}
 if(stepOutputsReady(state,step))return {label:'Approve & complete step',mode:'complete'}
 if(step.action==='review_document')return {label:step.output_slots.length?'Attach / review returned document':'Mark review complete',mode:step.output_slots.length?'documents':'complete'}
 return {label:a.button,mode:'action'}
}
export function effectiveTemplate(state,step,profile={}){return state.steps[step.id]?.template_id||step.template_id||profile.withdrawal_templates?.[step.id==='notice'?'notice':'motion']||''}
export function collectInputVersions(state,step){return step.input_slots.map(slot_id=>({slot_id,...resolveWorkflowSlot(state,slot_id)}))}
export function selectedRecipients(people,ids){return (ids||[]).map(id=>people.find(p=>p.key===id)).filter(Boolean)}
export function nextStepSummary(state,step){
 const action=actionFor(step.action),required=step.input_slots.map(id=>state.definition.slots.find(s=>s.id===id)?.name||id)
 return {action:action.label,required,outputs:step.output_slots.map(id=>state.definition.slots.find(s=>s.id===id)?.name||id)}
}
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export function workflowFlowHtml(definition){
 const steps=definition.steps,slot=id=>definition.slots.find(s=>s.id===id)?.name||id
 const rows=definition.rows.map(row=>'<h2>'+esc(row.name)+'</h2><table><thead><tr><th>Step / action</th><th>Starts after</th><th>Input documents</th><th>Required to complete</th><th>What happens next</th></tr></thead><tbody>'+steps.filter(s=>s.row_id===row.id).map(s=>{
 const next=steps.filter(n=>n.depends_on.includes(s.id)).map(n=>n.name)
 const completion=s.output_slots.length?'Review and connect: '+s.output_slots.map(slot).join('; ')+'. Then approve completion.':'Confirm the task is done. Sending or submitting does not prove delivery, acceptance, or a signature.'
 return '<tr><td>'+esc(s.name)+'<br><small>'+esc(actionFor(s.action).label)+'</small></td><td>'+esc(s.manual_start?'Manual start':(s.depends_on.length?(s.dependency_mode==='any'?'Any of: ':'All of: ')+s.depends_on.map(id=>steps.find(x=>x.id===id)?.name||id).join('; '):'Process begins'))+'</td><td>'+esc(s.input_slots.map(slot).join('; ')||'None')+'</td><td>'+esc(completion)+'</td><td>'+esc(next.length?'Activate eligible step(s) and show the next action: '+next.join('; '):'Return to the remaining active steps or the completion summary.')+'</td></tr>'
 }).join('')+'</tbody></table>').join('')
 return '<!doctype html><html lang="en"><meta charset="utf-8"><title>Mio withdrawal flow sheet</title><style>body{font:14px Arial;line-height:1.45;margin:28px;color:#142c41}table{border-collapse:collapse;width:100%;margin-bottom:24px}th,td{border:1px solid #bac6d1;padding:8px;text-align:left;vertical-align:top}th{background:#edf3f7}h2{break-after:avoid}tr{break-inside:avoid}thead{display:table-header-group}@media print{body{margin:12mm}}</style><h1>Withdrawal workflow - current definition</h1><p>After you complete a step, Mio activates eligible prerequisites and presents the next action. Drafting opens the selected template and generates a preview after your request. You must save and review the result. E-filing opens a reviewed-PDF package for service contacts, filing codes and final authorization. Email opens a proposed message and attachments for review before sending. Signature invitations require a real signing-provider link; the returned signed file must be reviewed. These are approval handoffs, not an unattended background agent.</p><p>Document slots belong to the whole process. Input versions are recorded when an action opens; generated files can populate mapped output slots. File-stamped and signed outputs require the actual saved file, not a status label. Historical completion records your confirmation without resending or fabricating missing files. The judge-signed order is still required to close the process.</p>'+rows+'</html>'
}
export function downloadWorkflowFlow(definition){const url=URL.createObjectURL(new Blob([workflowFlowHtml(definition)],{type:'text/html;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='Mio-Withdrawal-Flow-Sheet.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
