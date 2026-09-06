  function mioPronounDraftV302(raw) {
    const template=draftingStudioCurrentTemplate(),file=draftingStudioCurrentFile(template)
    return mioPreparePronounV302({...raw,...(draftingStudioSelection||{}),kind:'pronoun'},template,file,draftingStudioDocument)
  }
  function mioSelectBindingKindV302(kind) {
    setDraftingBindingDraft(current=>kind==='pronoun'?mioPronounDraftV302({...current,kind,linked_party:'',grammar_role:'',pronoun_schema:'',party_link_mode:'',id:''}):{...current,kind})
  }
  function mioEditMatterPronounsV302(matter,partyId,patch) {
    const parties=mioMatterPartiesV302(matter,matterExtraFor(matter.id),draftingMatterClientRecord(matter))
    const next=parties.map(p=>p.id===partyId?{...p,...patch}:p)
    setMatterExtraInfoById(current=>({...current,[matter.id]:{...cloneMatterExtraInfo(current[matter.id]||{}),litigation_parties:next}}))
    setDraftingGeneratedFiles([])
  }
  function mioMatterPronounDraftPanelV302() {
    const client=clients.find(c=>String(c.id)===String(matterForm.client_id))||{}
    const matter={...matterForm,id:matterForm.id||'draft'}
    const parties=mioMatterPartiesV302(matter,matterExtraDraft,client)
    return <MioMatterPronounEditorV302 parties={parties} onChange={(id,patch)=>setMatterExtraDraft(current=>({...current,litigation_parties:parties.map(p=>p.id===id?{...p,...patch}:p)}))}/>
  }
  function buildDraftingAssemblyData(template,matter,fieldValues={}) {
    const data=buildDraftingAssemblyDataLegacyV302(template,matter,fieldValues)
    const extra=matter?matterExtraFor(matter.id):{}
    data._pronoun_parties=mioMatterPartiesV302(matter||{},extra,draftingMatterClientRecord(matter))
    data._case_style_override=fieldValues.case_style_id||''
    const facts=extra?.drafting_facts||{}
    data.petitioner_name=fieldValues.petitioner_name||facts.petitioner_name||data.petitioner_name
    data.respondent_name=fieldValues.respondent_name||facts.respondent_name||data.respondent_name
    const quick=fieldValues.drafting_children_quick
    if(typeof quick==='string'&&quick.trim())data.children=quick.split(/\r?\n|;/).map(line=>{const [name,dob]=line.split('|').map(v=>v.trim());return{name,date_of_birth:dob||''}}).filter(c=>c.name)
    else data.children=(data.children||[]).filter(c=>c.name||c.id)
    if(fieldValues.drafting_children_status==='no')data.children=[]
    data.children_names=data.children.map(c=>c.name).filter(Boolean).join('; ')
    const style=mioResolveCaseStyle(draftingProfile,data.matter_case_type,data.children.length>0,data._case_style_override)
    data.case_style_id=style?.id||'';data.case_style_name=style?.name||''
    if(style?.generated){
      data.case_caption_text=mioGenerateCaptionV302(data,draftingProfile)
      const lines=data.case_caption_text.split('\n')
      data.caption_left_line_1=lines[0]||'';data.caption_left_line_2=lines[1]||'';data.caption_left_line_3=lines.slice(2).join('\n')
    }
    return data
  }
  function mioPronounFieldInputV302(field,matter,fieldValues) {
    const party=field.linked_party||'client'
    return <label style={{display:'grid',gap:4}}>Pronouns for {mioPartyLabelV302(party)}<select aria-label={'Draft pronouns for '+mioPartyLabelV302(party)} value={fieldValues.pronoun_overrides?.[party]||''} onChange={e=>updateDraftingFieldValue('pronoun_overrides',{...(fieldValues.pronoun_overrides||{}),[party]:e.target.value})}><option value="">Automatic from linked matter party</option><option value="female">She / her / hers</option><option value="male">He / him / his</option><option value="neutral">They / them / theirs</option></select><small>A choice here overrides this draft only. Change permanent values in matter information.</small></label>
  }
