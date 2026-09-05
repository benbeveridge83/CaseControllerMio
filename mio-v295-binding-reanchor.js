// Mio V295: saved drafting bindings are anchored by their actual source text + character offsets,
// not only by a fragile paragraph number. This repairs fields after Word parsing/layout changes.
export default function mioV295BindingReanchor() {
  return {
    name: 'mio-v295-binding-reanchor',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source
      code = code.replace(/const MIO_APP_VERSION = 'Mio V294[^']*'/, "const MIO_APP_VERSION = 'Mio V295 (stable drafting field anchors)'")

      const editStart = code.indexOf('  function mioEditBindingV293(bindingOrId) {')
      const editEnd = editStart >= 0 ? code.indexOf('  function mioCancelBindingEditV293() {', editStart) : -1
      if (editStart < 0 || editEnd < 0) throw new Error('V295 anchor changed: V293 field editor')

      const replacement = `  function mioCanonicalFieldKeyV295(binding) {
    const source = String(binding?.data_source || '')
    const known = {
      'matter.cause_number': 'cause_number',
      'matter.client_name': 'client_name',
      'matter.client_email': 'client_email',
      'matter.client_phone': 'client_phone',
      'matter.client_address': 'client_address_inline'
    }
    return known[source] || binding?.field_key || ''
  }

  function mioResolveBindingLocationV295(binding, document = draftingStudioDocument) {
    if (!binding) return null
    const paragraphs = Array.isArray(document?.paragraphs) ? document.paragraphs : []
    const source = String(binding.source_text || '')
    const storedIndex = Number(binding.paragraph_start)
    const storedStart = Number(binding.start_offset)
    const caseInsensitive = binding.kind === 'pronoun'
    const needle = caseInsensitive ? source.toLowerCase() : source
    if (!needle || !paragraphs.length) return {
      paragraph_start: Number.isFinite(storedIndex) ? storedIndex : 0,
      paragraph_end: Number.isFinite(Number(binding.paragraph_end)) ? Number(binding.paragraph_end) : (Number.isFinite(storedIndex) ? storedIndex : 0),
      start_offset: Number.isFinite(storedStart) ? storedStart : 0,
      end_offset: Number.isFinite(Number(binding.end_offset)) ? Number(binding.end_offset) : ((Number.isFinite(storedStart) ? storedStart : 0) + source.length)
    }
    const candidates = []
    paragraphs.forEach((paragraph, arrayIndex) => {
      const text = String(paragraph?.text || '')
      const haystack = caseInsensitive ? text.toLowerCase() : text
      let at = haystack.indexOf(needle)
      while (at >= 0) {
        let score = 0
        if (Number.isFinite(storedStart) && at === storedStart) score += 100000
        if (Number.isFinite(storedIndex)) score -= Math.abs(Number(paragraph?.index ?? arrayIndex) - storedIndex) * 5
        const before = text.slice(Math.max(0, at - 24), at).toLowerCase()
        const key = String(binding.field_key || '').toLowerCase()
        if (key.includes('email') && before.includes('email')) score += 1000
        if (key.includes('phone') && /(telephone|phone)/.test(before)) score += 1000
        if (key.includes('address') && before.includes('address')) score += 1000
        if (key.includes('cause') && /cause\s*(?:no|number)/.test(text.toLowerCase())) score += 1000
        candidates.push({ paragraph, arrayIndex, at, score })
        at = haystack.indexOf(needle, at + Math.max(1, needle.length))
      }
    })
    if (!candidates.length) return {
      paragraph_start: Number.isFinite(storedIndex) ? storedIndex : 0,
      paragraph_end: Number.isFinite(Number(binding.paragraph_end)) ? Number(binding.paragraph_end) : (Number.isFinite(storedIndex) ? storedIndex : 0),
      start_offset: Number.isFinite(storedStart) ? storedStart : 0,
      end_offset: Number.isFinite(Number(binding.end_offset)) ? Number(binding.end_offset) : ((Number.isFinite(storedStart) ? storedStart : 0) + source.length)
    }
    candidates.sort((a, b) => b.score - a.score || a.arrayIndex - b.arrayIndex)
    const best = candidates[0]
    const paragraphIndex = Number(best.paragraph?.index ?? best.arrayIndex)
    return { paragraph_start: paragraphIndex, paragraph_end: paragraphIndex, start_offset: best.at, end_offset: best.at + source.length }
  }

  function mioRepairTemplateBindingLocationsV295(template) {
    if (!template || !draftingStudioDocument) return template
    const currentFile = draftingStudioCurrentFile(template)
    const fileKey = String(currentFile?.id || currentFile?.name || '')
    let changed = false
    const bindings = (template.bindings || []).map((binding) => {
      if (binding.is_active === false || (binding.file_id && String(binding.file_id) !== fileKey) || !binding.source_text) return binding
      const located = mioResolveBindingLocationV295(binding)
      const fieldKey = mioCanonicalFieldKeyV295(binding)
      const next = { ...binding, ...located, field_key: fieldKey }
      if (next.paragraph_start !== binding.paragraph_start || next.start_offset !== binding.start_offset || next.end_offset !== binding.end_offset || next.field_key !== binding.field_key) changed = true
      return next
    })
    if (!changed) return template
    return cleanDraftingTemplate({ ...template, bindings, fields: (template.fields || []).map((field) => {
      const matched = bindings.find((binding) => String(binding.id) && (String(field.key) === String(binding.field_key) || String(field.key) === String((template.bindings || []).find(old => old.id === binding.id)?.field_key)))
      return matched ? { ...field, key: matched.field_key, label: matched.label || field.label, source: matched.data_source || field.source } : field
    }), updated_at: new Date().toISOString() })
  }

  function mioEditBindingV293(bindingOrId) {
    const template = draftingStudioCurrentTemplate()
    const binding = typeof bindingOrId === 'string' ? (template?.bindings || []).find(item => String(item.id) === String(bindingOrId)) : bindingOrId
    if (!template || !binding) return
    const repairedTemplate = mioRepairTemplateBindingLocationsV295(template)
    const repaired = (repairedTemplate.bindings || []).find(item => String(item.id) === String(binding.id)) || binding
    if (repairedTemplate !== template) {
      setDraftingTemplates(current => current.map(item => String(item.id) === String(repairedTemplate.id) ? repairedTemplate : item))
      setDraftingTemplateForm(repairedTemplate)
    }
    const located = mioResolveBindingLocationV295(repaired)
    setDraftingEditingBindingId(repaired.id)
    setDraftingBindingDraft({
      kind: repaired.kind || 'field', label: repaired.label || '', field_key: mioCanonicalFieldKeyV295(repaired), data_source: repaired.data_source || 'manual', grammar_role: repaired.grammar_role || '', linked_party: repaired.linked_party || '', relief_option_ids: repaired.relief_option_ids || [], clause_id: repaired.clause_id || '', condition_key: repaired.condition_key || '', replace_all: repaired.replace_all === true, required: repaired.required === true, practice_manual_form: repaired.practice_manual_form || '', practice_manual_section: repaired.practice_manual_section || ''
    })
    setDraftingStudioSelection({ source_text: repaired.source_text || '', ...located, section_name: repaired.practice_manual_section || '' })
    setDraftingWordEditorParagraphIndex(located.paragraph_start)
    setDraftingStudioStatus('Editing “' + (repaired.label || repaired.field_key || repaired.source_text) + '”. Mio re-located it from its saved source text so paragraph-number drift cannot move the field.')
    window.requestAnimationFrame(() => document.getElementById('drafting-paragraph-' + located.paragraph_start)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

`
      code = code.slice(0, editStart) + replacement + code.slice(editEnd)

      const saveStart = code.indexOf('  function mioSaveBindingEditV293() {')
      const saveEnd = saveStart >= 0 ? code.indexOf('  function draftingAllEventsForMatterV293(matter) {', saveStart) : -1
      if (saveStart < 0 || saveEnd < 0) throw new Error('V295 anchor changed: V293 binding save')
      const saveReplacement = `  function mioSaveBindingEditV293() {
    const template = draftingStudioCurrentTemplate()
    const old = (template?.bindings || []).find(item => String(item.id) === String(draftingEditingBindingId))
    if (!template || !old) return alert('Select a saved field first.')
    const located = mioResolveBindingLocationV295({ ...old, ...draftingBindingDraft, source_text: old.source_text })
    const nextBinding = draftingNormalizeBinding({ ...old, ...draftingBindingDraft, ...located, id: old.id, source_text: old.source_text, file_id: old.file_id, is_active: old.is_active !== false })
    if (['field','pronoun','paragraph_choice'].includes(nextBinding.kind)) nextBinding.field_key = mioCanonicalFieldKeyV295(nextBinding) || draftingNormalizeFieldKey(nextBinding.field_key || nextBinding.label || old.field_key)
    const nextFields = (template.fields || []).map(field => String(field.key) === String(old.field_key || '') ? { ...field, key: nextBinding.field_key || field.key, label: nextBinding.label || field.label, source: nextBinding.data_source || field.source, grammar_role: nextBinding.grammar_role || '', linked_party: nextBinding.linked_party || '', required: nextBinding.required === true } : field)
    const next = cleanDraftingTemplate({ ...template, fields: nextFields, bindings: (template.bindings || []).map(item => String(item.id) === String(old.id) ? nextBinding : item), visual_builder_status: 'reviewed', updated_at: new Date().toISOString() })
    setDraftingTemplates(current => current.map(item => String(item.id) === String(next.id) ? next : item))
    setDraftingTemplateForm(next)
    setDraftingStudioStatus('Updated field “' + (nextBinding.label || nextBinding.field_key || nextBinding.source_text) + '” at its verified source-text location.')
    mioCancelBindingEditV293()
  }

`
      code = code.slice(0, saveStart) + saveReplacement + code.slice(saveEnd)

      return { code, map: null }
    }
  }
}
