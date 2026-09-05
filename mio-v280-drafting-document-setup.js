// Mio V280: template-level case styling, first-page notice, page setup, headers/footers,
// page numbering, smart closing blocks, and visible Word break markers.
export default function mioV280DraftingDocumentSetup() {
  return {
    name: 'mio-v280-drafting-document-setup',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/App.jsx')) return null
      let code = source
      const requireOnce = (needle, label) => {
        const first = code.indexOf(needle)
        if (first < 0 || code.indexOf(needle, first + needle.length) >= 0) throw new Error('V280 integration anchor changed: ' + label)
        return first
      }

      code = `import { TemplateDocumentSetup } from './MioDraftingWorkspace.jsx'\nimport { applyPageSetupToPackage as mioApplyPageSetupToPackage } from './mioDraftingComponents.js'\n` + code
      const version = "const MIO_APP_VERSION = 'Mio V279 (drafting + withdrawals)'"
      requireOnce(version, 'version')
      code = code.replace(version, "const MIO_APP_VERSION = 'Mio V280 (document setup)'")

      // Template configuration participates in generation, while a one-off draft override wins.
      const fileDataLine = 'data = mioFileComponentData(data, templateFile, draftingProfile)'
      requireOnce(fileDataLine, 'file component data')
      code = code.replace(fileDataLine, `const mioTemplateFileKey = String(templateFile?.id || templateFile?.name || '')
    const mioTemplateFileSetup = template?.drafting_components_by_file?.[mioTemplateFileKey] || {}
    const mioDraftFileSetup = data?.drafting_components?.[mioTemplateFileKey] || {}
    data = mioFileComponentData({
      ...data,
      case_style_id: data?.case_style_id || mioTemplateFileSetup.case_style_id || '',
      drafting_components: {
        ...(template?.drafting_components_by_file || {}),
        ...(data?.drafting_components || {}),
        [mioTemplateFileKey]: { ...mioTemplateFileSetup, ...mioDraftFileSetup }
      }
    }, templateFile, draftingProfile)`)

      // Apply headers, footers, page fields and section/page properties to the actual DOCX package.
      const generatorStart = code.indexOf('  async function generateDocxFromTemplateFile(templateFile, data, matter, template = null) {')
      if (generatorStart < 0) throw new Error('V280 generation function changed')
      const generateAt = code.indexOf('zip.generateAsync', generatorStart)
      if (generateAt < 0) throw new Error('V280 could not find DOCX package generation')
      const lineStart = code.lastIndexOf('\n', generateAt) + 1
      code = code.slice(0, lineStart) + '    await mioApplyPageSetupToPackage(zip, data, templateFile, draftingProfile)\n' + code.slice(lineStart)

      // Make existing Word page/section breaks visible in the builder. V275 already inserts/removes pageBreakBefore.
      const parserStart = code.indexOf('  async function draftingStudioParseTemplateFile(file) {')
      const parserEnd = parserStart >= 0 ? code.indexOf('  async function draftingStudioCreateTemplateFromUpload(file) {', parserStart) : -1
      if (parserStart < 0 || parserEnd < parserStart) throw new Error('V280 parser changed')
      let parser = code.slice(parserStart, parserEnd)
      const pPrLine = "      const paragraphProperties = paragraph.getElementsByTagNameNS(wordNamespace, 'pPr')[0]"
      if (!parser.includes('word_page_break_before')) {
        if (!parser.includes(pPrLine)) throw new Error('V280 paragraph properties changed')
        parser = parser.replace(pPrLine, `${pPrLine}
      const wordPageBreakBefore = !!paragraphProperties?.getElementsByTagNameNS(wordNamespace, 'pageBreakBefore')?.length
      const wordInlinePageBreak = Array.from(paragraph.getElementsByTagNameNS(wordNamespace, 'br')).some((node) => String(node.getAttributeNS?.(wordNamespace, 'type') || node.getAttribute?.('w:type') || '').toLowerCase() === 'page')
      const wordSectionBreak = !!paragraphProperties?.getElementsByTagNameNS(wordNamespace, 'sectPr')?.length`)
        const tail = "word_space_after: wordNumber(spacingNode, 'after') }"
        if (!parser.includes(tail)) throw new Error('V280 paragraph metadata changed')
        parser = parser.replace(tail, "word_space_after: wordNumber(spacingNode, 'after'), word_page_break_before: wordPageBreakBefore, word_inline_page_break: wordInlinePageBreak, word_section_break: wordSectionBreak }")
      }
      code = code.slice(0, parserStart) + parser + code.slice(parserEnd)

      const paragraphFunction = code.indexOf('  function draftingStudioV274ParagraphNode(paragraph, template, keyPrefix = \'\') {')
      const tableFunction = paragraphFunction >= 0 ? code.indexOf('  function draftingStudioV274TableNode(block, template) {', paragraphFunction) : -1
      if (paragraphFunction >= 0 && tableFunction > paragraphFunction) {
        let region = code.slice(paragraphFunction, tableFunction)
        if (!region.includes('Word break marker')) {
          const returnNeedle = "    return <div id={'drafting-paragraph-' + paragraph.index}"
          if (!region.includes(returnNeedle)) throw new Error('V280 paragraph preview changed')
          region = region.replace(returnNeedle, `    return <>
      {(paragraph.word_page_break_before || paragraph.word_section_break) && <div aria-label="Word break marker" style={{ margin: '8px 0', borderTop: '2px dashed #94a3b8', textAlign: 'center', color: '#64748b', fontFamily: 'Arial,sans-serif', fontSize: 10, fontWeight: 800, letterSpacing: '.08em' }}><span style={{ background: '#fff', padding: '0 7px', position: 'relative', top: -7 }}>{paragraph.word_section_break ? 'SECTION BREAK' : 'PAGE BREAK'}</span></div>}
      <div id={'drafting-paragraph-' + paragraph.index}`)
          const closeNeedle = '      {renderDraftingStudioHighlightedText(paragraph, template)}\n    </div>\n  }'
          if (!region.includes(closeNeedle)) throw new Error('V280 paragraph preview close changed')
          region = region.replace(closeNeedle, `      {renderDraftingStudioHighlightedText(paragraph, template)}
      </div>
      {paragraph.word_inline_page_break && <div aria-label="Word break marker" style={{ margin: '8px 0', borderTop: '2px dashed #94a3b8', textAlign: 'center', color: '#64748b', fontFamily: 'Arial,sans-serif', fontSize: 10, fontWeight: 800, letterSpacing: '.08em' }}><span style={{ background: '#fff', padding: '0 7px', position: 'relative', top: -7 }}>PAGE BREAK</span></div>}
    </>
  }`)
          code = code.slice(0, paragraphFunction) + region + code.slice(tableFunction)
        }
      }

      // Add a template-level setup panel to Visual Template Builder.
      const visualStart = code.indexOf('  function renderDraftingVisualBuilder() {')
      if (visualStart < 0) throw new Error('V280 visual builder changed')
      const emptyAnchor = '      {!draftingStudioDocument && <div style={{ border:'
      const setupAt = code.indexOf(emptyAnchor, visualStart)
      if (setupAt < 0) throw new Error('V280 visual builder empty-state changed')
      const setupJsx = `      {template && file && <TemplateDocumentSetup template={template} file={file} profile={draftingProfile} onSave={(config) => {
        const key = String(file?.id || file?.name || '')
        const nextTemplate = { ...template, drafting_components_by_file: { ...(template.drafting_components_by_file || {}), [key]: config }, updated_at: new Date().toISOString() }
        setDraftingTemplates((current) => current.map((item) => String(item.id) === String(nextTemplate.id) ? nextTemplate : item))
        setDraftingTemplateForm(nextTemplate)
        setDraftingStudioStatus('Saved page setup, case style, and smart blocks to this Word template.')
      }} />}
`
      code = code.slice(0, setupAt) + setupJsx + code.slice(setupAt)

      return { code, map: null }
    }
  }
}
