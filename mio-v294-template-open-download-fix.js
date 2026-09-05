// Mio V294: repair Template Library matter testing and make downloaded templates show saved field markers.
function once(code, from, to, label) {
  const first = code.indexOf(from)
  if (first < 0 || code.indexOf(from, first + from.length) >= 0) throw new Error('V294 anchor changed: ' + label)
  return code.replace(from, to)
}

export default function mioV294TemplateOpenDownloadFix() {
  return {
    name: 'mio-v294-template-open-download-fix',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source

      code = code.replace(/const MIO_APP_VERSION = 'Mio V293[^']*'/, "const MIO_APP_VERSION = 'Mio V294 (template testing repair)'")

      code = once(
        code,
        "    setDraftingStudioTab('compose')\n    window.location.hash = 'drafting'",
        "    setPage('drafting')",
        'Open for matter navigation'
      )

      const oldDownload = `  function downloadDraftingTemplateFile(file) {
    if (!file?.file_data) { alert('No template file data is available.'); return }
    const link = document.createElement('a')
    link.href = file.file_data
    link.download = file.name || 'template.docx'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }`

      const newDownload = `  async function downloadDraftingTemplateFile(file) {
    if (!file?.file_data) { alert('No template file data is available.'); return }
    const rawDownload = () => {
      const link = document.createElement('a')
      link.href = file.file_data
      link.download = file.name || 'template.docx'
      document.body.appendChild(link)
      link.click()
      link.remove()
    }
    const fileKey = String(file.id || file.name || '')
    const template = draftingTemplates.find((item) => (item.files || []).some((candidate) => String(candidate.id || candidate.name || '') === fileKey)) || draftingStudioCurrentTemplate()
    const bindings = (template?.bindings || []).map(draftingNormalizeBinding).filter((binding) => binding.is_active !== false && (!binding.file_id || String(binding.file_id) === fileKey))
    const markerBindings = bindings.filter((binding) => ['field', 'pronoun', 'paragraph_choice', 'caption_block', 'signature_block', 'component_block'].includes(binding.kind))
    if (!template || !markerBindings.length) { rawDownload(); return }
    try {
      await ensureDraftingZipLibrary()
      const bytes = dataUrlToUint8Array(file.file_data || '')
      if (!bytes.length) { rawDownload(); return }
      const zip = await window.JSZip.loadAsync(bytes)
      const xmlPaths = Object.keys(zip.files).filter((xmlPath) => /^word\\/(?:document|header\\d+|footer\\d+)\\.xml$/i.test(xmlPath))
      const markerFor = (binding) => {
        if (binding.kind === 'caption_block') return '{{case_caption_text}}'
        if (binding.kind === 'signature_block') return '{{attorney_signature_block}}'
        const key = draftingNormalizeFieldKey(binding.field_key || binding.label || binding.source_text || 'field') || 'field'
        return '{{' + key + '}}'
      }
      for (const xmlPath of xmlPaths) {
        const xml = await zip.file(xmlPath).async('string')
        const parser = new DOMParser()
        const xmlDoc = parser.parseFromString(xml, 'application/xml')
        if (xmlDoc.getElementsByTagName('parsererror').length) throw new Error('The Word template contains XML that could not be read.')
        const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
        const paragraphs = Array.from(xmlDoc.getElementsByTagNameNS(wordNamespace, 'p'))
        for (const binding of markerBindings) {
          const marker = markerFor(binding)
          if (['caption_block', 'signature_block', 'component_block'].includes(binding.kind)) {
            if (!/^word\\/document\\.xml$/i.test(xmlPath) || binding.paragraph_start < 0) continue
            const start = Math.max(0, binding.paragraph_start)
            const end = Math.min(paragraphs.length - 1, Math.max(start, binding.paragraph_end))
            const nodes = paragraphs.slice(start, end + 1)
            if (!nodes.length) continue
            draftingWordSetElementText(nodes[0], marker)
            nodes.slice(1).forEach((node) => draftingWordSetElementText(node, ''))
            continue
          }
          if (!binding.source_text) continue
          if (/^word\\/document\\.xml$/i.test(xmlPath) && binding.paragraph_start >= 0 && binding.replace_all !== true) {
            const paragraph = paragraphs[binding.paragraph_start]
            if (paragraph) draftingReplacePlainTextInElement(paragraph, binding.source_text, marker, { replaceAll: false, caseInsensitive: binding.kind === 'pronoun', wholeWord: binding.kind === 'pronoun' })
          } else if (binding.replace_all === true) {
            draftingReplacePlainTextInElement(xmlDoc.documentElement, binding.source_text, marker, { replaceAll: true, caseInsensitive: binding.kind === 'pronoun', wholeWord: binding.kind === 'pronoun' })
          }
        }
        zip.file(xmlPath, new XMLSerializer().serializeToString(xmlDoc))
      }
      const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      const originalName = String(file.name || 'template.docx').replace(/\\.docx$/i, '')
      link.href = url
      link.download = originalName + ' - Field Template.docx'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
      setDraftingStudioStatus('Downloaded a field-marked Word template. Saved fields are shown as {{field_key}} markers instead of the original client-specific values.')
    } catch (error) {
      console.error('Field-marked template download failed:', error)
      alert('Mio could not create the field-marked template. The original template was not changed.')
    }
  }`

      code = once(code, oldDownload, newDownload, 'field-marked template download')
      code = code.replaceAll('>Download template</button>', '>Download field template</button>')
      return { code, map: null }
    }
  }
}
