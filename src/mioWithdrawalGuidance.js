export const WITHDRAWAL_GUIDANCE = {
  decision:{action:'Review the withdrawal candidate and approve moving forward.',mio:'Once approved, Mio opens the drafting step.'},
  drafting:{action:'Review and approve the motion to withdraw and proposed order.',mio:'Mio opens the linked withdrawal templates and carries the matter data into Drafting.'},
  filing:{action:'File the motion/order packet and verify the clerk accepted it.',mio:'Mio links the eFile job and watches recorded filing-status updates.'},
  service:{action:'Verify the withdrawal papers were sent to every required recipient and that delivery is supported.',mio:'Mio prepares the linked email/service workspace and records outgoing activity.'},
  client_signature:{action:'Review the client response/signature and decide whether the agreed-order route can continue.',mio:'Mio waits for and surfaces a linked client reply.'},
  opposing_signature:{action:'Review opposing counsel/pro se response or signature.',mio:'Mio waits for and surfaces a linked reply.'},
  agreed_submission:{action:'Approve and submit the agreed order to the court.',mio:'Mio keeps the agreed-order route active until court action is recorded.'},
  setting:{action:'Request a setting and record the confirmed hearing/submission date.',mio:'Mio opens the court-email workflow and tracks the follow-up date.'},
  notice:{action:'Review the hearing notice, then file, serve, and mail it as required.',mio:'Mio opens the reviewed notice template and links filing/service tools.'},
  hearing:{action:'Attend the hearing/submission and record the outcome.',mio:'Mio treats the confirmed setting as a waiting event until the hearing/outcome.'},
  signed_order:{action:'Locate and verify the actual signed withdrawal order.',mio:'Mio requires the signed-order document before closeout can advance.'},
  setting_cleanup:{action:'Review any remaining settings and confirm whether anything still requires action.',mio:'Mio does not assume a court setting disappeared just because an order was signed.'},
  reply_review:{action:'Review the new correspondence and decide the next step.',mio:'Mio surfaced a new linked reply after another step had already moved forward.'},
  status_update:{action:'Approve changing the matter to Order Need to Close.',mio:'Mio writes the approved matter status only after the signed order is verified.'},
  closeout_email:{action:'Review and send the signed order plus the client file links, then verify delivery.',mio:'Mio prepares the closeout message and requires the verified signed order and links.'},
  close_workflow:{action:'Final review: confirm all withdrawal work is complete and close the workflow.',mio:'Mio checks the required closeout gates before allowing completion.'}
}
export function withdrawalGuidance(stepId){return WITHDRAWAL_GUIDANCE[stepId]||{action:'Review this withdrawal step and record the next required action.',mio:'Mio will keep the workflow state and evidence together.'}}
export function withdrawalProgress(state,steps){if(!state)return{done:0,total:steps.length};const active=steps.filter(d=>state.steps?.[d.id]?.status!=='cancelled');return{done:active.filter(d=>state.steps?.[d.id]?.status==='complete').length,total:active.length}}
