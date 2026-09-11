  function mioProcessContext() {
    const assertAccess=()=>{if(isClientPortalMember()||!canOpenPage('processes'))throw new Error('Process actions require authorized firm access.')}
    const provider=mioCreateProcessActions({
      documents, getFile:loadDocumentFileDataUrl, people:mioWdBlockPeople, graph:graphFetch,
      emailHtml:text=>escapeEmailHtml(text).replace(/\n/g,'<br />')+(outgoingEmailSignatureHtml?'<br /><br />'+outgoingEmailSignatureHtml:''),
      signature:async(action,body)=>{
        assertAccess();const url=action==='request'?'/api/dropbox-sign?action=request&signature_request_id='+encodeURIComponent(body.signature_request_id):'/api/dropbox-sign'
        const response=await fetchMioAuthenticatedApi(url,action==='request'?{method:'GET'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...body})})
        const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Dropbox Sign request failed.');return data
      },
      validateStatus:(field,value)=>{if(!['matter_status','case_status'].includes(field)||!options(field).some(x=>x.name===value))throw new Error('Choose a status that exists in Settings.')},
      changeStatus:async(id,field,value)=>{
        assertAccess();if(!['matter_status','case_status'].includes(field)||!options(field).some(x=>x.name===value))throw new Error('Invalid matter status.')
        const matter=matters.find(m=>String(m.id)===String(id));if(!matter)throw new Error('Matter not found.')
        if(matter[field]!==value){let q=supabase.from('matters').update({[field]:value}).eq('id',id);q=matter[field]==null?q.is(field,null):q.eq(field,matter[field]);const {data,error}=await q.select('id,'+field).single();if(error||data?.[field]!==value)throw new Error(error?.message||'Matter changed in another window.');await fetchMatters()}
      },
      prepareOpen:(run,node,files)=>{
        assertAccess();const matter=matters.find(m=>String(m.id)===run.matterId),config=run.steps[node.id].config;if(!matter)throw new Error('Matter not found.')
        if(node.type==='draft_document'){
          if(!draftingTemplates.some(t=>String(t.id)===String(config.templateId)&&t.is_active!==false&&t.status!=='retired'))throw new Error('Select an active drafting template.')
          if(draftingGeneratedFiles.length&&!window.confirm('Open this process drafting task? The current unsaved generated preview will be replaced; saved documents are retained.'))return null
          return()=>{prepareDraftingSelection(config.templateId,run.matterId);setPage('drafting')}
        }
        if(node.type==='efile_document'){
          if(efileAgentDraft?.matter_id&&!window.confirm('Replace the unsent e-filing workspace with this process package? Nothing is submitted now.'))return null
          return()=>{const draft=defaultMioEfileDraft();draft.filings=files.map(item=>{const id=mioEfileAgentId('efile-document'),file=new File([item.bytes],item.name,{type:'application/pdf'});efileAgentFileObjectsRef.current[id]=file;return {...draft.filings[0],id:mioEfileAgentId('filing'),description:node.name,documents:[{id,file_name:file.name,size:file.size,type:file.type,role:'lead',local_file_required:true}]}});setEfileAgentDraft({...draft,matter_id:run.matterId,cause_number:matter.cause_number||'',case_style:matter.name||'',court_name:matter.courts?.court_name||'',process_run_id:run.id,process_node_id:node.id});setEfileAgentSelectedJobId('');setEfileAgentMessage('Prepared from process: '+run.name+'. Review filing codes, recipients and fees. Final submission requires authorization. Return to Processes to verify the file-stamped result.');setPage('efile')}
        }
        if(node.type==='mailform'){
          if(postalForm.document_ids?.length&&!window.confirm('Replace the unsent Snail Mail package with this process package?'))return null
          return()=>{postalSelectMatter(run.matterId);setPostalTab('compose');setPostalMessage('');setPostalQuote(null);setPostalPreparedFile(null);setPostalUploadFile(null);setPostalForm(c=>({...c,matter_id:run.matterId,document_ids:files.map(f=>f.documentId),purpose:node.name,approved_to_send:false,workflow_matter_id:'',workflow_step_id:'',process_run_id:run.id,process_node_id:node.id}));setPage('mail_center')}
        }
        return()=>{setSelectedTemplateMatterId(run.matterId);if(node.type==='review_document'&&files.length){const doc=documents.find(d=>String(d.id)===files[0].documentId);viewDocument(doc)}else setPage(node.type==='calendar'?'calendar':'documents')}
      }
    })
    return {
      matters,documents,templates:draftingTemplates.filter(t=>t.is_active!==false&&t.status!=='retired'),
      withdrawalDefinition:()=>{const raw=mioProcessStorage.getItem(mioProcessWithdrawalKey);return raw?JSON.parse(raw):mioDefaultWithdrawalDefinition()},
      billingContext:id=>({user_member_id:currentBillingUserId(),client_id:billingMatterClientId(id),matter_status:billingMatterStatus(id),rate:rateForBilling(currentBillingUserId(),id)}),
      billingRefresh:()=>{void loadBillingRelationalData(session.user.id,{force:true}).catch(error=>console.warn('Refresh Billing to see the saved process entry.',error))},
      recipientPreview:(run,node,config)=>{try{return provider.recipients({...run,steps:{...run.steps,[node.id]:{...run.steps[node.id],config}}},node).to.join('; ')}catch{return 'Choose an actual recipient before sending.'}},
      preflight:async(...args)=>{assertAccess();return provider.preflight(...args)},
      perform:async(...args)=>{assertAccess();return provider.perform(...args)},
      check:async(...args)=>{assertAccess();return provider.check(...args)}
    }
  }
