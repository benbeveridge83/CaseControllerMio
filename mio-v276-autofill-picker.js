// Mio V276: replace tiny auto-fill dropdowns with a categorized source picker.
// Also adds addressable Child 1, Child 2, etc. sources and richer court/attorney sources.
export default function mioV276AutofillPicker() {
  return {
    name: 'mio-v276-autofill-source-picker',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('/src/App.jsx')) return null
      let code = source
      code = code.replace("const MIO_APP_VERSION = 'Mio V275'", "const MIO_APP_VERSION = 'Mio V276'")

      const stateAnchor = "  const [draftingWordEditorParagraphIndex, setDraftingWordEditorParagraphIndex] = useState(-1)"
      if (code.includes(stateAnchor) && !code.includes('draftingSourcePickerOpen')) {
        code = code.replace(stateAnchor, `${stateAnchor}\n  const [draftingSourcePickerOpen, setDraftingSourcePickerOpen] = useState(false)\n  const [draftingSourcePickerCategory, setDraftingSourcePickerCategory] = useState('matter')\n  const [draftingSourcePickerSearch, setDraftingSourcePickerSearch] = useState('')\n  const [draftingSourcePickerTarget, setDraftingSourcePickerTarget] = useState({ kind: 'binding', field_id: '', value: 'manual' })`)
      }

      const resolverAnchor = "    if (source === 'court.coordinator_email') {"
      if (code.includes(resolverAnchor) && !code.includes("matter.child_")) {
        const resolverAdditions = `    const childSourceMatch = String(source || '').match(/^matter\\.child_(\\d+)\\.(name|first_name|last_name|date_of_birth|age)$/)
    if (childSourceMatch) {
      const childIndex = Math.max(0, Number(childSourceMatch[1]) - 1)
      const child = children?.[childIndex] || {}
      const part = childSourceMatch[2]
      const fullName = child.name || [child.first_name || child.firstName, child.middle_name || child.middleName, child.last_name || child.lastName].filter(Boolean).join(' ')
      if (part === 'name') return fullName || field.default_value || ''
      if (part === 'first_name') return child.first_name || child.firstName || String(fullName || '').trim().split(/\\s+/)[0] || field.default_value || ''
      if (part === 'last_name') return child.last_name || child.lastName || String(fullName || '').trim().split(/\\s+/).slice(-1)[0] || field.default_value || ''
      if (part === 'date_of_birth') return child.date_of_birth || child.dob || child.birth_date || child.birthDate || field.default_value || ''
      if (part === 'age') return child.age ?? field.default_value ?? ''
    }
    if (source === 'court.phone') return court.court_phone || court.phone || field.default_value || ''
    if (source === 'court.coordinator_name') {
      const courtPeople = matter ? matterExtraFor(matter.id)?.court_people || [] : []
      return court.court_coordinator || court.coordinator || courtPeople.find((person) => /coordinator/i.test(person.title || ''))?.name || field.default_value || ''
    }
    if (source === 'court.coordinator_phone') {
      const courtPeople = matter ? matterExtraFor(matter.id)?.court_people || [] : []
      return court.court_coordinator_phone || court.coordinator_phone || courtPeople.find((person) => /coordinator/i.test(person.title || ''))?.phone || field.default_value || ''
    }
    if (source === 'court.website') return court.court_website || court.website || field.default_value || ''
    if (source === 'court.docket') return court.court_docket || court.docket || field.default_value || ''
    if (source === 'attorney.name' || source === 'attorney.bar_number' || source === 'attorney.email' || source === 'attorney.phone' || source === 'firm.name' || source === 'firm.address_line_1' || source === 'firm.address_line_2' || source === 'firm.phone' || source === 'firm.service_email') {
      const block = draftingProfileSignatureBlock()
      if (source === 'attorney.name') return block?.attorney_name || field.default_value || ''
      if (source === 'attorney.bar_number') return block?.bar_number || field.default_value || ''
      if (source === 'attorney.email') return block?.email || field.default_value || ''
      if (source === 'attorney.phone') return block?.phone || field.default_value || ''
      if (source === 'firm.name') return block?.firm_name || field.default_value || ''
      if (source === 'firm.address_line_1') return block?.address_line_1 || field.default_value || ''
      if (source === 'firm.address_line_2') return block?.address_line_2 || field.default_value || ''
      if (source === 'firm.phone') return block?.phone || field.default_value || ''
      if (source === 'firm.service_email') return draftingProfile?.firm_service_email || block?.email || field.default_value || ''
    }
    if (source === 'opposing_counsel.name' || source === 'opposing_counsel.email' || source === 'opposing_counsel.phone') {
      const counsel = matterPartyOneCounsel(matter?.id) || {}
      if (source === 'opposing_counsel.name') return draftingPersonFullName(counsel) || counsel.name || field.default_value || ''
      if (source === 'opposing_counsel.email') return counsel.email || field.default_value || ''
      if (source === 'opposing_counsel.phone') return counsel.phone || counsel.mobile_phone || field.default_value || ''
    }
`
        code = code.replace(resolverAnchor, resolverAdditions + resolverAnchor)
      }

      const visualMarker = '  function renderDraftingVisualBuilder() {'
      const visualAt = code.indexOf(visualMarker)
      if (visualAt >= 0 && !code.includes('function draftingV276SourceCategories(')) {
        const helpers = `  function draftingV276SourceCategories() {
    const childItems = []
    for (let index = 1; index <= 8; index += 1) {
      childItems.push({ value: 'matter.child_' + index + '.name', label: 'Child ' + index + ' — full name', detail: 'Individual child slot ' + index })
      childItems.push({ value: 'matter.child_' + index + '.first_name', label: 'Child ' + index + ' — first name', detail: 'Individual child slot ' + index })
      childItems.push({ value: 'matter.child_' + index + '.last_name', label: 'Child ' + index + ' — last name', detail: 'Individual child slot ' + index })
      childItems.push({ value: 'matter.child_' + index + '.date_of_birth', label: 'Child ' + index + ' — date of birth', detail: 'Individual child slot ' + index })
      childItems.push({ value: 'matter.child_' + index + '.age', label: 'Child ' + index + ' — age', detail: 'Individual child slot ' + index })
    }
    return [
      { id: 'matter', label: 'Matter', items: [
        { value: 'manual', label: 'Ask when drafting / template default', detail: 'Do not auto-fill this field' },
        { value: 'today', label: 'Today', detail: 'Current date' },
        { value: 'matter.cause_number', label: 'Cause number', detail: 'Matter cause number' },
        { value: 'matter.name', label: 'Matter display name', detail: 'Matter name in Mio' },
        { value: 'matter.case_type', label: 'Case type', detail: 'Divorce, modification, SAPCR, etc.' }
      ] },
      { id: 'court', label: 'Court information', items: [
        { value: 'matter.court_name', label: 'Court name / judicial district', detail: 'Court selected on the matter' },
        { value: 'matter.county', label: 'County', detail: 'Court or matter county' },
        { value: 'court.address', label: 'Court address', detail: 'Court mailing / physical address' },
        { value: 'court.phone', label: 'Court phone', detail: 'Court phone number' },
        { value: 'court.coordinator_name', label: 'Court coordinator name', detail: 'Coordinator for the selected court' },
        { value: 'court.coordinator_email', label: 'Court coordinator email', detail: 'Coordinator email' },
        { value: 'court.coordinator_phone', label: 'Court coordinator phone', detail: 'Coordinator phone' },
        { value: 'court.website', label: 'Court website', detail: 'Court website / procedures page' },
        { value: 'court.docket', label: 'Court docket link', detail: 'Court docket URL' }
      ] },
      { id: 'parties', label: 'Parties & children', items: [
        { value: 'matter.client_name', label: 'Client — full name', detail: 'Client linked to the matter' },
        { value: 'matter.client_email', label: 'Client — email', detail: 'Client email' },
        { value: 'matter.client_phone', label: 'Client — phone', detail: 'Client phone' },
        { value: 'matter.client_address', label: 'Client — mailing address', detail: 'Client address' },
        { value: 'matter.petitioner_name', label: 'Petitioner — full name', detail: 'Petitioner in the case' },
        { value: 'matter.respondent_name', label: 'Respondent — full name', detail: 'Respondent in the case' },
        { value: 'matter.opposing_party_name', label: 'Opposing party — full name', detail: 'First opposing party' },
        { value: 'matter.client_role', label: 'Client party role', detail: 'Petitioner, Respondent, etc.' },
        { value: 'matter.children_names', label: 'All children — names', detail: 'Comma-separated child names' },
        { value: 'matter.children', label: 'All children — name and age list', detail: 'One child per line' },
        { value: 'matter.caption_subject', label: 'Caption subject / children block', detail: 'Case-caption child wording' },
        ...childItems
      ] },
      { id: 'attorneys', label: 'Attorneys & firm', items: [
        { value: 'attorney.name', label: 'Attorney — name', detail: 'Default signature-block attorney' },
        { value: 'attorney.bar_number', label: 'Attorney — State Bar number', detail: 'Default signature block' },
        { value: 'attorney.email', label: 'Attorney — email', detail: 'Default signature block' },
        { value: 'attorney.phone', label: 'Attorney — phone', detail: 'Default signature block' },
        { value: 'firm.name', label: 'Firm — name', detail: 'Default signature block' },
        { value: 'firm.address_line_1', label: 'Firm — address line 1', detail: 'Default signature block' },
        { value: 'firm.address_line_2', label: 'Firm — address line 2', detail: 'Default signature block' },
        { value: 'firm.phone', label: 'Firm — phone', detail: 'Default signature block' },
        { value: 'firm.service_email', label: 'Firm — service email', detail: 'Default drafting profile / signature block' },
        { value: 'attorney.signature_block', label: 'Complete attorney signature block', detail: 'The configured signature text' },
        { value: 'opposing_counsel.name', label: 'Opposing counsel 1 — name', detail: 'First counsel linked to opposing party' },
        { value: 'opposing_counsel.email', label: 'Opposing counsel 1 — email', detail: 'First counsel linked to opposing party' },
        { value: 'opposing_counsel.phone', label: 'Opposing counsel 1 — phone', detail: 'First counsel linked to opposing party' }
      ] },
      { id: 'caption', label: 'Case caption & style', items: [
        { value: 'case.caption', label: 'Automatic case caption', detail: 'Caption generated from Mio case-style settings' },
        { value: 'case.style_id', label: 'Automatic case style', detail: 'Selected caption style ID' }
      ] },
      { id: 'events', label: 'Events & service', items: [
        { value: 'matter.future_events', label: 'Future matter events', detail: 'Settings and deadlines from the matter' },
        { value: 'matter.service_recipients', label: 'Service recipients', detail: 'Client and opposing counsel recipients' }
      ] },
      { id: 'relief', label: 'Requested relief', items: [
        { value: 'matter.requested_relief_ids', label: 'Selected Requested Relief options', detail: 'IDs selected for the matter' },
        { value: 'matter.requested_relief_language', label: 'Requested Relief drafting language', detail: 'Applicable saved relief clauses' }
      ] }
    ]
  }

  function draftingV276SourceLabel(value) {
    const match = draftingV276SourceCategories().flatMap((category) => category.items).find((item) => item.value === value)
    return match?.label || DRAFTING_FIELD_SOURCE_OPTIONS.find((item) => item.value === value)?.label || value || 'Ask when drafting / template default'
  }

  function draftingV276OpenSourcePicker(kind = 'binding', fieldId = '', value = 'manual') {
    const categories = draftingV276SourceCategories()
    const currentCategory = categories.find((category) => category.items.some((item) => item.value === value))
    setDraftingSourcePickerTarget({ kind, field_id: fieldId || '', value: value || 'manual' })
    setDraftingSourcePickerCategory(currentCategory?.id || 'matter')
    setDraftingSourcePickerSearch('')
    setDraftingSourcePickerOpen(true)
  }

  function draftingV276ChooseSource(value) {
    if (draftingSourcePickerTarget.kind === 'template_field' && draftingSourcePickerTarget.field_id) {
      updateDraftingTemplateField(draftingSourcePickerTarget.field_id, { source: value })
    } else {
      setDraftingBindingDraft((current) => ({ ...current, data_source: value }))
    }
    setDraftingSourcePickerOpen(false)
  }

  function draftingV276SourcePickerButton(value, onClick) {
    return <button type="button" onClick={onClick} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, minHeight: 34, padding: '7px 9px', textAlign: 'left', background: '#fff', border: '1px solid #94a3b8', borderRadius: 6, cursor: 'pointer' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{draftingV276SourceLabel(value)}</span><span aria-hidden="true">▼</span></button>
  }

  function draftingV276SourcePickerModal() {
    if (!draftingSourcePickerOpen) return null
    const categories = draftingV276SourceCategories()
    const activeCategory = categories.find((category) => category.id === draftingSourcePickerCategory) || categories[0]
    const query = String(draftingSourcePickerSearch || '').trim().toLowerCase()
    const visibleCategories = query ? categories.map((category) => ({ ...category, items: category.items.filter((item) => (item.label + ' ' + item.detail + ' ' + item.value).toLowerCase().includes(query)) })).filter((category) => category.items.length) : [activeCategory]
    const currentValue = draftingSourcePickerTarget.value || 'manual'
    return createPortal(<div onMouseDown={(event) => { if (event.target === event.currentTarget) setDraftingSourcePickerOpen(false) }} style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', padding: 24 }}>
      <section style={{ width: 'min(980px,94vw)', height: 'min(720px,88vh)', background: '#fff', borderRadius: 14, boxShadow: '0 24px 80px rgba(15,23,42,.35)', display: 'grid', gridTemplateRows: 'auto 1fr', overflow: 'hidden' }}>
        <header style={{ padding: 16, borderBottom: '1px solid #cbd5e1', display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}><div><h2 style={{ margin: 0 }}>Choose auto-fill source</h2><div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>Pick where Mio should get this value when generating a document.</div></div><button type="button" onClick={() => setDraftingSourcePickerOpen(false)} style={{ fontSize: 18, width: 36, height: 36 }}>×</button><input autoFocus value={draftingSourcePickerSearch} onChange={(event) => setDraftingSourcePickerSearch(event.target.value)} placeholder="Search cause number, child 1, court email, attorney..." style={{ gridColumn: '1 / -1', width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 15 }} /></header>
        <div style={{ minHeight: 0, display: 'grid', gridTemplateColumns: '230px minmax(0,1fr)' }}>
          <nav style={{ borderRight: '1px solid #e2e8f0', padding: 10, overflow: 'auto', background: '#f8fafc' }}>{categories.map((category) => <button type="button" key={category.id} onClick={() => { setDraftingSourcePickerCategory(category.id); setDraftingSourcePickerSearch('') }} style={{ width: '100%', border: draftingSourcePickerCategory === category.id && !query ? '2px solid #2563eb' : '1px solid transparent', background: draftingSourcePickerCategory === category.id && !query ? '#dbeafe' : 'transparent', borderRadius: 8, padding: '10px 9px', textAlign: 'left', fontWeight: 800, marginBottom: 4, color: '#0f172a' }}>{category.label}<div style={{ fontWeight: 500, color: '#64748b', fontSize: 11, marginTop: 2 }}>{category.items.length} source{category.items.length === 1 ? '' : 's'}</div></button>)}</nav>
          <main style={{ padding: 14, overflow: 'auto' }}>{visibleCategories.map((category) => <section key={category.id} style={{ marginBottom: 18 }}><h3 style={{ margin: '0 0 9px' }}>{category.label}</h3><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 8 }}>{category.items.map((item) => <button type="button" key={item.value} onClick={() => draftingV276ChooseSource(item.value)} style={{ border: item.value === currentValue ? '2px solid #2563eb' : '1px solid #cbd5e1', background: item.value === currentValue ? '#eff6ff' : '#fff', borderRadius: 9, padding: 10, textAlign: 'left', cursor: 'pointer' }}><div style={{ fontWeight: 850, color: '#0f172a' }}>{item.label}</div><div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{item.detail}</div><div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, fontFamily: 'monospace' }}>{item.value}</div></button>)}</div></section>)}{!visibleCategories.length && <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>No auto-fill sources match that search.</div>}</main>
        </div>
      </section>
    </div>, document.body)
  }

`
        code = code.slice(0, visualAt) + helpers + code.slice(visualAt)
      }

      const bindingOld = `<LabeledField label=\"Auto-fill source\"><select value={draftingBindingDraft.data_source || 'manual'} onChange={(event) => setDraftingBindingDraft((current) => ({ ...current, data_source: event.target.value }))}>{DRAFTING_FIELD_SOURCE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></LabeledField>`
      const bindingNew = `<LabeledField label=\"Auto-fill source\">{draftingV276SourcePickerButton(draftingBindingDraft.data_source || 'manual', () => draftingV276OpenSourcePicker('binding', '', draftingBindingDraft.data_source || 'manual'))}</LabeledField>`
      code = code.replace(bindingOld, bindingNew)

      const fieldOld = `<LabeledField label=\"Auto-fill source\"><select value={field.source || 'manual'} onChange={(e) => updateDraftingTemplateField(field.id, { source: e.target.value })}>{DRAFTING_FIELD_SOURCE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></LabeledField>`
      const fieldNew = `<LabeledField label=\"Auto-fill source\">{draftingV276SourcePickerButton(field.source || 'manual', () => draftingV276OpenSourcePicker('template_field', field.id, field.source || 'manual'))}</LabeledField>`
      code = code.replace(fieldOld, fieldNew)

      code = code.replace("DRAFTING_FIELD_SOURCE_OPTIONS.find((item) => item.value === field.source)?.label || field.source", "draftingV276SourceLabel(field.source)")

      const settingsEnd = "{draftingStudioTab === 'advanced' && renderDraftingAdvancedSettings()}</div>"
      if (code.includes(settingsEnd) && !code.includes("renderDraftingAdvancedSettings()}{draftingV276SourcePickerModal()")) {
        code = code.replace(settingsEnd, "{draftingStudioTab === 'advanced' && renderDraftingAdvancedSettings()}{draftingV276SourcePickerModal()}</div>")
      }

      return { code, map: null }
    }
  }
}
