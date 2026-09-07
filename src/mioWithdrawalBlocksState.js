import {newWithdrawal,applyWithdrawalEvent as legacyApply} from './mioWithdrawalWorkspaceState.js'
import {applyWorkflowBlockEvent} from './mioWorkflowBlocks.js'
export {newWithdrawal}
export function applyWithdrawalEvent(state,event,at){
 const next=applyWorkflowBlockEvent(state,event,at)
 return next===null?legacyApply(state,event,at):next
}
