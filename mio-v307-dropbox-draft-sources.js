function once(code,from,to,label){const i=code.indexOf(from);if(i<0||code.indexOf(from,i+from.length)>=0)throw new Error('V307 integration anchor changed: '+label);return code.replace(from,to)}
const helperBlock=`  function mioV307CleanOneDrivePath(value){const text=String(value||'').trim();if(!text)return '';return ('/'+text.replace(/^\\/+|\\/+$/g,'')).replace(/\\/+/g,'/')}
  function mioV307DraftFolderMap(){try{return JSON.parse(mioV307Storage.getItem('caseMioMatterDraftFolders')||'{}')||{}}catch{return {}}}
  function mioWdGetMatterDocumentSources(matterId){
    const id=String(matterId),matter=matters.find(m=>String(m.id)===id),draft=mioV307DraftFolderMap()[id]||''
    let efile='';try{if(typeof matterEfileFolderForId==='function')efile=matterEfileFolderForId(id)||''}catch{}
    if(!efile)try{if(typeof matterEfileFolders!=='undefined')efile=matterEfileFolders?.[id]||''}catch{}
    if(!efile)efile=matter?.efile_folder||''
    return{draft:{path:draft},efile:{path:efile},matter_documents:{count:documents.filter(d=>String(d.matter_id)===id).length}}
  }
  async function mioWdSaveDraftFolder(matterId,path){
    const id=String(matterId),next=mioV307DraftFolderMap(),clean=mioV307CleanOneDrivePath(path)
    if(clean)next[id]=clean;else delete next[id]
    await mioV307CloudStore.saveNow('caseMioMatterDraftFolders',JSON.stringify(next),{throwOnError:true})
    return{path:clean}
  }
  async function mioWdBrowseOneDrive({path}){
    const clean=mioV307CleanOneDrivePath(path)||'/'
    const endpoint=clean==='/'?'/me/drive/root/children?$top=200':'/me/drive/root:'+encodeURI(clean)+':/children?$top=200'
    const data=await graphFetch(endpoint,{allowInteractive:true}),items=Array.isArray(data?.value)?data.value:[]
    return{path:clean,folders:items.filter(item=>item.folder).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),undefined,{numeric:true,sensitivity:'base'})).map(item=>({id:item.id,name:item.name,path:mioV307CleanOneDrivePath(clean+'/'+item.name)}))}
  }
`
const esignBlock=`    if(step.action==='esign_document'){
      const people=mioWdBlockPeople(matterId),chosen=people.filter(p=>(current.recipient_ids||[]).includes(p.key))
      if(!chosen.length)throw new Error('Choose the signer(s) from this matter in Choose people / message first.')
      const provider=current.signature_provider||step.signature_provider||'dropbox_sign'
      if(provider!=='dropbox_sign')throw new Error('Choose Dropbox Sign as the signature provider in this step settings.')
      if(current.signature_request_id){
        const response=await fetch('/api/dropbox-sign?action=request&signature_request_id='+encodeURIComponent(current.signature_request_id),{cache:'no-store'}),data=await response.json().catch(()=>({}))
        if(!response.ok)throw new Error(data.error||'Dropbox Sign status could not be loaded.')
        const request=data.signature_request||{},complete=!!request.is_complete,declined=!!request.is_declined,status=complete?'complete':declined?'declined':'sent'
        await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_config',step_id:step.id,signature_provider:'dropbox_sign',signature_request_id:current.signature_request_id,signature_status:status,signature_completed_at:complete?new Date().toISOString():current.signature_completed_at||''})
        if(complete){
          window.open('/api/dropbox-sign?action=files&signature_request_id='+encodeURIComponent(current.signature_request_id),'_blank','noopener')
          await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_update',step_id:step.id,status:'needs_action',note:'Dropbox Sign reports all signatures complete. The completed PDF was opened for review. Save the signed PDF to this matter Documents and attach it to the signed output slot before approving completion.'})
          return
        }
        if(declined){await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_update',step_id:step.id,status:'needs_action',note:'Dropbox Sign reports that the request was declined. Review the request before sending a replacement.'});return}
        const follow=new Date(Date.now()+7*86400000).toISOString()
        await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_update',step_id:step.id,status:'waiting',waiting_on:'Dropbox Sign - '+chosen.map(p=>p.label||p.email).join(', '),due_at:follow,note:'Dropbox Sign request remains pending. Mio checked the live request status.'})
        return
      }
      if(!inputs.length)throw new Error('Assign at least one reviewed input document slot to this signature step.')
      const files=[]
      for(const input of inputs){
        const doc=documents.find(d=>String(d.id)===String(input.document_id)&&String(d.matter_id)===String(matterId))
        if(!doc)throw new Error('A selected signature document is missing from this matter Documents.')
        const name=doc.file_name||doc.name||'Document.pdf'
        if(!/\\.pdf$/i.test(name)&&doc.file_type!=='application/pdf')throw new Error('Dropbox Sign requires the reviewed signature document to be a PDF in Matter Documents.')
        const dataUrl=await loadDocumentFileDataUrl(doc),match=String(dataUrl||'').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\\r\\n]+)$/)
        if(!match)throw new Error('The selected signature PDF could not be loaded. Nothing was sent.')
        files.push({name,content_type:'application/pdf',base64:match[2].replace(/[\\r\\n]/g,'')})
      }
      if(!window.confirm('Send '+files.map(f=>f.name).join(', ')+' through Dropbox Sign to '+chosen.map(p=>p.label||p.email).join(', ')+'? This creates a real signature request.'))return
      const response=await fetch('/api/dropbox-sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',files,signers:chosen.map((p,index)=>({email_address:p.email,name:p.name||String(p.label||p.email).split(' - ').at(-1)||p.email,order:index})),title:step.name+' - '+matter.name,subject:current.email_subject||step.name+' - '+matter.name,message:current.email_body||'Please review and sign the attached document.',test_mode:false,metadata:{matter_id:String(matterId),workflow:'withdrawal',step_id:step.id}})}),data=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(data.error||'Dropbox Sign could not create the signature request.')
      const request=data.signature_request||{},requestId=request.signature_request_id
      if(!requestId)throw new Error('Dropbox Sign did not return a signature request ID. Nothing was recorded as sent.')
      await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_config',step_id:step.id,signature_provider:'dropbox_sign',signature_request_id:requestId,signature_status:'sent'})
      await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_update',step_id:step.id,status:'waiting',waiting_on:'Dropbox Sign - '+chosen.map(p=>p.label||p.email).join(', '),due_at:new Date(Date.now()+7*86400000).toISOString(),note:'Dropbox Sign request '+requestId+' sent. Mio will check this same request when the step is opened again.'})
      return
    }
`
export default function mioV307DropboxDraftSources(){return{name:'mio-v307-dropbox-draft-sources',enforce:'pre',transform(source,id){
 const path=id.split('?')[0].replaceAll('\\\\','/');let code=source
 if(path.endsWith('/src/mioWorkflowBlocks.js')){
  code=once(code,"manual_start:['setting_cleanup','reply_review'].includes(id),template_id:'',output_files:{},recipient_roles:","manual_start:['setting_cleanup','reply_review'].includes(id),template_id:'',document_source:'matter_documents',signature_provider:id==='client_signature'||id==='opposing_signature'?'dropbox_sign':'',output_files:{},recipient_roles:",'default source/provider')
  code=once(code,"signature_url:e.signature_url??t.signature_url,output_files:e.output_files??t.output_files","signature_url:e.signature_url??t.signature_url,document_source:e.document_source??t.document_source,signature_provider:e.signature_provider??t.signature_provider,signature_request_id:e.signature_request_id??t.signature_request_id,signature_status:e.signature_status??t.signature_status,signature_completed_at:e.signature_completed_at??t.signature_completed_at,output_files:e.output_files??t.output_files",'persist source/provider state')
  return{code,map:null}
 }
 if(path.endsWith('/src/MioWorkflowBuilder.jsx')){
  code=once(code,"manual_start:true,template_id:'',output_files:{},target_field:","manual_start:true,template_id:'',document_source:'matter_documents',signature_provider:'',output_files:{},target_field:",'new step source defaults')
  code=once(code,' <Choices label="Prerequisite steps"',` {(['draft_document','efile_document','esign_document','review_document'].includes(step.action)||step.input_slots.length>0)&&<label>Document source<select value={step.document_source||'matter_documents'} onChange={e=>patchStep({document_source:e.target.value})}><option value="matter_documents">Matter Documents</option><option value="onedrive_draft">OneDrive Draft folder assigned to this matter</option><option value="onedrive_efile">OneDrive E-file folder assigned to this matter</option></select></label>}\n <Choices label="Prerequisite steps"`,'document source setting')
  code=once(code,"{step.action==='esign_document'&&<p className=\"mio-block-note\">This block prepares the request and tracks the returned document. A signature-provider request link is required to send an e-signature invitation; it does not invent a signing link or treat email delivery as a signature.</p>}","{step.action==='esign_document'&&<><label>Signature provider<select value={step.signature_provider||'dropbox_sign'} onChange={e=>patchStep({signature_provider:e.target.value})}><option value=\"dropbox_sign\">Dropbox Sign</option></select></label><p className=\"mio-block-note\">Dropbox Sign creates the real signature request from the reviewed PDF, sends it to the selected matter contacts, and Mio tracks the request until it is complete.</p></>}",'Dropbox Sign builder')
  return{code,map:null}
 }
 if(path.endsWith('/src/MioWithdrawalBlocks.jsx')){
  code="import MioMatterDocumentSources from './MioMatterDocumentSources.jsx'\n"+code
  code=once(code,"onAction,getPeople,initialExpanded=''","onAction,getPeople,getMatterDocumentSources,onSaveDraftFolder,onBrowseOneDrive,initialExpanded=''",'dashboard source props')
  code=once(code,'</section></td></tr>}</React.Fragment>',`</section><MioMatterDocumentSources matterId={row.matter_id} getSources={getMatterDocumentSources} onSaveDraftFolder={onSaveDraftFolder} onBrowseOneDrive={onBrowseOneDrive}/></td></tr>}</React.Fragment>`,'matter source controls')
  return{code,map:null}
 }
 if(!path.endsWith('/src/App.jsx'))return null
 code="import {mioCloudStore as mioV307CloudStore,mioStorage as mioV307Storage} from './mioCloudRuntime.js'\n"+code
 code=once(code,'  function mioWdBlockPeople(matterId){',helperBlock+'  function mioWdBlockPeople(matterId){','source adapter helpers')
 code=once(code,"    if(['draft_email','esign_document'].includes(step.action)){",esignBlock+"    if(step.action==='draft_email'){",'live Dropbox Sign action')
 code=once(code,'getPeople={mioWdBlockPeople}','getPeople={mioWdBlockPeople} getMatterDocumentSources={mioWdGetMatterDocumentSources} onSaveDraftFolder={mioWdSaveDraftFolder} onBrowseOneDrive={mioWdBrowseOneDrive}','dashboard source adapters')
 code=code.replace('Mio V305 (editable withdrawal workflows)','Mio V307 (Dropbox Sign + document sources)')
 return{code,map:null}
}}}
