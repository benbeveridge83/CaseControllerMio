  async function mioSignalWithdrawal(matterId,event) {
    try { await mioWithdrawalStore.apply(session?.user?.id,String(matterId),event); return true }
    catch(error) { setMioWithdrawalIntegrationError('The module operation may have succeeded, but the workflow update was not saved: '+(error.message||error)+'. Refresh and record the evidence; do not resend or refile just to update the row.'); return false }
  }
  function mioWithdrawalEmailContext(matterId,stepId) {
    const matter=matters.find(item=>String(item.id)===String(matterId)),step=WITHDRAWAL_STEPS.find(item=>item.id===stepId)
    return {type:'withdrawal',matterId:String(matterId),matter,sourceId:stepId,stepId,stepName:step?.name||stepId,settingType:'Withdrawal',courtEmail:matterCourtCoordinatorEmail(matter)||''}
  }
  async function mioOpenWithdrawalModule(matterId,definition,state) {
    const matter=matters.find(item=>String(item.id)===String(matterId));if(!matter||!state||state.status!=='active')throw new Error('Open an active withdrawal first.')
    const step=definition.id==='reply_review'?(WITHDRAWAL_STEPS.find(item=>item.id===state.steps.reply_review.source_step_id)||definition):definition
    await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'module_opened',step_id:step.id,module:step.module})
    if(step.module==='drafting') {
      const mapped=draftingProfile.withdrawal_templates?.[step.id==='notice'?'notice':'motion']
      const template=draftingTemplates.find(item=>item.is_active!==false&&item.status!=='retired'&&(mapped?String(item.id)===String(mapped):item.system_key===(step.id==='notice'?'withdrawal_hearing_notice':'withdrawal_packet')))
      if(!template)throw new Error('Assign a reviewed '+(step.id==='notice'?'hearing-notice':'motion/order')+' template in Drafting settings. A client letter is not substituted for a hearing notice.')
      if(draftingGeneratedFiles.length&&!window.confirm('Switch to withdrawal drafting? The current generated preview will be cleared. Saved documents remain unchanged.'))return
      prepareDraftingSelection(template.id,matterId)
      setDraftingSelection(current=>({...current,field_values:{...current.field_values,withdrawal_step_id:step.id}}));setPage('drafting');return
    }
    if(step.module==='efile') {
      if(efileAgentDraft?.matter_id&&!window.confirm('Start a new withdrawal filing draft? Save or finish the current filing draft first. Nothing will be submitted now.'))return
      setEfileAgentDraft({...defaultMioEfileDraft(),matter_id:matterId,cause_number:matter.cause_number||'',case_style:matter.name||'',court_name:matter.courts?.court_name||'',withdrawal_step_id:step.id})
      setEfileAgentSelectedJobId('');setPage('efile');return
    }
    if(step.module==='email') {
      const context=mioWithdrawalEmailContext(matterId,step.id),existing=normalizeWorkspace(context).emails
      if(step.id==='closeout_email'&&(!state.closeout.links_verified||state.steps.signed_order.status!=='complete'))throw new Error('Verify the signed order and prepare client-accessible closeout links first.')
      if(!existing.length) {
        const role=['client_signature','closeout_email','service'].includes(step.id)?'client':step.id==='opposing_signature'?(matterOpposingCounselEmail(matter)?'opposing_counsel':'opposing_party'):'court'
        const email=createWorkspaceEmailRecord(context,context,role,needToSetRecipientOption(context,role))
        if(step.id==='closeout_email')patchWorkspaceEmail(context,email.id,{subject:state.closeout.subject,body:state.closeout.body,send_collapsed:false})
        if(step.id==='service') {const opposingRole=matterOpposingCounselEmail(matter)?'opposing_counsel':'opposing_party';createWorkspaceEmailRecord(context,context,opposingRole,needToSetRecipientOption(context,opposingRole))}
      } else if(step.id==='closeout_email') {
        if(!window.confirm('Load the prepared client closeout into this linked email? Unsaved compose wording will be replaced.'))return
        patchWorkspaceEmail(context,existing[0].id,{subject:state.closeout.subject,body:state.closeout.body,send_collapsed:false,compose_mode:'new'})
      }
      openSettingWorkspace(context);return
    }
    if(step.module==='mail_center'){postalSelectMatter(matterId);setPostalTab('compose');setPage('mail_center');return}
    setSelectedTemplateMatterId(matterId);setPage(step.module==='documents'?'documents':step.module==='calendar'?'calendar':'need_to_set')
  }
  async function mioApproveWithdrawalStatus(matterId) {
    const state=mioWithdrawalSnapshot.rows[matterId]?.state,matter=matters.find(item=>String(item.id)===String(matterId))
    if(!matter||state?.steps.signed_order.status!=='complete')throw new Error('Verify the actual signed order first.')
    if(!window.confirm('Change this matter case status to Order Need to Close? This does not mark the matter Closed.'))return
    if(matter.case_status!=='Order Need to Close'){
      let query=supabase.from('matters').update({case_status:'Order Need to Close'}).eq('id',matterId)
      query=matter.case_status==null?query.is('case_status',null):query.eq('case_status',matter.case_status)
      const{data,error}=await query.select('id,case_status').single()
      if(error||data?.case_status!=='Order Need to Close')throw new Error(error?.message||'Matter changed in another window. Reload before changing its status.')
      await fetchMatters()
    }
    await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_update',step_id:'status_update',status:'complete',confirmed:true,status_write_confirmed:true,note:'Attorney approved and Supabase acknowledged Order Need to Close.',evidence:{reference:'matters/'+matterId+'/case_status'}})
  }
  async function mioWithdrawalSendAttachments(context,email) {
    if(context.stepId!=='closeout_email')return []
    const state=mioWithdrawalStore.getSnapshot().rows[context.matterId]?.state
    if(!state||state.status!=='active'||!state.closeout.links_verified||state.steps.signed_order.status!=='complete')throw new Error('Verify the signed order and client sharing links before sending.')
    for(const key of ['invoices','efilings','documents'])if(!state.closeout.links[key]||!String(email.body||'').includes(state.closeout.links[key]))throw new Error('Include the verified '+key+' link in the outgoing message.')
    const record=documents.find(d=>String(d.id)===String(state.steps.signed_order.evidence.document_id)&&String(d.matter_id)===String(context.matterId))
    if(!record)throw new Error('The verified signed-order file is missing. Select it again in the workflow.')
    if(Number(record.file_size)>=3*1024*1024)throw new Error('The signed order is too large for this inline email method. Use a smaller reviewed PDF or send through Outlook and record the sent-message evidence in the workflow.')
    const dataUrl=await loadDocumentFileDataUrl(record),match=String(dataUrl||'').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/)
    if(!match||match[2].length>=4*1024*1024)throw new Error('The signed-order attachment could not be loaded within the safe size limit. Nothing was sent.')
    return [{'@odata.type':'#microsoft.graph.fileAttachment',name:record.file_name||'Signed withdrawal order.pdf',contentType:match[1],contentBytes:match[2].replace(/[\r\n]/g,'')}]
  }
  function mioWithdrawalEmailHtml(email) {
    let body=escapeEmailHtml(email.body||'').replace(/\n/g,'<br />')
    body=body.replace(/https:\/\/[^\s<]+/g,url=>'<a href="'+url+'">'+url+'</a>')
    return body+(outgoingEmailSignatureHtml?'<br /><br />'+outgoingEmailSignatureHtml:'')
  }
  async function mioRefreshWithdrawalLinks() {
    setMioWithdrawalIntegrationError('')
    if(!serviceGraphAuth?.account){setMioWithdrawalIntegrationError('Workflow states refreshed. Outlook is not connected, so new email replies were not checked.');return}
    for(const[key,workspace]of Object.entries(settingWorkspaces)){
      if(!key.startsWith('withdrawal::'))continue
      const[,matterId,stepId]=key.split('::');if(mioWithdrawalSnapshot.rows[matterId]?.state?.status!=='active')continue
      const context=mioWithdrawalEmailContext(matterId,stepId)
      for(const email of workspace.emails||[])if(email.outlook_conversation_id||email.outlook_message_id)await loadWorkspaceOutlookThread(context,email)
    }
    for(const job of efileAgentJobs||[])if(job.withdrawal_step_id&&['submitted','rejected','failed','accepted'].includes(job.status))await mioSignalWithdrawal(job.matter_id,{type:'efile_update',step_id:job.withdrawal_step_id,status:job.status,reference:job.envelope_number||job.page?.envelope_number||job.id,source_key:'efile:'+job.id,source_version:job.status})
  }
  function renderWithdrawalsPage() {
    const ids=new Set([...withdrawalMatters.map(m=>String(m.id)),...Object.keys(mioWithdrawalSnapshot.rows)])
    const rows=matters.filter(m=>ids.has(String(m.id))).map(m=>({matter_id:String(m.id),name:m.name||m.cause_number||'Matter',client:matterClientName(m),cause_number:m.cause_number||'',started_at:matterExtraFor(m.id).withdrawal_entered_at||null}))
    return <WithdrawalDashboard rows={rows} snapshot={{...mioWithdrawalSnapshot,error:mioWithdrawalIntegrationError||mioWithdrawalSnapshot.error}} owner={session?.user?.id} documents={documents} onOpen={mioOpenWithdrawalModule} onStatus={mioApproveWithdrawalStatus} onRefresh={mioRefreshWithdrawalLinks} onViewDocument={viewDocument} settings={renderMioDraftingDefaults()} legacy={renderWithdrawalsPageLegacy()}/>
  }
