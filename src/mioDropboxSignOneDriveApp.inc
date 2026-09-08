  function mioWdDocumentSource(step){return ['draft_folder','efile_folder','matter_documents'].includes(step?.document_source)?step.document_source:'matter_documents'}
  function mioWdFolderField(source){return source==='draft_folder'?'draft_folder':source==='efile_folder'?'efile_folder':''}
  function mioWdFolderPath(matter,source){const field=mioWdFolderField(source);if(!field)return '';if(field==='efile_folder')return String(matter?.efile_folder||matterEfileFolderForId(matter?.id)||'').trim();return String(matter?.draft_folder||'').trim()}
  async function mioWdEnsureMatterFolder(matterId,source){
    const field=mioWdFolderField(source);if(!field)return ''
    const matter=matters.find(m=>String(m.id)===String(matterId));if(!matter)throw new Error('Matter not found.')
    let path=mioWdFolderPath(matter,source)
    if(!path){
      const efile=String(matter?.efile_folder||matterEfileFolderForId(matterId)||'').trim(),suggested=source==='draft_folder'?(efile?efile.replace(/\/e[-_ ]?file\/?$/i,'/draft'):defaultOpenCaseFolderPath()):defaultOpenCaseFolderPath()
      const entered=window.prompt('Enter the existing OneDrive '+(source==='draft_folder'?'draft':'e-file')+' folder path for '+(matter.name||matterLabel(matterId))+'. Mio will verify the folder before saving it.',suggested||'')
      if(!entered?.trim())throw new Error('Connect the matter\'s OneDrive '+(source==='draft_folder'?'draft':'e-file')+' folder before continuing.')
      path=String(entered).trim()
    }
    const encoded=oneDriveEncodePath(path),folder=await graphFetch(encoded?`/me/drive/root:/${encoded}`:'/me/drive/root',{allowInteractive:true})
    if(!folder?.id||(!folder.folder&&!folder.root))throw new Error('That OneDrive path is not an existing folder.')
    const canonical=folder.root?'/':`${oneDriveParentPathFromItem(folder)||''}/${folder.name||''}`.replace(/\/+/g,'/')||path
    if(String(matter[field]||'').trim()!==canonical){
      const{data,error}=await supabase.from('matters').update({[field]:canonical}).eq('id',matterId).select('id,'+field).maybeSingle()
      if(error||!data?.id||String(data[field]||'').trim()!==canonical)throw new Error(error?.message||'Mio could not save this OneDrive folder to the matter.')
      setMatters(current=>current.map(m=>String(m.id)===String(matterId)?{...m,[field]:canonical}:m))
      if(field==='efile_folder'){const next={...(matterEfileFoldersRef.current||{}),[String(matterId)]:canonical};matterEfileFoldersRef.current=next;setMatterEfileFolders(next)}
    }
    return canonical
  }
  async function mioWdImportOneDriveInput(matterId,step,slotId){
    const source=mioWdDocumentSource(step);if(!['draft_folder','efile_folder'].includes(source))return null
    const matter=matters.find(m=>String(m.id)===String(matterId));if(!matter)throw new Error('Matter not found.')
    const path=await mioWdEnsureMatterFolder(matterId,source),encoded=oneDriveEncodePath(path)
    const children=await graphFetch(encoded?`/me/drive/root:/${encoded}:/children?$top=200`:'/me/drive/root/children?$top=200',{allowInteractive:true})
    const files=(children?.value||[]).filter(item=>item.file).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),undefined,{numeric:true,sensitivity:'base'}))
    if(!files.length)throw new Error('No files are in the configured OneDrive '+(source==='draft_folder'?'draft':'e-file')+' folder.')
    const slotName=step.output_slots?.includes(slotId)?'output':(step.input_slots||[]).includes(slotId)?'input':'document',label=step?.name||'workflow step'
    const listing=files.slice(0,50).map((f,i)=>(i+1)+'. '+f.name).join('\n'),answer=window.prompt('Choose the '+slotName+' file for '+label+' from '+path+':\n\n'+listing+(files.length>50?'\n\nOnly the first 50 files are listed.':'')+'\n\nEnter the file number:','1')
    if(!answer)return null
    const index=Number(answer)-1;if(!Number.isInteger(index)||index<0||index>=Math.min(files.length,50))throw new Error('Choose a listed file number.')
    const item=files[index],metadata=item['@microsoft.graph.downloadUrl']?item:await graphFetch(`/me/drive/items/${encodeURIComponent(item.id)}`,{allowInteractive:true}),downloadUrl=metadata?.['@microsoft.graph.downloadUrl']||''
    if(!downloadUrl)throw new Error('OneDrive did not provide a download URL for '+item.name+'.')
    const response=await fetch(downloadUrl);if(!response.ok)throw new Error('OneDrive download failed for '+item.name+' ('+response.status+').')
    const blob=await response.blob(),file=new File([blob],item.name||'OneDrive file',{type:item.file?.mimeType||blob.type||'application/octet-stream',lastModified:item.lastModifiedDateTime?new Date(item.lastModifiedDateTime).getTime():Date.now()}),docId='doc-'+Date.now()+'-'+Math.random().toString(36).slice(2),stored=await uploadMioDocumentFile(file,docId,matterId)
    const doc=withEmptyDocumentAiReview({id:docId,matter_id:String(matterId),name:String(file.name||'').replace(/\.[^/.]+$/,''),date:item.lastModifiedDateTime?dateToInputValue(new Date(item.lastModifiedDateTime)):'',description:'Imported from workflow '+(source==='draft_folder'?'draft':'e-file')+' folder: '+path,status:'Neither',tag_ids:source==='efile_folder'&&efiledTagId()?tagAndParentIds([efiledTagId()]):[],document_field_values:{},upload_date:dateToInputValue(new Date()),file_name:file.name,original_file_name:file.name,file_type:file.type,file_size:file.size,source_type:'onedrive-workflow-'+source,source_onedrive_item_id:item.id,source_onedrive_path:path+'/'+item.name,source_onedrive_web_url:item.webUrl||'',source_modified_at:item.lastModifiedDateTime||'',...stored})
    setDocuments(current=>[doc,...current])
    await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'slot_attach',slot_id:slotId,document_id:doc.id,matter_id:String(matterId),name:doc.file_name||doc.name,step_id:step.id,verified:true,confirmed:true,source:'Imported from configured OneDrive '+source+' and reviewed for '+step.name})
    return doc
  }
  async function mioWdEnsureStepInputs(matterId,step,state){
    const imported=[];if(!['draft_folder','efile_folder'].includes(mioWdDocumentSource(step)))return{state,imported}
    for(const slotId of step.input_slots||[]){const live=mioWithdrawalStore.getSnapshot().rows[String(matterId)]?.state||state;if(resolveWorkflowSlot(live,slotId)?.verified)continue;const doc=await mioWdImportOneDriveInput(matterId,step,slotId);if(!doc)throw new Error('No file was selected. Nothing was sent or filed.');imported.push(doc)}
    return{state:mioWithdrawalStore.getSnapshot().rows[String(matterId)]?.state||state,imported}
  }
  function mioWdDocumentById(matterId,id,extra=[]){return extra.find(d=>String(d.id)===String(id)&&String(d.matter_id)===String(matterId))||documents.find(d=>String(d.id)===String(id)&&String(d.matter_id)===String(matterId))}
  async function mioWdDropboxSignAction(matterId,step,state,imported=[]){
    const matter=matters.find(m=>String(m.id)===String(matterId)),current=state.steps[step.id];if(!matter||!current)throw new Error('Signature step is not available.')
    if(current.signature_request_id){
      const response=await fetch('/api/dropbox-sign?action=request&signature_request_id='+encodeURIComponent(current.signature_request_id),{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'Could not refresh Dropbox Sign.')
      const request=data.signature_request||{},signatures=request.signatures||[],signed=!!request.is_complete||signatures.length>0&&signatures.every(s=>String(s.status_code||'').toLowerCase()==='signed'),status=signed?'signed':signatures.some(s=>String(s.status_code||'').toLowerCase()==='signed')?'partially_signed':'sent'
      await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_config',step_id:step.id,signature_provider:'dropbox_sign',signature_request_id:current.signature_request_id,signature_status:status,signature_details_url:request.details_url||current.signature_details_url||'',signature_test_mode:!!request.test_mode,signature_completed_at:signed?new Date().toISOString():current.signature_completed_at||''})
      if(!signed){alert('Dropbox Sign status: '+status.replaceAll('_',' ')+'. Mio will keep this step open.');return}
      if(!(step.output_slots||[]).length){alert('Dropbox Sign reports all signers complete. Add an output document slot to this step, then refresh it again so Mio has somewhere to save the signed PDF.');return}
      const fileResponse=await fetch('/api/dropbox-sign?action=files&signature_request_id='+encodeURIComponent(current.signature_request_id),{cache:'no-store'});if(!fileResponse.ok){let detail='';try{detail=(await fileResponse.json()).error||''}catch{}throw new Error(detail||'Dropbox Sign has not made the final PDF downloadable yet. Refresh this step again shortly.')}
      const blob=await fileResponse.blob(),fileName='Dropbox Sign - '+(step.name||'signed document')+'.pdf',file=new File([blob],fileName,{type:'application/pdf'}),docId='doc-'+Date.now()+'-'+Math.random().toString(36).slice(2),stored=await uploadMioDocumentFile(file,docId,matterId),doc=withEmptyDocumentAiReview({id:docId,matter_id:String(matterId),name:fileName.replace(/\.pdf$/i,''),date:dateToInputValue(new Date()),description:'Completed Dropbox Sign request '+current.signature_request_id,status:'Neither',tag_ids:[],document_field_values:{dropbox_sign:{signature_request_id:current.signature_request_id,details_url:request.details_url||''}},upload_date:dateToInputValue(new Date()),file_name:fileName,original_file_name:fileName,file_type:'application/pdf',file_size:file.size,source_type:'dropbox-sign',...stored})
      setDocuments(list=>[doc,...list])
      for(const slotId of step.output_slots)await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'slot_attach',slot_id:slotId,document_id:doc.id,matter_id:String(matterId),name:doc.file_name,step_id:step.id,verified:true,confirmed:true,source:'Completed Dropbox Sign request '+current.signature_request_id})
      alert('Dropbox Sign is complete. Mio saved the signed PDF into the step output slot. Review it, then approve/complete this step.');return
    }
    const people=mioWdBlockPeople(matterId),chosen=people.filter(p=>(current.recipient_ids||[]).includes(p.key));if(!chosen.length)throw new Error('Choose the signer(s) from this matter first.')
    const inputs=(step.input_slots||[]).map(slotId=>resolveWorkflowSlot(state,slotId));if(!inputs.length||inputs.some(v=>!v?.verified))throw new Error('Attach and review the signature input PDF first.')
    const files=[]
    for(const version of inputs){const doc=mioWdDocumentById(matterId,version.document_id,imported);if(!doc)throw new Error('A signature input document is missing from this matter.');if(!(/\.pdf$/i.test(doc.file_name||doc.name||'')||doc.file_type==='application/pdf'))throw new Error('Dropbox Sign requires the reviewed input to be a PDF.');const dataUrl=await loadDocumentFileDataUrl(doc),match=String(dataUrl||'').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);if(!match)throw new Error('Mio could not load '+(doc.file_name||doc.name)+' for Dropbox Sign.');files.push({name:doc.file_name||doc.name||'document.pdf',content_type:'application/pdf',base64:match[2].replace(/[\r\n]/g,'')})}
    const signerNames=chosen.map(p=>p.label+' <'+p.email+'>').join('\n'),fileNames=files.map(f=>f.name).join('\n');if(!window.confirm('Send this Dropbox Sign request?\n\nSigner(s):\n'+signerNames+'\n\nPDF(s):\n'+fileNames+'\n\nNothing is sent until you click OK.'))return
    const response=await fetch('/api/dropbox-sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',title:current.email_subject||step.name+' - '+matter.name,subject:current.email_subject||step.name+' - '+matter.name,message:current.email_body||'Please review and sign the attached document.',files,signers:chosen.map((p,i)=>({email_address:p.email,name:p.name||p.label.split(' - ')[0]||p.email,order:i})),metadata:{mio_matter_id:String(matterId),mio_step_id:step.id}})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Dropbox Sign request failed.')
    const request=data.signature_request||{},requestId=request.signature_request_id||request.id;if(!requestId)throw new Error('Dropbox Sign did not return a signature request ID; Mio did not mark this step as sent.')
    await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_config',step_id:step.id,signature_provider:'dropbox_sign',signature_request_id:requestId,signature_status:'sent',signature_details_url:request.details_url||'',signature_test_mode:data.test_mode!==false,signature_sent_at:new Date().toISOString()})
    alert('Dropbox Sign request created'+(data.test_mode!==false?' in TEST MODE':'')+'. Mio saved request '+requestId+'. Open this step again and use its action button to refresh signer status.');
  }
