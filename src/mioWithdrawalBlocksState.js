import {newWithdrawal,applyWithdrawalEvent as legacyApply} from './mioWithdrawalWorkspaceState.js'
import {applyWorkflowBlockEvent} from './mioWorkflowBlocks.js'
export {newWithdrawal}
export function applyWithdrawalEvent(state,event,at){
 if(state.definition&&event.type==='step_update'&&event.step_id==='closeout_email'&&event.status==='complete'&&!event.historical_confirmed){
  const step=state.steps.closeout_email
  if(!step?.links_verified||!['invoices','efilings','documents'].every(k=>/^https:\/\/[^\s]+$/.test(step.client_links?.[k]||'')))throw new Error('Verify the client-accessible invoice, e-filing and document links before completing delivery.')
 }
 const next=applyWorkflowBlockEvent(state,event,at)
 if(next===null)return legacyApply(state,event,at)
 if(event.type==='step_config'&&next.steps[event.step_id])return {...next,steps:{...next.steps,[event.step_id]:{...next.steps[event.step_id],client_links:event.client_links??next.steps[event.step_id].client_links,links_verified:event.links_verified??next.steps[event.step_id].links_verified}}}
 return next
}
