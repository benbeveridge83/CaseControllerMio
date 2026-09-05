// Mio V293: template naming, matter testing, editable visual fields, case-type picker,
// and matter-timeline settings selection for drafting.
function once(code, from, to, label) {
  const first = code.indexOf(from)
  if (first < 0 || code.indexOf(from, first + from.length) >= 0) throw new Error('V293 anchor changed: ' + label)
  return code.replace(from, to)
}

export default function mioV293TemplateMatterTools() {
  return {
    name: 'mio-v293-template-matter-tools',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source
      code = code.replace(/const MIO_APP_VERSION = 'Mio V\d+[^']*'/, "const MIO_APP_VERSION = 'Mio V293 (template matter tools)'")

      code = once(code,
        "  const [draftingBindingDraft, setDraftingBindingDraft] = useState({ kind: 'field', label: '', field_key: '', data_source: 'manual', grammar_role: '', linked_party: '', relief_option_ids: [], clause_id: '', condition_key: '', replace_all: false, required: false, practice_manual_form: '', practice_manual_section: '' })",
        "  const [draftingBindingDraft, setDraftingBindingDraft] = useState({ kind: 'field', label: '', field_key: '', data_source: 'manual', grammar_role: '', linked_party: '', relief_option_ids: [], clause_id: '', condition_key: '', replace_all: false, required: false, practice_manual_form: '', practice_manual_section: '' })\n  const [draftingTemplateTest, setDraftingTemplateTest] = useState({ template_id: '', matter_id: '' })\n  const [draftingEditingBindingId, setDraftingEditingBindingId] = useState('')",
        'drafting tool state')

      code = once(code,
        "      const baseName = String(file.name || 'Word Template').replace(/\\.docx$/i, '')",
        "      const baseName = String(file.name || 'Word Template').replace(/\\.docx$/i, '')\n      const enteredName = window.prompt('Name this reusable template:', baseName)\n      if (enteredName === null) { setDraftingStudioStatus('Template upload cancelled.'); return }\n      const templateName = String(enteredName || baseName).trim() || baseName",
        'template upload name')
      code = once(code,
        "        id: draftingStudioId('draft-template'), document_type: baseName, name: baseName, category: 'Imported Word Template',",
        "        id: draftingStudioId('draft-template'), document_type: baseName, name: templateName, category: 'Imported Word Template',",
        'template saved name')

      const helperAnchor = '  function renderDraftingPage(options = {}) {'
      if (!code.includes(helperAnchor)) throw new Error('V293 anchor changed: drafting page renderer')
      const helpers = `  function mioRenameDraftingTemplateV293(template) {
    if (!template) return
    const currentName = draftingTemplateLabel(template) || template.name || ''
    const entered = window.prompt('Template name:', currentName)
    if (entered === null) return
    const name = String(entered || '').trim()
    if (!name) return alert('Enter a template name.')
    const next = cleanDraftingTemplate({ ...template, name, updated_at: new Date().toISOString() })
    setDraftingTemplates(current => current.map(item => String(item.id) === String(template.id) ? next : item))
    if (String(draftingTemplateForm?.id || '') === String(template.id)) setDraftingTemplateForm(next)
    setDraftingStudioStatus('Renamed template to “' + name + '.”')
  }

  function mioOpenTemplateForMatterV293(templateId, matterId) {
    if (!templateId) return alert('Choose a template first.')
    if (!matterId) return alert('Choose a matter to test this template with.')
    const template = draftingTemplates.find(item => String(item.id) === String(templateId))
    if (!template) return alert('Mio could not find that template.')
    const selectedFiles = draftingDefaultSelectedFiles(template)
    const matter = matters.find(item => String(item.id) === String(matterId))
    setDraftingSelection(current => ({ ...current, matter_id: matterId, template_id: templateId, selected_file_names: selectedFiles.length ? selectedFiles : (template.files || []).slice(0, 1).map(file => file.id || file.name).filter(Boolean), field_values: buildDefaultDraftingFieldValues(template, matter) }))
    setDraftingGeneratedFiles([])
    setDraftingOutput('')
    setDraftingStudioTab('compose')
    window.location.hash = 'drafting'
  }

  function mioTemplateMatterTesterV293(template) {
    if (!template) return null
    const matterId = draftingTemplateTest.template_id === template.id ? draftingTemplateTest.matter_id : ''
    const matterChoices = matters.filter(matter => matter?.is_active !== false).slice().sort((a, b) => matterClientName(a).localeCompare(matterClientName(b)))
    return <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #dbeafe' }}>
      <div style={{ fontSize: 11, fontWeight: 900, marginBottom: 4 }}>Test this template with a matter</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select aria-label={'Matter for ' + (template.name || 'template')} value={matterId} onChange={event => setDraftingTemplateTest({ template_id: template.id, matter_id: event.target.value })} style={{ minWidth: 235, maxWidth: '100%' }}>
          <option value="">Choose matter...</option>
          {matterChoices.map(matter => <option key={matter.id} value={matter.id}>{[matterClientName(matter), matter.name || draftingMatterTypeValue(matter), matter.cause_number || ''].filter(Boolean).join(' — ')}</option>)}
        </select>
        <button type="button" disabled={!matterId} onClick={() => mioOpenTemplateForMatterV293(template.id, matterId)}>Open for matter</button>
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>Uses this reusable template with the selected matter. Missing values can be filled in before previewing or downloading the generated Word document.</div>
    </div>
  }

  function mioEditBindingV293(bindingOrId) {
    const template = draftingStudioCurrentTemplate()
    const binding = typeof bindingOrId === 'string' ? (template?.bindings || []).find(item => String(item.id) === String(bindingOrId)) : bindingOrId
    if (!binding) return
    setDraftingEditingBindingId(binding.id)
    setDraftingBindingDraft({
      kind: binding.kind || 'field', label: binding.label || '', field_key: binding.field_key || '', data_source: binding.data_source || 'manual', grammar_role: binding.grammar_role || '', linked_party: binding.linked_party || '', relief_option_ids: binding.relief_option_ids || [], clause_id: binding.clause_id || '', condition_key: binding.condition_key || '', replace_all: binding.replace_all === true, required: binding.required === true, practice_manual_form: binding.practice_manual_form || '', practice_manual_section: binding.practice_manual_section || ''
    })
    setDraftingStudioSelection({ source_text: binding.source_text || '', paragraph_start: Number(binding.paragraph_start || 0), paragraph_end: Number(binding.paragraph_end ?? binding.paragraph_start ?? 0), section_name: binding.practice_manual_section || '' })
    window.requestAnimationFrame(() => document.getElementById('drafting-binding-editor-v293')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function mioCancelBindingEditV293() {
    setDraftingEditingBindingId('')
    setDraftingStudioSelection(null)
    setDraftingBindingDraft({ kind: 'field', label: '', field_key: '', data_source: 'manual', grammar_role: '', linked_party: '', relief_option_ids: [], clause_id: '', condition_key: '', replace_all: false, required: false, practice_manual_form: draftingStudioDocument?.practice_manual_form || '', practice_manual_section: '' })
  }

  function mioSaveBindingEditV293() {
    const template = draftingStudioCurrentTemplate()
    const old = (template?.bindings || []).find(item => String(item.id) === String(draftingEditingBindingId))
    if (!template || !old) return alert('Select a saved field first.')
    const nextBinding = draftingNormalizeBinding({ ...old, ...draftingBindingDraft, id: old.id, source_text: old.source_text, paragraph_start: old.paragraph_start, paragraph_end: old.paragraph_end, file_id: old.file_id, is_active: old.is_active !== false })
    if (['field','pronoun','paragraph_choice'].includes(nextBinding.kind)) nextBinding.field_key = draftingNormalizeFieldKey(nextBinding.field_key || nextBinding.label || old.field_key)
    const nextFields = (template.fields || []).map(field => String(field.key) === String(old.field_key || '') ? { ...field, key: nextBinding.field_key || field.key, label: nextBinding.label || field.label, source: nextBinding.data_source || field.source, grammar_role: nextBinding.grammar_role || '', linked_party: nextBinding.linked_party || '', required: nextBinding.required === true } : field)
    const next = cleanDraftingTemplate({ ...template, fields: nextFields, bindings: (template.bindings || []).map(item => String(item.id) === String(old.id) ? nextBinding : item), visual_builder_status: 'reviewed', updated_at: new Date().toISOString() })
    setDraftingTemplates(current => current.map(item => String(item.id) === String(next.id) ? next : item))
    setDraftingTemplateForm(next)
    setDraftingStudioStatus('Updated field “' + (nextBinding.label || nextBinding.field_key || nextBinding.source_text) + '.”')
    mioCancelBindingEditV293()
  }

  function draftingAllEventsForMatterV293(matter) {
    if (!matter) return []
    return events.filter(event => {
      const eventMatterId = event.matter_id || event.matters?.id || ''
      return String(eventMatterId) === String(matter.id) && event.is_active !== false && !isUndatedEventDate(event.start_date)
    }).sort((a, b) => (String(a.start_date || '') + 'T' + String(a.start_time || '')).localeCompare(String(b.start_date || '') + 'T' + String(b.start_time || '')))
  }

`
      code = code.replace(helperAnchor, helpers + helperAnchor)

      const actionBar = '<button type="button" onClick={() => { editDraftingTemplate(template); setDraftingStudioTab(\'advanced\') }}>Advanced details</button>'
      code = once(code, actionBar, actionBar + '<button type="button" onClick={() => mioRenameDraftingTemplateV293(template)}>Rename</button>', 'template rename button')
      const cardEnd = "{(template.files || []).length > 0 && <div style={{ display: 'grid', gap: 5, borderTop: '1px solid #e2e8f0', marginTop: 10, paddingTop: 8 }}>{template.files.map((file) => <div key={file.id || file.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span><button type=\"button\" onClick={() => downloadDraftingTemplateFile(file)} style={{ padding: '3px 7px' }}>Download</button></div>)}</div>}"
      code = once(code, cardEnd, cardEnd + '{mioTemplateMatterTesterV293(template)}', 'matter tester on template card')

      const caseTypeInput = '<LabeledField label="Case-type matches"><input value={(style.case_type_patterns || []).join(\', \')} onChange={(event) => updateStyle(style.id, { case_type_patterns: draftingNormalizePatternList(event.target.value) })} placeholder="divorce, SAPCR, modification" /></LabeledField>'
      const caseTypePicker = `<div><div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 4 }}>Case-type matches</div><details style={{ position: 'relative' }}><summary style={{ border: '1px solid #94a3b8', borderRadius: 4, padding: '5px 7px', cursor: 'pointer', background: '#fff' }}>{(style.case_type_patterns || []).length ? (style.case_type_patterns || []).join(', ') : 'Select case types...'}</summary><div style={{ position: 'absolute', zIndex: 40, width: 300, maxHeight: 300, overflow: 'auto', background: '#fff', border: '1px solid #94a3b8', borderRadius: 7, padding: 8, boxShadow: '0 10px 24px rgba(15,23,42,.18)' }}>{options('matter_type').map(option => { const value = String(option.name || '').trim(); const selected = (style.case_type_patterns || []).includes(value); return <label key={option.id || value} style={{ display: 'block', padding: '5px 2px' }}><input type="checkbox" checked={selected} onChange={() => updateStyle(style.id, { case_type_patterns: selected ? (style.case_type_patterns || []).filter(item => item !== value) : [...(style.case_type_patterns || []), value] })} /> {value}</label> })}{!options('matter_type').length && <div style={{ color: '#92400e', fontSize: 12 }}>No Case Type options are configured in Settings → Dropdown Options → Case Type.</div>}</div></details></div>`
      code = once(code, caseTypeInput, caseTypePicker, 'case-type checkbox picker')

      const mark = "rendered.push(<mark key={`${marker.id}-${marker.start}`} title={`${marker.isSuggestion ? 'AI suggestion' : 'Saved binding'}: ${marker.label || marker.kind}`} style={{ ...palette, borderBottom: `2px solid ${palette.border}`, borderRadius: 3, padding: '1px 2px' }}>{text.slice(marker.start, marker.end)}</mark>)"
      code = once(code, mark, "rendered.push(<mark key={`${marker.id}-${marker.start}`} onClick={(event) => { if (!marker.isSuggestion) { event.stopPropagation(); mioEditBindingV293(marker.id) } }} title={`${marker.isSuggestion ? 'AI suggestion' : 'Saved binding'}: ${marker.label || marker.kind}${marker.isSuggestion ? '' : ' — click to edit'}`} style={{ ...palette, borderBottom: `2px solid ${palette.border}`, borderRadius: 3, padding: '1px 2px', cursor: marker.isSuggestion ? 'default' : 'pointer' }}>{text.slice(marker.start, marker.end)}</mark>)", 'click saved field to edit')

      code = once(code,
        '<section style={{ border: \'1px solid #60a5fa\', borderRadius: 10, padding: 11, background: \'#eff6ff\' }}><h3 style={{ marginTop: 0 }}>Create binding from highlight</h3>',
        '<section id="drafting-binding-editor-v293" style={{ border: \'1px solid #60a5fa\', borderRadius: 10, padding: 11, background: \'#eff6ff\' }}><h3 style={{ marginTop: 0 }}>{draftingEditingBindingId ? \'Edit selected field\' : \'Create binding from highlight\'}</h3>{draftingEditingBindingId && <div style={{ marginBottom: 8, fontSize: 12, color: \'#1e3a8a\', fontWeight: 800 }}>Editing saved field. Change its name, field key, auto-fill source, or other options below.</div>}',
        'field editor heading')

      const saveBindingButton = '<button type="button" onClick={draftingStudioAddBindingFromSelection} disabled={!draftingStudioSelection} style={{ fontWeight: 900 }}>Save highlighted binding</button>'
      code = once(code, saveBindingButton, "<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><button type=\"button\" onClick={draftingEditingBindingId ? mioSaveBindingEditV293 : draftingStudioAddBindingFromSelection} disabled={!draftingStudioSelection} style={{ fontWeight: 900 }}>{draftingEditingBindingId ? 'Save field changes' : 'Save highlighted binding'}</button>{draftingEditingBindingId && <button type=\"button\" onClick={mioCancelBindingEditV293}>Cancel edit</button>}</div>", 'field editor save button')

      const savedButtons = '<button type="button" onClick={() => document.getElementById(`drafting-paragraph-${binding.paragraph_start}`)?.scrollIntoView({ behavior: \'smooth\', block: \'center\' })}>Show</button><button type="button" onClick={() => draftingStudioDeleteBinding(binding.id)} style={{ color: \'#991b1b\' }}>Delete</button>'
      code = once(code, savedButtons, '<button type="button" onClick={() => mioEditBindingV293(binding)} style={{ fontWeight: 800, color: \'#1d4ed8\' }}>Edit field</button>' + savedButtons, 'saved binding edit button')

      code = once(code,
        '    const pendingEventIds = Array.isArray(fieldValues.pending_settings) ? fieldValues.pending_settings.map(String) : []\n    const allMatterEvents = draftingFutureEventsForMatter(matter)',
        "    const pendingEventIds = Array.isArray(fieldValues.pending_settings) ? fieldValues.pending_settings.map(String) : []\n    const allMatterEvents = fieldValues.pending_settings_scope === 'all' ? draftingAllEventsForMatterV293(matter) : draftingFutureEventsForMatter(matter)",
        'settings scope assembly')
      code = once(code,
        '      pending_settings: pendingRows.length ? pendingRows : [{ title: \'No pending settings or deadlines\', date: \'\' }],',
        "      pending_settings: pendingRows.length ? pendingRows : [{ title: 'No pending settings or deadlines', date: '' }],\n      pending_settings_scope: fieldValues.pending_settings_scope === 'all' ? 'all' : 'future',",
        'settings scope output')

      code = once(code,
        '    const futureEvents = draftingFutureEventsForMatter(matter)',
        "    const futureEvents = draftingFutureEventsForMatter(matter)\n    const allDatedEventsV293 = draftingAllEventsForMatterV293(matter)\n    const pendingSettingsScopeV293 = fieldValues.pending_settings_scope === 'all' ? 'all' : 'future'\n    const settingsEventsV293 = pendingSettingsScopeV293 === 'all' ? allDatedEventsV293 : futureEvents",
        'composer timeline sources')

      const eventListStart = "      if (field.type === 'event_list') {"
      const eventListEnd = "      if (field.type === 'event_select')"
      const a = code.indexOf(eventListStart)
      const b = a >= 0 ? code.indexOf(eventListEnd, a) : -1
      if (a < 0 || b < 0) throw new Error('V293 anchor changed: event list field renderer')
      const eventList = `      if (field.type === 'event_list') {
        const selected = Array.isArray(value) ? value.map(String) : []
        return <div style={{ display: 'grid', gap: 7 }}>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 12, fontWeight: 800 }}>Matter timeline<select aria-label="Settings timeline scope" value={pendingSettingsScopeV293} onChange={(event) => { const scope = event.target.value; updateDraftingFieldValue('pending_settings_scope', scope); const source = scope === 'all' ? allDatedEventsV293 : futureEvents; updateDraftingFieldValue(field.key, source.map(item => String(item.id))) }} style={{ marginLeft: 6 }}><option value="future">Future settings only</option><option value="all">All dated settings</option></select></label>
            <button type="button" onClick={() => updateDraftingFieldValue(field.key, settingsEventsV293.map(event => String(event.id)))} style={{ padding: '4px 8px', fontWeight: 800 }}>Load timeline from Matter Dashboard</button>
            <button type="button" onClick={() => updateDraftingFieldValue(field.key, [])} style={{ padding: '4px 8px' }}>Select none</button>
          </div>
          <div style={{ color: '#475569', fontSize: 11 }}>Choose whether the withdrawal document should list only future settings or every dated setting on this matter. Uncheck individual rows if one should not appear.</div>
          {settingsEventsV293.length === 0 && <div style={{ color: '#92400e', fontSize: 13 }}>No {pendingSettingsScopeV293 === 'all' ? 'dated' : 'future'} matter settings or deadlines were found.</div>}
          {settingsEventsV293.map((event) => <label key={event.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 7, alignItems: 'start', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', background: selected.includes(String(event.id)) ? '#eff6ff' : '#fff' }}><input type="checkbox" checked={selected.includes(String(event.id))} onChange={() => toggleDraftingCheckboxValue(field.key, String(event.id))} /><span><strong>{draftingEventTitle(event)}</strong><br /><span style={{ color: '#64748b', fontSize: 12 }}>{draftingEventDateTimeLong(event)}</span></span></label>)}
          {commonHelp}
        </div>
      }
`
      code = code.slice(0, a) + eventList + code.slice(b)

      return { code, map: null }
    }
  }
}
