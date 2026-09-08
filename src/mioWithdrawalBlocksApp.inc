  function mioWdBlockPeople(matterId){
    const matter=matters.find(m=>String(m.id)===String(matterId));if(!matter)return []
    const choices=needToSetPeopleOptionsForEvent({matter_id:matterId,matter,matters:matter,checklist_matter:matter})
    for(const role of ['client','opposing_counsel','opposing_party','court']){
      const contact=needToSetRecipientOption({type:'withdrawal',matterId,matter},role)
      if(contact.email&&!choices.some(p=>p.email.toLowerCase()===contact.email.toLowerCase()))choices.push({key:role+'::'+contact.email.toLowerCase(),source:role,label:contact.label+' - '+contact.name,email:contact.email,personId:''})
    }
    return choices
  }
  function mioWdMatterFolders(matterId){
    const matter=matters.find(m=>String(m.id)===String(matterId))||{}
    return{draft:String(matter.draft_folder||'').trim(),efile:String(matter.efile_folder||matter.e_file_folder||matter.efileFolder||'').trim()}
  }
  function mioWdGraphPath(raw){
    let value=String(raw||'').trim().replace(/\\/g,'/')
    const marker='/OneDrive - Beveridge Law Firm, PLLC/'
    const index=value.toLowerCase().indexOf(marker.toLowerCase())
    if(index>=0)value=value.slice(index+marker.length-1)
    value=value.replace(/^[A-Za-z]:/,'').replace(/^\/+|\/+$/g,'')
    return value?'/'+value:''
  }
  async function mioWdSaveMatterFolder(matterId,kind,path){
    const field=kind==='draft'?'draft_folder':'efile_folder',value=String(path||'').trim()
    const{data,error}=await supabase.from('matters').update({[field]:value||null}).eq('id',matterId).select('id,'+field).single()
    if(error||String(data?.[field]||'')!==value)throw new Error(error?.message||'The OneDrive folder could not be saved to this matter.')
    if(field==='efile_folder')setMatterEfileFolders(current=>({...current,[String(matterId)]:value}))
    await fetchMatters();return value
  }
  async function mioWdListOneDriveFiles(matterId,source){
    const folders=mioWdMatterFolders(matterId),kind=source==='onedrive_efile'?'efile':'draft',configured=folders[kind]
    if(!configured)throw new Error('Set the matter OneDrive '+(kind==='draft'?'Drafts':'e-file')+' folder first.')
    const path=mioWdGraphPath(configured);if(!path)throw new Error('The configured OneDrive folder path is not valid.')
    const metadata=await graphFetch(`/me/drive/root:/${oneDriveEncodePath(path)}`,{allowInteractive:true})
    const files=await collectOneDriveFilesRecursive(metadata,path)
    return files.map(file=>({id:file.id,name:file.name||'OneDrive file',mime_type:file.file?.mimeType||'application/octet-stream',size:file.size||0,modified_at:file.lastModifiedDateTime||'',web_url:file.webUrl||'',download_url:file['@microsoft.graph.downloadUrl']||'',source_path:file.source_path||oneDriveJoinPath(path,file.name||'')})).sort((a,b)=>String(a.name).localeCompare(String(b.name)))
  }
  async function mioWdImportOneDriveFile(matterId,item,source){
    if(!item?.id)throw new Error('Choose a OneDrive file first.')
    let url=item.download_url
    if(!url){const metadata=await graphFetch(`/me/drive/items/${encodeURIComponent(item.id)}`,{allowInteractive:true});url=metadata?.['@microsoft.graph.downloadUrl']||''}
    if(!url)throw new Error('OneDrive did not provide a download URL for this file.')
    const response=await fetch(url);if(!response.ok)throw new Error('OneDrive download failed ('+response.status+').')
    const blob=await response.blob(),file=new File([blob],item.name||'OneDrive file',{type:item.mime_type||blob.type||'application/octet-stream'}),docId=`doc-${Date.now()}-${Math.random().toString(36).slice(2)}`,stored=await uploadMioDocumentFile(file,docId,matterId)
    const doc=withEmptyDocumentAiReview({id:docId,matter_id:matterId,name:String(file.name).replace(/\.[^/.]+$/,''),date:item.modified_at?dateToInputValue(new Date(item.modified_at)):'',description:`Imported from configured OneDrive ${source==='onedrive_efile'?'e-file':'Drafts'} folder: ${item.source_path||''}`,status:'Neither',tag_ids:[],document_field_values:{},upload_date:dateToInputValue(new Date()),file_name:file.name,original_file_name:file.name,file_type:file.type,file_size:file.size,source_type:'onedrive-workflow-import',source_onedrive_item_id:item.id,source_onedrive_path:item.source_path||'',source_onedrive_web_url:item.web_url||'',source_modified_at:item.modified_at||'',...stored})
    setDocuments(current=>[doc,...current.filter(existing=>String(existing.id)!==docId)]);return doc
  }
  async function mioDropboxSignCall(actionName,{method='GET',body:payload=null,query:params={}}={}){
    const token=session?.access_token;if(!token)throw new Error('Sign in to Mio before using Dropbox Sign.')
    const search=new URLSearchParams({action:actionName,...params}),response=await fetch('/api/dropbox-sign?'+search.toString(),{method,headers:{Authorization:`Bearer ${token}`,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})}),data=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(data?.error||'Dropbox Sign request failed.');return data
  }
  async function mioWdDropboxSign(matterId,step,state,mode='send'){
    const matter=matters.find(m=>String(m.id)===String(matterId));if(!matter)throw new Error('Matter not found.')
    const current=state.steps[step.id],chosen=mioWdBlockPeople(matterId).filter(p=>(current.recipient_ids||[]).includes(p.key))
    if(!chosen.length)throw new Error('Choose the signer(s) from this matter first.')
    if(mode==='check'){
      if(!current.signature_request_id)throw new Error('No Dropbox Sign request is connected to this step yet.')
      const result=await mioDropboxSignCall('get',{query:{signature_request_id:current.signature_request_id}}),request=result.signature_request||result,status=request.is_complete?'all_signed':request.has_error?'error':'waiting_for_signatures'
      await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_config',step_id:step.id,signature_status:status,signature_completed_at:request.is_complete?new Date().toISOString():''})
      if(!request.is_complete)return{complete:false,status,request}
      const fileData=await mioDropboxSignCall('files',{query:{signature_request_id:current.signature_request_id}}),match=String(fileData.data_uri||'').match(/^data:application\/pdf;base64,(.+)$/i)
      if(!match)throw new Error('Dropbox Sign reports completion, but the signed PDF is not ready yet. Try Check Dropbox Sign again shortly.')
      const bytes=Uint8Array.from(atob(match[1]),c=>c.charCodeAt(0)),file=new File([bytes],`${String(step.name||'Signed document').replace(/[^A-Za-z0-9 _.-]/g,'')}.pdf`,{type:'application/pdf'}),docId=`doc-${Date.now()}-${Math.random().toString(36).slice(2)}`,stored=await uploadMioDocumentFile(file,docId,matterId),doc=withEmptyDocumentAiReview({id:docId,matter_id:matterId,name:file.name.replace(/\.pdf$/i,''),date:dateToInputValue(new Date()),description:`Completed Dropbox Sign request ${current.signature_request_id}`,status:'Neither',tag_ids:[],document_field_values:{},upload_date:dateToInputValue(new Date()),file_name:file.name,original_file_name:file.name,file_type:'application/pdf',file_size:file.size,source_type:'dropbox-sign',source_signature_request_id:current.signature_request_id,...stored})
      setDocuments(items=>[doc,...items.filter(existing=>String(existing.id)!==docId)])
      const outputs={};for(const slotId of step.output_slots)outputs[slotId]={document_id:doc.id,name:doc.file_name}
      await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_update',step_id:step.id,status:'complete',confirmed:true,note:'Dropbox Sign reports all required signatures complete.',evidence:{reference:'Dropbox Sign '+current.signature_request_id},outputs});return{complete:true,status:'all_signed',request,doc}
    }
    if(current.signature_request_id)throw new Error('This step already has a Dropbox Sign request. Use Check Dropbox Sign instead of sending a duplicate.')
    const docs=[]
    for(const slotId of step.input_slots){const version=resolveWorkflowSlot(state,slotId),doc=documents.find(d=>String(d.id)===String(version?.document_id)&&String(d.matter_id)===String(matterId));if(!doc)throw new Error('A reviewed input document is missing from Matter Documents.');if(!(/\.pdf$/i.test(doc.file_name||doc.name||'')||doc.file_type==='application/pdf'))throw new Error('Dropbox Sign requires the selected workflow input to be a PDF.');if(!doc.file_path)throw new Error('The selected PDF is not stored in Mio secure storage.');const{data,error}=await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(doc.file_path,60*60);if(error||!data?.signedUrl)throw error||new Error('Could not prepare the PDF for Dropbox Sign.');docs.push({doc,url:data.signedUrl})}
    if(!docs.length)throw new Error('Assign at least one reviewed input document slot before sending for signature.')
    const summary='Send '+docs.map(x=>x.doc.file_name||x.doc.name).join(', ')+' through Dropbox Sign to '+chosen.map(p=>p.label+' <'+p.email+'>').join('; ')+'? Dropbox Sign will email the signer(s).'
    if(!window.confirm(summary))return{cancelled:true}
    const sent=await mioDropboxSignCall('send',{method:'POST',body:{confirm_send:true,matter_id:matterId,step_id:step.id,file_urls:docs.map(x=>x.url),signers:chosen.map((p,i)=>({email_address:p.email,name:p.label,order:i})),title:current.email_subject||step.name+' - '+matter.name,subject:current.email_subject||step.name+' - '+matter.name,message:current.email_body||'Please review and sign the attached document.'}}),request=sent.signature_request||{},requestId=request.signature_request_id
    if(!requestId)throw new Error('Dropbox Sign did not return a signature request ID.')
    await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_config',step_id:step.id,signature_request_id:requestId,signature_status:'sent'})
    await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_update',step_id:step.id,status:'waiting',waiting_on:'Dropbox Sign: '+chosen.map(p=>p.label).join(', '),due_at:new Date(Date.now()+7*86400000).toISOString(),note:'Signature request sent through Dropbox Sign. Request ID: '+requestId,confirmed:true});return{sent:true,requestId,request}
  }
  async function mioWdBlockAttachments(context,email){
    const state=mioWithdrawalStore.getSnapshot().rows[context.matterId]?.state
    if(!state?.definition)return mioWithdrawalSendAttachmentsLegacy(context,email)
    const step=state.definition.steps.find(s=>s.id===context.stepId)
    if(!step||state.paused||state.status!=='active')throw new Error('Open an active, unpaused workflow step before sending.')
    const reason=workflowBlockReason(state,step);if(reason)throw new Error(reason)
    const expected=email.workflow_input_versions||[]
    for(const slotId of step.input_slots){const current=resolveWorkflowSlot(state,slotId),pinned=expected.find(v=>v.slot_id===slotId);if(!pinned||pinned.id!==current?.id)throw new Error('An input document changed. Prepare the email again and review the new attachment before sending.')}
    const chosen=mioWdBlockPeople(context.matterId).filter(p=>(state.steps[step.id].recipient_ids||[]).includes(p.key))
    if(!chosen.length)throw new Error('Choose recipients associated with this matter first.')
    const actual=outlookRecipientList([email.to,email.cc].filter(Boolean).join(';')).map(r=>r.emailAddress?.address?.toLowerCase()).filter(Boolean)
    if(!actual.length||actual.some(address=>!chosen.some(p=>p.email.toLowerCase()===address)))throw new Error('Recipients changed. Review and save the intended people on this step before sending.')
    if(step.id==='closeout_email'){const t=state.steps[step.id];if(!t.links_verified||!['invoices','efilings','documents'].every(k=>/^https:\/\/[^\s]+$/.test(t.client_links?.[k]||'')&&String(email.body||'').includes(t.client_links[k])))throw new Error('Review all three client-accessible resource links and include them in this message before sending.')}
    const versions=step.input_slots.map(slot=>resolveWorkflowSlot(state,slot)),attachments=[];let total=0
    for(const version of versions){if(attachments.some(a=>a.mio_document_id===version.document_id))continue;const doc=documents.find(d=>String(d.id)===version.document_id&&String(d.matter_id)===String(context.matterId));if(!doc)throw new Error('A selected input document is missing from this matter.');const dataUrl=await loadDocumentFileDataUrl(doc),match=String(dataUrl||'').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);if(!match)throw new Error('The selected attachment could not be loaded. Nothing was sent.');total+=match[2].length;if(total>=4*1024*1024)throw new Error('These attachments exceed the inline email size limit. Use Outlook for the approved package and record the result; nothing was sent here.');attachments.push({'@odata.type':'#microsoft.graph.fileAttachment',name:doc.file_name||doc.name||'Document',contentType:match[1],contentBytes:match[2].replace(/[\r\n]/g,''),mio_document_id:version.document_id})}
    return attachments.map(({mio_document_id,...attachment})=>attachment)
  }
  async function mioWdBlockAction(matterId,step,state){
    const matter=matters.find(m=>String(m.id)===String(matterId));if(!matter||!state?.definition)throw new Error('Open an editable withdrawal process first.')
    if(state.status!=='active'||state.paused)throw new Error('Resume this active workflow first.')
    if(step.openExisting){openSettingWorkspace({...mioWithdrawalEmailContext(matterId,step.id),stepName:step.name,step});return}
    const reason=workflowBlockReason(state,step);if(reason)throw new Error(reason)
    const current=state.steps[step.id],inputs=step.input_slots.map(slot_id=>({slot_id,...resolveWorkflowSlot(state,slot_id)}))
    await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'module_opened',step_id:step.id,input_versions:inputs});setMioWdFocusMatter(String(matterId))
    if(step.action==='draft_document')return mioOpenWithdrawalModule(matterId,{...step,module:'drafting',autoGenerate:true,template_id:current.template_id||step.template_id},state)
    if(step.action==='efile_document'){
      if(!inputs.length)throw new Error('Assign an input document slot to this e-filing step.');if(efileAgentDraft?.matter_id&&!window.confirm('Prepare a withdrawal filing package? The existing unsent filing draft will be replaced. Nothing is submitted now.'))return
      const draft=defaultMioEfileDraft(),filings=[],staged=[]
      for(const input of inputs){const doc=documents.find(d=>String(d.id)===input.document_id&&String(d.matter_id)===String(matterId));if(!doc||!(/\.pdf$/i.test(doc.file_name||doc.name||'')||doc.file_type==='application/pdf'))throw new Error('E-filing requires a reviewed PDF. Save the Word draft as a PDF in this matter Documents, then attach that PDF as the current input-slot version.');const dataUrl=await loadDocumentFileDataUrl(doc),bytes=dataUrlToUint8Array(dataUrl||'');if(!bytes?.length||bytes.length>50*1024*1024||String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')throw new Error('The selected filing is not a readable PDF within the size limit. Nothing was staged.');const id=mioEfileAgentId('efile-document'),file=new File([bytes],doc.file_name||doc.name,{type:'application/pdf'});staged.push([id,file]);filings.push({...draft.filings[0],id:mioEfileAgentId('filing'),description:state.definition.slots.find(s=>s.id===input.slot_id)?.name||step.name,documents:[{id,file_name:file.name,size:file.size,type:file.type,role:'lead',local_file_required:true}]})}
      staged.forEach(([id,file])=>{efileAgentFileObjectsRef.current[id]=file});setEfileAgentDraft({...draft,matter_id:matterId,cause_number:matter.cause_number||'',case_style:matter.name||'',court_name:matter.courts?.court_name||'',withdrawal_step_id:step.id,filings});setEfileAgentSelectedJobId('');setEfileAgentMessage('Workflow input PDFs connected. Review filing location, filing codes, service contacts and fees. Final submission still requires authorization. Put each actual file-stamped result in this step\'s output slot when received.');setPage('efile');return
    }
    if(step.action==='esign_document')return mioWdDropboxSign(matterId,step,state,current.signature_request_id?'check':'send')
    if(step.action==='draft_email'){
      const people=mioWdBlockPeople(matterId),chosen=people.filter(p=>(current.recipient_ids||[]).includes(p.key));if(!chosen.length)throw new Error('Choose the recipients from this matter in Choose people / message, then prepare the email.');const context={...mioWithdrawalEmailContext(matterId,step.id),stepName:step.name,step},workspace=normalizeWorkspace(context)
      if(workspace.emails?.length){const relevant=workspace.emails.filter(e=>chosen.some(p=>p.email.toLowerCase()===String(e.to||'').toLowerCase()));if(relevant.length!==chosen.length)throw new Error('This step already has linked emails for different recipients. Open linked email to review/remove old drafts before preparing a replacement; no messages were changed.');if(!window.confirm('Use the selected document versions with the existing linked emails? Review the existing wording, recipients and attachments before sending. Nothing is sent now.'))return;relevant.forEach(e=>patchWorkspaceEmail(context,e.id,{workflow_input_versions:inputs}));openSettingWorkspace(context);return}
      const names=step.input_slots.map(id=>state.definition.slots.find(s=>s.id===id)?.name).filter(Boolean).join(', '),body=current.email_body||(step.id==='setting'?'Please provide available dates for a hearing or submission on the motion to withdraw in '+matter.name+'.\n\nPlease let me know any scheduling requirements.':step.id==='closeout_email'?'Attached is the signed withdrawal order. Your case materials are available at the following links:\n\nInvoices: '+(current.client_links?.invoices||'[Add invoices link]')+'\nE-filings: '+(current.client_links?.efilings||'[Add e-filings link]')+'\nCase documents: '+(current.client_links?.documents||'[Add documents link]'):'Please review '+(names?'the attached '+names:'the documents for '+matter.name)+'.\n\n'+(step.id==='agreed_submission'?'The agreed withdrawal order is submitted for the Court\'s consideration.':'Please let me know your response or any questions.'))
      for(const person of chosen){const email=createWorkspaceEmailRecord(context,context,person.source,{role:person.source,label:person.label,name:person.label,email:person.email});patchWorkspaceEmail(context,email.id,{subject:current.email_subject||step.name+' - '+matter.name,body,workflow_input_versions:inputs,send_collapsed:false,compose_mode:'new'})}openSettingWorkspace(context);return
    }
    if(step.action==='matter_status'){
      const field=step.target_field,value=step.target_value;if(!['matter_status','case_status'].includes(field)||!options(field).some(o=>o.name===value))throw new Error('Choose a valid target from Settings in this step\'s definition.');if(!window.confirm('Change '+field.replace('_',' ')+' for '+matter.name+' to '+value+'?'))return
      if(matter[field]!==value){let query=supabase.from('matters').update({[field]:value}).eq('id',matterId);query=matter[field]==null?query.is(field,null):query.eq(field,matter[field]);const{data,error}=await query.select('id,'+field).single();if(error||data?.[field]!==value)throw new Error(error?.message||'The matter changed in another window. Reload before retrying.');await fetchMatters()}
      await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_update',step_id:step.id,status:'complete',confirmed:true,status_write_confirmed:true,note:'Attorney approved '+value+'. Supabase acknowledged the actual matter update.',evidence:{reference:'matters/'+matterId+'/'+field}});return
    }
    setSelectedTemplateMatterId(matterId);setPage(step.action==='calendar'?'need_to_set':'documents')
  }