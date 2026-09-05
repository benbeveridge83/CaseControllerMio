// Mio V296: improve local case-specific detection, use categorized source picker for AI suggestions,
// and let party sex/pronoun data drive drafting pronouns.
function once(code, from, to, label) {
  const at = code.indexOf(from)
  if (at < 0 || code.indexOf(from, at + from.length) >= 0) throw new Error('V296 AI anchor changed: ' + label)
  return code.replace(from, to)
}
export default function mioV296AiPronouns() {
  return { name: 'mio-v296-ai-pronouns', enforce: 'pre', transform(source, id) {
    const path = id.split('?')[0].replaceAll('\\', '/')
    if (!path.endsWith('/src/App.jsx')) return null
    let code = source
    code = once(code,
`function ensureLitigationPartyShape(party = {}, matterId = '', index = 0) {
  return {
    id: party?.id || \`lit-party-\${matterId || 'matter'}-\${index + 1}\`,
    role: party?.role || party?.party_type || '',
    name: party?.name || '',
    email: party?.email || '',
    attorney_name: party?.attorney_name || party?.counsel?.name || '',
    attorney_email: party?.attorney_email || party?.counsel?.email || '',
    source: ['client', 'opposing', 'other'].includes(party?.source) ? party.source : 'other'
  }
}`,
`function ensureLitigationPartyShape(party = {}, matterId = '', index = 0) {
  return {
    id: party?.id || \`lit-party-\${matterId || 'matter'}-\${index + 1}\`,
    role: party?.role || party?.party_type || '', name: party?.name || '', sex: party?.sex || party?.gender || '',
    date_of_birth: party?.date_of_birth || party?.dob || '', phone: party?.phone || '', address: party?.address || '', email: party?.email || '',
    attorney_name: party?.attorney_name || party?.counsel?.name || '', attorney_email: party?.attorney_email || party?.counsel?.email || '',
    source: ['client', 'opposing', 'other'].includes(party?.source) ? party.source : 'other'
  }
}`, 'party shape')

    code = once(code,
`    if (field?.type === 'pronoun_set') {
      const gender = String(client?.gender || client?.sex || '').toLowerCase()
      if (/male|man|boy/.test(gender)) return 'male'
      if (/female|woman|girl/.test(gender)) return 'female'
    }`,
`    if (field?.type === 'pronoun_set') {
      const extra = matter ? matterExtraFor(matter.id) : {}
      const partyRows = matter ? litigationMatterPartyRows(matter.id) : []
      const linked = String(field?.linked_party || '').toLowerCase()
      let gender = String(client?.gender || client?.sex || extra?.client_sex || '').toLowerCase()
      if (/petitioner/.test(linked)) gender = String(partyRows.find((row) => /petitioner/i.test(row.role || ''))?.sex || gender).toLowerCase()
      else if (/respondent/.test(linked)) gender = String(partyRows.find((row) => /respondent/i.test(row.role || ''))?.sex || gender).toLowerCase()
      else if (/opposing/.test(linked)) gender = String(partyRows.find((row) => row.source === 'opposing')?.sex || gender).toLowerCase()
      if (/male|man|boy|^m$/.test(gender)) return 'male'
      if (/female|woman|girl|^f$/.test(gender)) return 'female'
      if (/neutral|nonbinary|non-binary|they/.test(gender)) return 'neutral'
    }`, 'pronouns')

    code = once(code, "    if (source === 'matter.client_address') return draftingMultilineAddress(client) || field.default_value || ''",
      "    if (source === 'matter.client_address') return draftingMultilineAddress(client) || field.default_value || ''\n    if (source === 'matter.client_sex') return matterExtraFor(matter?.id)?.client_sex || client?.sex || client?.gender || field.default_value || ''\n    if (source === 'matter.petitioner_sex') return litigationMatterPartyRows(matter?.id).find((row) => /petitioner/i.test(row.role || ''))?.sex || field.default_value || ''\n    if (source === 'matter.respondent_sex') return litigationMatterPartyRows(matter?.id).find((row) => /respondent/i.test(row.role || ''))?.sex || field.default_value || ''", 'sex sources')

    code = once(code,
`  function draftingV276ChooseSource(value) {
    if (draftingSourcePickerTarget.kind === 'template_field' && draftingSourcePickerTarget.field_id) {
      updateDraftingTemplateField(draftingSourcePickerTarget.field_id, { source: value })
    } else {
      setDraftingBindingDraft((current) => ({ ...current, data_source: value }))
    }
    setDraftingSourcePickerOpen(false)
  }`,
`  function draftingV276ChooseSource(value) {
    if (draftingSourcePickerTarget.kind === 'template_field' && draftingSourcePickerTarget.field_id) updateDraftingTemplateField(draftingSourcePickerTarget.field_id, { source: value })
    else if (draftingSourcePickerTarget.kind === 'suggestion' && draftingSourcePickerTarget.field_id) setDraftingAiSuggestions((current) => current.map((item) => String(item.id) === String(draftingSourcePickerTarget.field_id) ? { ...item, data_source: value } : item))
    else setDraftingBindingDraft((current) => ({ ...current, data_source: value }))
    setDraftingSourcePickerOpen(false)
  }`, 'AI source picker')

    code = code.replace("        { value: 'matter.client_address', label: 'Client — mailing address', detail: 'Client address' },",
      "        { value: 'matter.client_address', label: 'Client — mailing address', detail: 'Client address' },\n        { value: 'matter.client_sex', label: 'Client — sex / pronoun basis', detail: 'Sex saved on Matter Information' },\n        { value: 'matter.petitioner_sex', label: 'Petitioner — sex / pronoun basis', detail: 'Petitioner sex saved on Matter Information' },\n        { value: 'matter.respondent_sex', label: 'Respondent — sex / pronoun basis', detail: 'Respondent sex saved on Matter Information' },")

    const aiButtons = `<div style={{ display: 'flex', gap: 5, marginTop: 6 }}><button type="button" onClick={() => draftingStudioAcceptSuggestion(suggestion)} style={{ color: '#166534', fontWeight: 850 }}>Accept</button>`
    code = once(code, aiButtons, `<div style={{ marginTop: 6 }}><div style={{ fontSize: 11, fontWeight: 800, marginBottom: 3 }}>Field source</div>{draftingV276SourcePickerButton(suggestion.data_source || 'manual', () => draftingV276OpenSourcePicker('suggestion', suggestion.id, suggestion.data_source || 'manual'))}</div>${aiButtons}`, 'AI card source picker')

    const reliefAnchor = '    document.sections.forEach((section) => {'
    if (!code.includes(reliefAnchor)) throw new Error('V296 AI anchor changed: local suggestions')
    const detection = `    const detectedV296 = new Set(suggestions.map((item) => String(item.source_text || '').toLowerCase()))
    const addV296 = (paragraph, sourceText, label, fieldKey, dataSource, confidence = .94) => {
      const clean = String(sourceText || '').trim(); if (!clean || detectedV296.has(clean.toLowerCase())) return
      const at = String(paragraph?.text || '').indexOf(clean); if (at < 0) return; detectedV296.add(clean.toLowerCase())
      suggestions.push({ id: draftingStudioId('suggestion'), kind: 'field', label, field_key: fieldKey, field_type: 'text', data_source: dataSource, file_id: document.file_id, paragraph_start: paragraph.index, paragraph_end: paragraph.index, start_offset: at, end_offset: at + clean.length, source_text: clean, replace_all: true, confidence, source: 'local_rule', reason: 'Case-specific value detected from its label/context.', practice_manual_form: document.practice_manual_form || '', practice_manual_section: paragraph.section_name || '' })
    }
    document.paragraphs.forEach((paragraph) => {
      const text = String(paragraph.text || ''); let match
      match = text.match(/cause\\s*(?:no\\.?|number)\\s*[:#.]?\\s*([A-Z0-9-]{4,})/i); if (match) addV296(paragraph, match[1], 'Cause number', 'cause_number', 'matter.cause_number', .99)
      match = text.match(/(?:e-?mail(?:\\s+address)?|email)\\s*[:\\-]?\\s*([^\\s,;]+@[^\\s,;]+)/i); if (match) addV296(paragraph, match[1], 'Client email', 'client_email', 'matter.client_email', .99)
      match = text.match(/(?:telephone|phone)(?:\\s+number)?\\s*[:\\-]?\\s*(\\(?\\d{3}\\)?[\\s.-]*\\d{3}[\\s.-]*\\d{4})/i); if (match) addV296(paragraph, match[1], 'Client phone', 'client_phone', 'matter.client_phone', .98)
      match = text.match(/(?:mailing\\s+address|client\\s+address|address)\\s*[:\\-]?\\s*(.+)$/i); if (match && /\\d/.test(match[1])) addV296(paragraph, match[1], 'Client mailing address', 'client_address_inline', 'matter.client_address', .98)
      match = text.match(/(?:attorney(?:\\s+in\\s+charge)?\\s+for|counsel\\s+for|served\\s+to)\\s+([A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+){1,3})/); if (match) addV296(paragraph, match[1], 'Represented client name', 'client_name', 'matter.client_name', .90)
    })
`
    code = code.replace(reliefAnchor, detection + reliefAnchor)
    return { code, map: null }
  }}
}
