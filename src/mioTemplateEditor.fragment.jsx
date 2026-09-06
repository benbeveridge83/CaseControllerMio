  // This fragment is read as source, never interpolated into a JavaScript template literal.
  function mioTemplateControlsV300(paragraph, template) {
    return !!mioBlockKeyV300(paragraph?.text) || mioParagraphFieldsV300(paragraph, template, draftingStudioCurrentFile(template), draftingStudioDocument).length > 0
  }
  function mioTemplatePreviewV300(paragraph, template) {
    return <MioTemplateParagraphV300 paragraph={paragraph} template={template} file={draftingStudioCurrentFile(template)} document={draftingStudioDocument} profile={draftingProfile} sourceLabel={draftingV276SourceLabel} onEdit={mioEditFieldV300}/>
  }
  function mioTemplateToolbarV300() {
    const template=draftingStudioCurrentTemplate(),file=draftingStudioCurrentFile(template)
    const unmapped=mioActiveBindingsV300(template,file).filter(b=>b.source_text&&!b.replace_all&&!mioLocateBindingV300(b,draftingStudioDocument))
    return <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',padding:'9px 12px',border:'1px solid #93c5fd',background:'#eff6ff',borderRadius:8}}>
      <button type="button" aria-pressed={mioFieldSelectorV300} onClick={()=>{setMioFieldSelectorV300(!mioFieldSelectorV300);setDraftingWordEditorEnabled(false);mioQuickSelectionV300.current=null}} style={{fontWeight:800,padding:'7px 12px'}}>{mioFieldSelectorV300?'Field Selector ON':'Field Selector'}</button>
      <span>{mioFieldSelectorV300?'Highlight text, then choose its replacement field.':'Saved fields appear in blue boxes. Click a field to edit it.'}</span>
      <span role="status" aria-label="Template save status" style={{fontWeight:700,color:mioTemplateSaveV300.startsWith('Not saved')?'#991b1b':'#166534'}}>{mioTemplateSaveV300}</span>
      {mioTemplateSaveV300.startsWith('Not saved')&&<button type="button" onClick={()=>mioPersistTemplatesV300()}>Retry template save</button>}
      {!!unmapped.length&&<strong style={{color:'#92400e'}}>{unmapped.length} saved field location(s) need review; no text was replaced at a guessed location.</strong>}
    </div>
  }
  async function mioPersistTemplatesV300() {
    if(!mioCloudHydrationDone)return
    const serial=++mioTemplateSaveSerialV300.current
    const safe=mioTemplatesRefV300.current.map(cleanDraftingTemplate)
    setMioTemplateSaveV300('Saving template to Supabase...')
    try {
      const ok=await saveMioStateKeyNow('caseMioDraftingTemplates',JSON.stringify(safe),{throwOnError:true})
      if(!ok)throw new Error('The cloud save was not acknowledged.')
      if(serial===mioTemplateSaveSerialV300.current)setMioTemplateSaveV300('Template saved to Supabase')
    } catch(error) {
      if(serial===mioTemplateSaveSerialV300.current)setMioTemplateSaveV300('Not saved: '+(error?.message||String(error))+'. Keep this tab open; your edits remain here.')
    }
  }
  function mioPublishTemplateV300(next) {
    const list=mioTemplatesRefV300.current
    const updated=list.some(t=>String(t.id)===String(next.id))?list.map(t=>String(t.id)===String(next.id)?next:t):[...list,next]
    mioTemplatesRefV300.current=updated
    setDraftingTemplates(updated);setDraftingTemplateForm(next)
    setMioTemplateSaveV300('Saving template to Supabase...')
  }
  function draftingStudioCommitBinding(raw,options={}) {
    if(!['field','pronoun','paragraph_choice'].includes(raw.kind||'field'))return draftingStudioCommitBindingLegacyV300(raw,options)
    const current=draftingStudioCurrentTemplate()
    const template=mioTemplatesRefV300.current.find(t=>String(t.id)===String(current?.id))||current
    const file=draftingStudioCurrentFile(template)
    if(!template||!file)return alert('Open a Word template first.')
    const key=raw.kind==='pronoun'?draftingNormalizeFieldKey(raw.field_key||raw.label):mioFieldKeyV300(raw.data_source||'manual',raw.field_key||raw.label)
    if(!key)return alert('Choose a field source or give the manual field a name.')
    const binding=draftingNormalizeBinding({...raw,id:raw.id||draftingStudioId('draft-binding'),field_key:key,file_id:file.id||file.name})
    const signature=mioBindingSignatureV300(binding)
    const bindings=(template.bindings||[]).filter(b=>b.id!==binding.id&&mioBindingSignatureV300(b)!==signature)
    bindings.push(binding)
    const next=draftingStudioEnsureField({...template,bindings},binding,options.suggestion||{})
    next.fields=(next.fields||[]).map(f=>f.key===key?{...f,label:binding.label||f.label,source:binding.data_source,required:binding.required,grammar_role:binding.grammar_role,linked_party:binding.linked_party}:f)
    mioPublishTemplateV300(cleanDraftingTemplate({...next,updated_at:new Date().toISOString(),visual_builder_status:'reviewed'}))
    setDraftingStudioSelection(null);setDraftingEditingBindingId('')
    setDraftingStudioStatus('Field added: '+(binding.label||key)+'. Its cloud-save status is shown above.')
    return binding
  }
  function mioCaptureFieldV300(event,index) {
    if(event.target?.closest?.('[data-mio-field-id],[data-mio-block]'))return
    const selection=window.getSelection?.()
    const picked=mioCaptureSelectionV300(selection,draftingStudioDocument)
    if(!picked){if(!mioFieldSelectorV300)draftingStudioCaptureSelection(event,index);return}
    mioJustSelectedV300.current=true
    setDraftingStudioSelection(picked);setDraftingEditingBindingId('')
    setDraftingBindingDraft(current=>({...current,kind:'field',label:'',field_key:'',data_source:'manual'}))
    if(mioFieldSelectorV300){
      const template=draftingStudioCurrentTemplate(),file=draftingStudioCurrentFile(template)
      mioQuickSelectionV300.current={...picked,template_id:template.id,file_id:file.id||file.name}
      draftingV276OpenSourcePicker('quick_field','','manual')
    }
    selection?.removeAllRanges()
  }
  function mioSelectParagraphV300(event,index) {
    if(mioJustSelectedV300.current){mioJustSelectedV300.current=false;return}
    if(event.target?.closest?.('[data-mio-field-id]'))return
    draftingStudioV284SelectParagraph(event,index)
  }
  function mioChooseSourceV300(value) {
    if(draftingSourcePickerTarget.kind!=='quick_field')return draftingV276ChooseSourceLegacyV300(value)
    const picked=mioQuickSelectionV300.current
    const template=draftingStudioCurrentTemplate(),file=draftingStudioCurrentFile(template)
    if(!picked||picked.template_id!==template?.id||picked.file_id!==(file?.id||file?.name)){
      setDraftingSourcePickerOpen(false);setDraftingStudioStatus('The open template changed. Highlight the text again.');return
    }
    if(value==='manual'){
      setDraftingSourcePickerOpen(false);setDraftingStudioSelection(picked);setDraftingStudioStatus('Name the manual field in the field panel, then save it.');return
    }
    const label=draftingV276SourceLabel(value)
    const kind=value==='case.caption'?'caption_block':value==='attorney.signature_block'?'signature_block':'field'
    draftingStudioCommitBinding({...picked,id:draftingStudioId('draft-binding'),kind,label,field_key:mioFieldKeyV300(value,label),data_source:value,replace_all:false,source:'manual'})
    mioQuickSelectionV300.current=null;setDraftingSourcePickerOpen(false)
  }
  function mioEditFieldV300(binding) {
    const location=mioLocateBindingV300(binding,draftingStudioDocument)
    if(!location){setDraftingStudioStatus('This saved field cannot be located safely. Highlight the correct text to remap it; the original document was not changed.');return}
    setDraftingEditingBindingId(binding.id);setDraftingBindingDraft({...binding});setDraftingStudioSelection({...location,source_text:binding.source_text})
    setDraftingStudioStatus('Editing field: '+(binding.label||binding.field_key))
  }
  function mioSaveFieldEditV300() {
    const template=draftingStudioCurrentTemplate(),old=template?.bindings?.find(b=>b.id===draftingEditingBindingId)
    if(!old)return
    const location=mioLocateBindingV300(old,draftingStudioDocument)
    if(!location)return setDraftingStudioStatus('Could not locate the field safely. No changes saved.')
    draftingStudioCommitBinding({...old,...draftingBindingDraft,...location,id:old.id,source_text:old.source_text,file_id:old.file_id})
    setDraftingEditingBindingId('');setDraftingStudioSelection(null)
  }
  function mioApplyScalarBindingsV300(xmlDoc,data,template,file,xmlPath) {
    const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const nodes=Array.from(xmlDoc.getElementsByTagNameNS(ns,'p'))
    const document={paragraphs:nodes.map((node,index)=>({index,text:mioWordTextV300(node)}))}
    const scalar=['field','pronoun','paragraph_choice']
    const bindings=mioActiveBindingsV300(template,file).filter(b=>scalar.includes(b.kind)&&(xmlPath==='word/document.xml'||b.replace_all))
    const selected={...template,bindings}
    if(xmlPath==='word/document.xml')for(const b of bindings){if(b.source_text&&!b.replace_all&&!mioLocateBindingV300(b,document))throw new Error('Field location needs review before generation: '+(b.label||b.field_key))}
    nodes.forEach((node,index)=>{
      const ranges=mioParagraphFieldsV300(document.paragraphs[index],selected,file,document)
      for(const range of ranges.slice().reverse())mioReplaceWordRangeV300(node,range.start,range.end,draftingBindingValue(range.binding,data,template))
    })
    return template?{...template,bindings:(template.bindings||[]).filter(b=>!scalar.includes(b.kind))}:template
  }
  function draftingV276ChooseSource(value) { return mioChooseSourceV300(value) }
  function mioOutlineFieldLabelV300(section,template) {
    const p=draftingStudioDocument?.paragraphs?.[section.start]
    if(!p)return section.name
    const ranges=mioParagraphFieldsV300(p,template,draftingStudioCurrentFile(template),draftingStudioDocument)
    if(!ranges.length)return section.name
    return mioReplacePreviewTextV300(p.text,ranges,b=>'['+(b.data_source&&b.data_source!=='manual'?draftingV276SourceLabel(b.data_source):b.label||b.field_key)+']')
  }
