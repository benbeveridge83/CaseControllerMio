// Mio V296: replace approved case-specific values inside reusable DOCX templates with named placeholders.
function once(code, from, to, label) {
  const at = code.indexOf(from)
  if (at < 0 || code.indexOf(from, at + from.length) >= 0) throw new Error('V296 sanitize anchor changed: ' + label)
  return code.replace(from, to)
}

export default function mioV296DraftingSanitize() {
  return {
    name: 'mio-v296-drafting-sanitize',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source
      code = code.replace(/const MIO_APP_VERSION = 'Mio V295[^']*'/, "const MIO_APP_VERSION = 'Mio V296 (field placeholders + matter information)'")

      const commitAnchor = '  function draftingStudioCommitBinding(rawBinding, options = {}) {'
      if (!code.includes(commitAnchor)) throw new Error('V296 sanitize anchor changed: binding commit')
      const helpers = `  function draftingPlaceholderMarkerV296(binding) {
    if (binding.kind === 'caption_block') return '{{case_caption_text}}'
    if (binding.kind === 'signature_block') return '{{attorney_signature_block}}'
    const key = draftingNormalizeFieldKey(binding.field_key || binding.label || 'field') || 'field'
    return '{{' + key + '}}'
  }

  async function draftingSanitizeSavedFieldV296(template, binding) {
    if (!template || !binding || !['field','pronoun','paragraph_choice'].includes(binding.kind)) return
    const fileKey = String(binding.file_id || '')
    const file = (template.files || []).find((item) => String(item.id || item.name || '') === fileKey) || draftingStudioCurrentFile(template)
    if (!file?.file_data || !binding.source_text) return
    const marker = draftingPlaceholderMarkerV296(binding)
    if (binding.source_text === marker) return
    try {
      await ensureDraftingZipLibrary()
      const zip = await window.JSZip.loadAsync(dataUrlToUint8Array(file.file_data || ''))
      const entry = zip.file('word/document.xml')
      if (!entry) return
      const xmlDoc = new DOMParser().parseFromString(await entry.async('string'), 'application/xml')
      if (xmlDoc.getElementsByTagName('parsererror').length) return
      const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
      const paragraphs = Array.from(xmlDoc.getElementsByTagNameNS(ns, 'p'))
      let changed = 0
      if (binding.replace_all === true) {
        changed = draftingReplacePlainTextInElement(xmlDoc.documentElement, binding.source_text, marker, { replaceAll: true, caseInsensitive: binding.kind === 'pronoun', wholeWord: binding.kind === 'pronoun' }) || 0
      } else {
        const located = typeof mioResolveBindingLocationV295 === 'function' ? mioResolveBindingLocationV295(binding) : binding
        const paragraph = paragraphs[Number(located?.paragraph_start ?? binding.paragraph_start)]
        if (paragraph) changed = draftingReplacePlainTextInElement(paragraph, binding.source_text, marker, { replaceAll: false, caseInsensitive: binding.kind === 'pronoun', wholeWord: binding.kind === 'pronoun' }) || 0
      }
      if (!changed) return
      zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDoc))
      const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' })
      const nextFile = { ...file, file_data: await draftingBlobToDataUrl(blob), size: blob.size, updated_at: new Date().toISOString() }
      const nextBinding = { ...binding, source_text: marker, end_offset: Number(binding.start_offset || 0) + marker.length }
      const nextTemplate = cleanDraftingTemplate({
        ...template,
        files: (template.files || []).map((item) => String(item.id || item.name || '') === String(file.id || file.name || '') ? nextFile : item),
        bindings: (template.bindings || []).map((item) => String(item.id) === String(binding.id) ? nextBinding : item),
        updated_at: new Date().toISOString(), visual_builder_status: 'reviewed'
      })
      setDraftingTemplates((current) => current.map((item) => String(item.id) === String(nextTemplate.id) ? nextTemplate : item))
      setDraftingTemplateForm(nextTemplate)
      setDraftingStudioDocument(await draftingStudioParseTemplateFile(nextFile))
      setDraftingStudioStatus('Saved field “' + (binding.label || binding.field_key) + '” and removed the original case-specific value. The reusable template now contains ' + marker + '.')
    } catch (error) {
      console.error('Template field sanitization failed:', error)
      setDraftingStudioStatus('Field saved, but Mio could not replace the original Word text with its placeholder.')
    }
  }

  async function draftingSanitizeAllSavedFieldsV296() {
    let template = draftingStudioCurrentTemplate()
    if (!template) return alert('Open a template first.')
    const fields = (template.bindings || []).filter((binding) => binding.is_active !== false && ['field','pronoun','paragraph_choice'].includes(binding.kind) && binding.source_text && !/^\\{\\{[^}]+\\}\\}$/.test(binding.source_text))
    if (!fields.length) { setDraftingStudioStatus('All saved fields already use placeholders.'); return }
    for (const binding of fields) {
      await draftingSanitizeSavedFieldV296(template, binding)
      template = draftingStudioCurrentTemplate() || template
    }
  }

`
      code = code.replace(commitAnchor, helpers + commitAnchor)
      code = once(code,
        "    setDraftingStudioStatus(`Saved ${binding.kind.replace(/_/g, ' ')} binding “${binding.label || binding.field_key || binding.source_text.slice(0, 60)}.”`)\n    return binding",
        "    setDraftingStudioStatus(`Saved ${binding.kind.replace(/_/g, ' ')} binding “${binding.label || binding.field_key || binding.source_text.slice(0, 60)}.”`)\n    if (['field','pronoun','paragraph_choice'].includes(binding.kind)) void draftingSanitizeSavedFieldV296(nextTemplate, binding)\n    return binding",
        'sanitize after binding save')

      const toolbarTarget = '<button type="button" onClick={() => setDraftingWordEditorEnabled((value) => !value)} style={{ fontWeight: 900, background: draftingWordEditorEnabled ? \'#dbeafe\' : \'#fff\' }}>{draftingWordEditorEnabled ? \'Editing ON\' : \'Edit document\'}</button>'
      code = once(code, toolbarTarget, toolbarTarget + '<button type="button" onClick={draftingSanitizeAllSavedFieldsV296} style={{ fontWeight: 850, color: \'#1d4ed8\' }}>Convert saved fields to placeholders</button>', 'sanitize existing fields button')
      return { code, map: null }
    }
  }
}
