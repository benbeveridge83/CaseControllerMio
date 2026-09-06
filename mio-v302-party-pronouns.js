import fs from 'node:fs'
const fragment=fs.readFileSync(new URL('./src/mioPronounApp.fragment.jsx',import.meta.url),'utf8')
function once(code,from,to){if(code.split(from).length!==2)throw new Error('V302 integration anchor changed: '+from.slice(0,100));return code.replace(from,()=>to)}
function region(code,start,end,replacement){const a=code.indexOf(start),b=code.indexOf(end,a);if(a<0||b<a)throw new Error('V302 region changed: '+start);return code.slice(0,a)+replacement+'\n\n'+code.slice(b)}
export default function mioV302PartyPronouns(){return{name:'mio-v302-party-pronouns',enforce:'pre',transform(source,id){
 if(!id.split('?')[0].replaceAll('\\','/').endsWith('/src/App.jsx'))return null
 let code="import { PronounControls as MioPronounControlsV302, PartySexFields as MioPartySexFieldsV302, MatterPronounEditor as MioMatterPronounEditorV302, PronounReview as MioPronounReviewV302 } from './MioPronounControls.jsx'\nimport { preparePronounBinding as mioPreparePronounV302, suggestGrammar as mioSuggestGrammarV302, resolveLinkedPronoun as mioLinkedPronounV302, linkedPronounIssues as mioPronounIssuesV302, matterPronounParties as mioMatterPartiesV302, collectMatterChildren as mioChildrenV302, partyLabel as mioPartyLabelV302 } from './mioPartyPronouns.js'\nimport { generatedCaseCaption as mioGenerateCaptionV302 } from './mioDraftingComponents.js'\n"+source
 code=once(code,"const MIO_APP_VERSION = 'Mio V301 (fast tabs / precise settings)'","const MIO_APP_VERSION = 'Mio V302 (party pronouns / adaptive captions)'")
 code=once(code,"  { value: 'field', label: 'Fill-in field' },","  { value: 'field', label: 'Source field' },")
 code=once(code,"  { value: 'pronoun', label: 'Linked pronoun' },","  { value: 'pronoun', label: 'Pronoun field - linked to a party' },")
 code=once(code,"    linked_party: binding.linked_party || '',","    linked_party: binding.linked_party || '',\n    pronoun_schema: binding.pronoun_schema || '',\n    party_link_mode: binding.party_link_mode || '',\n    suggested_by_binding: binding.suggested_by_binding || '',\n    pronoun_override: binding.pronoun_override || '',")
 code=once(code,"    role: party?.role || party?.party_type || '',","    role: party?.role || party?.party_type || '',\n    sex: party?.sex ?? party?.gender ?? '',\n    pronoun_set: party?.pronoun_set ?? party?.pronouns ?? '',\n    date_of_birth: party?.date_of_birth || party?.dob || '',\n    age: party?.age ?? '',")
 code=once(code,"      source: 'client'\n    }, matterId, 0)","      source: 'client', sex: extra.client_sex ?? client?.sex ?? client?.gender ?? '', pronoun_set: extra.client_pronoun_set ?? client?.pronoun_set ?? client?.pronouns ?? ''\n    }, matterId, 0)")
 code=once(code,"        source: 'opposing'\n      }, matterId, rows.length)","        source: 'opposing', sex: party?.sex ?? party?.gender ?? '', pronoun_set: party?.pronoun_set ?? party?.pronouns ?? ''\n      }, matterId, rows.length)")
 code=once(code,"        name: party.name || prior.name || '',","        id: party.id, sex: party.sex, pronoun_set: party.pronoun_set, date_of_birth: party.date_of_birth,\n        name: party.name || prior.name || '',")
 code=once(code,'        <h2>Parties and Counsels</h2>','        <h2>Parties and Counsels</h2>{mioMatterPronounDraftPanelV302()}')
 // Persist sex with the existing matter-party editor and existing cloud save path.
 const partyInput='<input style={{ gridColumn: \'span 2\' }} value={party.email || \'\'} onChange={(event) => updateLitigationMatterPartyAt(matter.id, index, { email: event.target.value })} placeholder="Party email" />'
 code=once(code,partyInput,partyInput+'<div style={{gridColumn:\'span 2\'}}><MioPartySexFieldsV302 party={party} onChange={patch=>updateLitigationMatterPartyAt(matter.id,index,patch)}/></div>')
 code=region(code,'  function draftingChildrenForMatter(matter) {','  function draftingClientRoleForMatter(matter) {',"  function draftingChildrenForMatter(matter) { return matter ? mioChildrenV302(matter,matterExtraFor(matter.id)) : [] }")
 // Do not snapshot inferred pronoun sets into draft fields; resolve the current party at generation.
 const oldDefault="    if (field?.type === 'pronoun_set') {\n      const gender = String(client?.gender || client?.sex || '').toLowerCase()\n      if (/male|man|boy/.test(gender)) return 'male'\n      if (/female|woman|girl/.test(gender)) return 'female'\n    }"
 code=once(code,oldDefault,"    if (field?.type === 'pronoun_set') return ''")
 code=once(code,"    const source = field?.source || 'manual'\n    const client", "    if (field?.type === 'pronoun_set') return ''\n    const source = field?.source || 'manual'\n    const client")
 code=once(code,'  function buildDraftingAssemblyData(template, matter, fieldValues = {}) {',fragment+'\n  function buildDraftingAssemblyDataLegacyV302(template, matter, fieldValues = {}) {')
 code=once(code,"      children: resolvedChildren.length ? resolvedChildren : [{ name: '', age: '' }],","      children: resolvedChildren,")
 code=once(code,"      case_style_id: data?.case_style_id || mioTemplateFileSetup.case_style_id || '',","      case_style_id: data?._case_style_override || mioDraftFileSetup.case_style_id || mioTemplateFileSetup.case_style_id || '',")
 code=region(code,"    if (binding.kind === 'pronoun') {","    if (binding.kind === 'relief_clause') {","    if (binding.kind === 'pronoun') return mioLinkedPronounV302(binding,data).value")
 code=once(code,"  function draftingPreflightIssues(template, matter, data, fieldValues = {}) {\n    const issues = []","  function draftingPreflightIssues(template, matter, data, fieldValues = {}) {\n    const issues = mioPronounIssuesV302(template,data,draftingSelection.selected_file_names||[])")
 const rangeAt=code.indexOf('    rangeBindings.forEach((binding) => {'),rangeEnd=code.indexOf("    bindings.filter((binding) =>",rangeAt)
 if(rangeAt<0||rangeEnd<rangeAt)throw new Error('V302 caption range moved')
 const ranges=once(code.slice(rangeAt,rangeEnd),'const replacement = draftingBindingValue(binding, data, template)',"const replacement = binding.kind==='caption_block' ? '[[MIO_BLOCK:caption]]' : draftingBindingValue(binding, data, template)")
 code=code.slice(0,rangeAt)+ranges+code.slice(rangeEnd)
 code=once(code,'    const componentErrors = mioComponentIssues(data, templateFile)','    const pronounErrorsV302=mioPronounIssuesV302(template,data,[templateFile]);if(pronounErrorsV302.length)throw new Error(pronounErrorsV302.map(i=>i.message).join(\' \'))\n    const componentErrors = mioComponentIssues(data, templateFile)')
 const type='onChange={(event) => setDraftingBindingDraft((current) => ({ ...current, kind: event.target.value }))}'
 code=once(code,type,'onChange={(event) => mioSelectBindingKindV302(event.target.value)}')
 code=once(code,"{['field','pronoun','paragraph_choice'].includes(draftingBindingDraft.kind) &&", "{['field','paragraph_choice'].includes(draftingBindingDraft.kind) &&")
 const start="              {draftingBindingDraft.kind === 'pronoun' &&",end="              {draftingBindingDraft.kind === 'relief_clause' &&"
 code=region(code,start,end,"              {draftingBindingDraft.kind === 'pronoun' && <MioPronounControlsV302 value={draftingBindingDraft} sourceText={draftingStudioSelection?.source_text||''} onChange={patch=>setDraftingBindingDraft(current=>({...current,...patch}))}/>}")
 code=once(code,'checked={!!draftingBindingDraft.replace_all}','disabled={draftingBindingDraft.kind===\'pronoun\'} checked={draftingBindingDraft.kind!==\'pronoun\'&&!!draftingBindingDraft.replace_all}')
 code=once(code,'    draftingStudioCommitBinding({ ...suggestion, id:', '    const savedV302=draftingStudioCommitBinding({ ...suggestion, id:')
 code=once(code,'    setDraftingAiSuggestions((current) => current.filter((item) => item.id !== suggestion.id))','    if(savedV302)setDraftingAiSuggestions((current) => current.filter((item) => item.id !== suggestion.id))')
 // Pronoun suggestions offer party/grammar, never the ordinary source picker.
 code=once(code,'<SuggestionInspector suggestion={suggestion}',"<SuggestionInspector suggestion={suggestion.kind==='pronoun'?mioPreparePronounV302(suggestion,template,draftingStudioCurrentFile(template),draftingStudioDocument):suggestion}")
 const inputStart="      if (field.type === 'pronoun_set') return ",pos=code.indexOf(inputStart),lineEnd=code.indexOf('\n',pos)
 if(pos<0)throw new Error('V302 pronoun draft input moved')
 code=code.slice(0,pos)+"      if (field.type === 'pronoun_set') return mioPronounFieldInputV302(field,matter,fieldValues)"+code.slice(lineEnd)
 code=once(code,"if (field.required && draftingValueMissing(['case_style_id', 'signature_block_id'].includes(field.key) ? data?.[field.key] : fieldValues[field.key]))", "if (field.type!=='pronoun_set' && field.required && draftingValueMissing(['case_style_id', 'signature_block_id'].includes(field.key) ? data?.[field.key] : fieldValues[field.key]))")
 const read='{isAssembly && matter && assemblyData && renderMioDraftingReadinessV287(template, matter, assemblyData, fieldValues)}'
 code=once(code,read,read+"{isAssembly && matter && assemblyData && <><MioPronounReviewV302 template={template} data={assemblyData} selectedFiles={selectedFileKeys}/><MioMatterPronounEditorV302 parties={assemblyData._pronoun_parties} onChange={(id,patch)=>mioEditMatterPronounsV302(matter,id,patch)}/></>}")
 return {code,map:null}
}}}
