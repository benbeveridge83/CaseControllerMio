// Mio V275: add Word-like editing controls to the visual template builder.
// Edits are written back into the actual .docx package, not only the HTML preview.
export default function mioV275DraftingEditor() {
  return {
    name: 'mio-v275-drafting-editor',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('/src/App.jsx')) return null
      let code = source
      code = code.replace("const MIO_APP_VERSION = 'Mio V274'", "const MIO_APP_VERSION = 'Mio V275'")

      const stateAnchor = "  const [draftingStudioTab, setDraftingStudioTab] = useState(() => localStorage.getItem('caseMioDraftingStudioTab') || 'library')"
      if (code.includes(stateAnchor) && !code.includes('draftingWordEditorEnabled')) {
        code = code.replace(stateAnchor, `${stateAnchor}\n  const [draftingWordEditorEnabled, setDraftingWordEditorEnabled] = useState(false)\n  const [draftingWordEditorParagraphIndex, setDraftingWordEditorParagraphIndex] = useState(-1)`)
      }

      const visualMarker = '  function renderDraftingVisualBuilder() {'
      const visualAt = code.indexOf(visualMarker)
      if (visualAt >= 0 && !code.includes('function draftingStudioV275MutateCurrentDocx(')) {
        const helpers = `  async function draftingStudioV275MutateCurrentDocx(mutator, label = 'Updated Word template') {
    const template = draftingStudioCurrentTemplate()
    const file = draftingStudioCurrentFile(template)
    if (!template || !file?.file_data) return alert('Open a Word template first.')
    setDraftingStudioBusy(true)
    try {
      await ensureDraftingZipLibrary()
      const bytes = dataUrlToUint8Array(file.file_data || '')
      const zip = await window.JSZip.loadAsync(bytes)
      const entry = zip.file('word/document.xml')
      if (!entry) throw new Error('This Word file does not contain word/document.xml.')
      const xml = await entry.async('string')
      const parser = new DOMParser()
      const xmlDoc = parser.parseFromString(xml, 'application/xml')
      if (xmlDoc.getElementsByTagName('parsererror').length) throw new Error('Mio could not edit this Word document XML.')
      const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
      const paragraphs = Array.from(xmlDoc.getElementsByTagNameNS(ns, 'p'))
      await mutator({ xmlDoc, paragraphs, ns })
      zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDoc))
      const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' })
      const nextFile = { ...file, file_data: await draftingBlobToDataUrl(blob), size: blob.size, updated_at: new Date().toISOString() }
      const nextTemplate = cleanDraftingTemplate({ ...template, files: (template.files || []).map((item) => String(item.id || item.name) === String(file.id || file.name) ? nextFile : item), updated_at: new Date().toISOString(), visual_builder_status: 'reviewed' })
      setDraftingTemplates((current) => current.map((item) => String(item.id) === String(nextTemplate.id) ? nextTemplate : item))
      setDraftingTemplateForm(nextTemplate)
      setDraftingStudioDocument(await draftingStudioParseTemplateFile(nextFile))
      setDraftingStudioStatus(label + '. Changes saved into the .docx template.')
    } catch (error) {
      setDraftingStudioStatus(error?.message || 'Mio could not update the Word template.')
    } finally { setDraftingStudioBusy(false) }
  }

  function draftingStudioV275SelectedParagraphIndex() {
    if (draftingWordEditorParagraphIndex >= 0) return draftingWordEditorParagraphIndex
    if (draftingStudioSelection?.paragraph_start >= 0) return draftingStudioSelection.paragraph_start
    return -1
  }

  function draftingStudioV275WordChild(parent, localName, ns) {
    return Array.from(parent?.childNodes || []).find((node) => node?.nodeType === 1 && node.namespaceURI === ns && node.localName === localName) || null
  }

  function draftingStudioV275EnsureChild(parent, localName, ns, first = false) {
    let child = draftingStudioV275WordChild(parent, localName, ns)
    if (child) return child
    child = parent.ownerDocument.createElementNS(ns, 'w:' + localName)
    if (first && parent.firstChild) parent.insertBefore(child, parent.firstChild)
    else parent.appendChild(child)
    return child
  }

  function draftingStudioV275SetWordAttr(node, name, value, ns) {
    if (!node) return
    if (value == null || value === '') node.removeAttributeNS(ns, name)
    else node.setAttributeNS(ns, 'w:' + name, String(value))
  }

  async function draftingStudioV275SetParagraphText(index, text) {
    if (index < 0) return
    await draftingStudioV275MutateCurrentDocx(({ paragraphs }) => {
      const paragraph = paragraphs[index]
      if (!paragraph) return
      draftingWordSetElementText(paragraph, String(text ?? ''))
    }, 'Updated paragraph text')
  }

  async function draftingStudioV275SetParagraphProperty(property, value) {
    const index = draftingStudioV275SelectedParagraphIndex()
    if (index < 0) return alert('Click inside a paragraph first.')
    await draftingStudioV275MutateCurrentDocx(({ paragraphs, ns }) => {
      const paragraph = paragraphs[index]
      if (!paragraph) return
      const pPr = draftingStudioV275EnsureChild(paragraph, 'pPr', ns, true)
      if (property === 'alignment') {
        const jc = draftingStudioV275EnsureChild(pPr, 'jc', ns)
        draftingStudioV275SetWordAttr(jc, 'val', value, ns)
      } else if (property === 'indentDelta') {
        const ind = draftingStudioV275EnsureChild(pPr, 'ind', ns)
        const current = Number(ind.getAttributeNS(ns, 'left') || ind.getAttribute('w:left') || 0) || 0
        draftingStudioV275SetWordAttr(ind, 'left', Math.max(0, current + Number(value || 0)), ns)
      } else if (property === 'firstLine') {
        const ind = draftingStudioV275EnsureChild(pPr, 'ind', ns)
        draftingStudioV275SetWordAttr(ind, 'firstLine', value, ns)
        if (value) draftingStudioV275SetWordAttr(ind, 'hanging', '', ns)
      } else if (property === 'hanging') {
        const ind = draftingStudioV275EnsureChild(pPr, 'ind', ns)
        draftingStudioV275SetWordAttr(ind, 'hanging', value, ns)
        if (value) draftingStudioV275SetWordAttr(ind, 'firstLine', '', ns)
      } else if (property === 'line') {
        const spacing = draftingStudioV275EnsureChild(pPr, 'spacing', ns)
        draftingStudioV275SetWordAttr(spacing, 'line', Math.round(Number(value || 1) * 240), ns)
        draftingStudioV275SetWordAttr(spacing, 'lineRule', 'auto', ns)
      } else if (property === 'spaceBefore' || property === 'spaceAfter') {
        const spacing = draftingStudioV275EnsureChild(pPr, 'spacing', ns)
        draftingStudioV275SetWordAttr(spacing, property === 'spaceBefore' ? 'before' : 'after', Math.round(Number(value || 0) * 20), ns)
      } else if (property === 'style') {
        const pStyle = draftingStudioV275EnsureChild(pPr, 'pStyle', ns, true)
        draftingStudioV275SetWordAttr(pStyle, 'val', value, ns)
      } else if (property === 'pageBreakBefore') {
        const existing = draftingStudioV275WordChild(pPr, 'pageBreakBefore', ns)
        if (existing) pPr.removeChild(existing)
        else pPr.appendChild(paragraph.ownerDocument.createElementNS(ns, 'w:pageBreakBefore'))
      }
    }, 'Updated paragraph formatting')
  }

  async function draftingStudioV275SetRunProperty(property, value = true) {
    const index = draftingStudioV275SelectedParagraphIndex()
    if (index < 0) return alert('Click inside a paragraph first.')
    await draftingStudioV275MutateCurrentDocx(({ paragraphs, ns }) => {
      const paragraph = paragraphs[index]
      if (!paragraph) return
      let runs = Array.from(paragraph.getElementsByTagNameNS(ns, 'r'))
      if (!runs.length) {
        const run = paragraph.ownerDocument.createElementNS(ns, 'w:r')
        const text = paragraph.ownerDocument.createElementNS(ns, 'w:t')
        text.textContent = ''
        run.appendChild(text)
        paragraph.appendChild(run)
        runs = [run]
      }
      runs.forEach((run) => {
        const rPr = draftingStudioV275EnsureChild(run, 'rPr', ns, true)
        if (['b', 'i', 'u'].includes(property)) {
          let node = draftingStudioV275WordChild(rPr, property, ns)
          if (node) rPr.removeChild(node)
          else {
            node = paragraph.ownerDocument.createElementNS(ns, 'w:' + property)
            if (property === 'u') draftingStudioV275SetWordAttr(node, 'val', 'single', ns)
            rPr.appendChild(node)
          }
        } else if (property === 'font') {
          const fonts = draftingStudioV275EnsureChild(rPr, 'rFonts', ns)
          ;['ascii', 'hAnsi', 'eastAsia', 'cs'].forEach((name) => draftingStudioV275SetWordAttr(fonts, name, value, ns))
        } else if (property === 'size') {
          const sz = draftingStudioV275EnsureChild(rPr, 'sz', ns)
          const szCs = draftingStudioV275EnsureChild(rPr, 'szCs', ns)
          draftingStudioV275SetWordAttr(sz, 'val', Math.round(Number(value || 12) * 2), ns)
          draftingStudioV275SetWordAttr(szCs, 'val', Math.round(Number(value || 12) * 2), ns)
        }
      })
    }, 'Updated text formatting')
  }

  async function draftingStudioV275InsertParagraph() {
    const index = draftingStudioV275SelectedParagraphIndex()
    if (index < 0) return alert('Click inside a paragraph first.')
    await draftingStudioV275MutateCurrentDocx(({ paragraphs, ns }) => {
      const current = paragraphs[index]
      if (!current?.parentNode) return
      const paragraph = current.ownerDocument.createElementNS(ns, 'w:p')
      const run = current.ownerDocument.createElementNS(ns, 'w:r')
      const text = current.ownerDocument.createElementNS(ns, 'w:t')
      text.textContent = 'New paragraph'
      run.appendChild(text); paragraph.appendChild(run)
      current.parentNode.insertBefore(paragraph, current.nextSibling)
    }, 'Inserted paragraph')
  }

  async function draftingStudioV275DeleteParagraph() {
    const index = draftingStudioV275SelectedParagraphIndex()
    if (index < 0) return alert('Click inside a paragraph first.')
    if (!window.confirm('Delete this paragraph from the Word template?')) return
    await draftingStudioV275MutateCurrentDocx(({ paragraphs }) => {
      const paragraph = paragraphs[index]
      if (paragraph?.parentNode) paragraph.parentNode.removeChild(paragraph)
    }, 'Deleted paragraph')
    setDraftingWordEditorParagraphIndex(-1)
  }

  async function draftingStudioV275InsertTable() {
    const index = draftingStudioV275SelectedParagraphIndex()
    if (index < 0) return alert('Click where the table should be inserted first.')
    const rows = Math.max(1, Math.min(12, Number(window.prompt('Rows:', '2')) || 2))
    const cols = Math.max(1, Math.min(8, Number(window.prompt('Columns:', '2')) || 2))
    await draftingStudioV275MutateCurrentDocx(({ paragraphs, ns }) => {
      const current = paragraphs[index]
      if (!current?.parentNode) return
      const doc = current.ownerDocument
      const table = doc.createElementNS(ns, 'w:tbl')
      const tblPr = doc.createElementNS(ns, 'w:tblPr')
      const borders = doc.createElementNS(ns, 'w:tblBorders')
      ;['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].forEach((name) => {
        const border = doc.createElementNS(ns, 'w:' + name)
        draftingStudioV275SetWordAttr(border, 'val', 'single', ns)
        draftingStudioV275SetWordAttr(border, 'sz', '4', ns)
        draftingStudioV275SetWordAttr(border, 'color', '808080', ns)
        borders.appendChild(border)
      })
      tblPr.appendChild(borders); table.appendChild(tblPr)
      for (let r = 0; r < rows; r += 1) {
        const tr = doc.createElementNS(ns, 'w:tr')
        for (let c = 0; c < cols; c += 1) {
          const tc = doc.createElementNS(ns, 'w:tc')
          const p = doc.createElementNS(ns, 'w:p')
          const run = doc.createElementNS(ns, 'w:r')
          const text = doc.createElementNS(ns, 'w:t')
          text.textContent = ' '
          run.appendChild(text); p.appendChild(run); tc.appendChild(p); tr.appendChild(tc)
        }
        table.appendChild(tr)
      }
      current.parentNode.insertBefore(table, current.nextSibling)
    }, 'Inserted table')
  }

  function draftingStudioV275Toolbar() {
    const selected = draftingStudioV275SelectedParagraphIndex()
    return <div style={{ border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff', padding: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', position: 'sticky', top: 0, zIndex: 8 }}>
      <button type="button" onClick={() => setDraftingWordEditorEnabled((value) => !value)} style={{ fontWeight: 900, background: draftingWordEditorEnabled ? '#dbeafe' : '#fff' }}>{draftingWordEditorEnabled ? 'Editing ON' : 'Edit document'}</button>
      <span style={{ fontSize: 11, color: '#64748b' }}>{selected >= 0 ? 'Paragraph ' + (selected + 1) + ' selected' : 'Click a paragraph to edit'}</span>
      <select defaultValue="Times New Roman" onChange={(event) => draftingStudioV275SetRunProperty('font', event.target.value)}><option>Times New Roman</option><option>Arial</option><option>Calibri</option><option>Cambria</option><option>Georgia</option><option>Courier New</option></select>
      <select defaultValue="12" onChange={(event) => draftingStudioV275SetRunProperty('size', event.target.value)}>{[8,9,10,11,12,13,14,16,18,20,22,24,28,32,36,48,72].map((size) => <option key={size} value={size}>{size}</option>)}</select>
      <button type="button" onClick={() => draftingStudioV275SetRunProperty('b')}><strong>B</strong></button>
      <button type="button" onClick={() => draftingStudioV275SetRunProperty('i')}><em>I</em></button>
      <button type="button" onClick={() => draftingStudioV275SetRunProperty('u')}><u>U</u></button>
      <button type="button" onClick={() => draftingStudioV275SetParagraphProperty('alignment', 'left')}>Left</button>
      <button type="button" onClick={() => draftingStudioV275SetParagraphProperty('alignment', 'center')}>Center</button>
      <button type="button" onClick={() => draftingStudioV275SetParagraphProperty('alignment', 'right')}>Right</button>
      <button type="button" onClick={() => draftingStudioV275SetParagraphProperty('alignment', 'both')}>Justify</button>
      <button type="button" onClick={() => draftingStudioV275SetParagraphProperty('indentDelta', -360)}>Outdent</button>
      <button type="button" onClick={() => draftingStudioV275SetParagraphProperty('indentDelta', 360)}>Indent</button>
      <button type="button" onClick={() => draftingStudioV275SetParagraphProperty('firstLine', 720)}>First-line</button>
      <button type="button" onClick={() => draftingStudioV275SetParagraphProperty('hanging', 720)}>Hanging</button>
      <select defaultValue="1" onChange={(event) => draftingStudioV275SetParagraphProperty('line', event.target.value)}><option value="1">1.0 spacing</option><option value="1.15">1.15</option><option value="1.5">1.5</option><option value="2">2.0</option></select>
      <button type="button" onClick={() => draftingStudioV275SetParagraphProperty('style', 'ListNumber')}>1. 2. 3.</button>
      <button type="button" onClick={() => draftingStudioV275SetParagraphProperty('style', 'ListBullet')}>• Bullets</button>
      <button type="button" onClick={() => draftingStudioV275SetParagraphProperty('pageBreakBefore')}>Page break</button>
      <button type="button" onClick={() => { const value = window.prompt('Space before (points):', '0'); if (value != null) draftingStudioV275SetParagraphProperty('spaceBefore', value) }}>Space before</button>
      <button type="button" onClick={() => { const value = window.prompt('Space after (points):', '0'); if (value != null) draftingStudioV275SetParagraphProperty('spaceAfter', value) }}>Space after</button>
      <button type="button" onClick={draftingStudioV275InsertParagraph}>+ Paragraph</button>
      <button type="button" onClick={draftingStudioV275InsertTable}>+ Table</button>
      <button type="button" onClick={draftingStudioV275DeleteParagraph} style={{ color: '#991b1b' }}>Delete paragraph</button>
    </div>
  }

`
        code = code.slice(0, visualAt) + helpers + code.slice(visualAt)
      }

      const toolbarAnchor = `        </div>\n        {draftingStudioStatus && <div style={{ marginTop: 8, color: /could not|failed|error/i.test(draftingStudioStatus) ? '#991b1b' : '#334155', fontWeight: 750 }}>{draftingStudioStatus}</div>}\n      </section>`
      if (code.includes(toolbarAnchor)) {
        code = code.replace(toolbarAnchor, `        </div>\n        {draftingStudioStatus && <div style={{ marginTop: 8, color: /could not|failed|error/i.test(draftingStudioStatus) ? '#991b1b' : '#334155', fontWeight: 750 }}>{draftingStudioStatus}</div>}\n      </section>\n      {draftingStudioDocument && draftingStudioV275Toolbar()}`)
      }

      const oldParagraphOpen = `return <div id={'drafting-paragraph-' + paragraph.index} data-drafting-paragraph-index={paragraph.index} key={keyPrefix + paragraph.index} onMouseUp={(event) => draftingStudioCaptureSelection(event, paragraph.index)} style={style}>`
      const newParagraphOpen = `return <div id={'drafting-paragraph-' + paragraph.index} data-drafting-paragraph-index={paragraph.index} key={keyPrefix + paragraph.index} onClick={() => setDraftingWordEditorParagraphIndex(paragraph.index)} onMouseUp={(event) => draftingStudioCaptureSelection(event, paragraph.index)} contentEditable={draftingWordEditorEnabled && !paragraph.hidden} suppressContentEditableWarning={true} onBlur={(event) => { if (!draftingWordEditorEnabled) return; const nextText = event.currentTarget.innerText || ''; if (nextText !== String(paragraph.text || '')) draftingStudioV275SetParagraphText(paragraph.index, nextText) }} style={{ ...style, cursor: draftingWordEditorEnabled ? 'text' : 'default', boxShadow: draftingWordEditorParagraphIndex === paragraph.index ? 'inset 0 0 0 1px #2563eb' : style.boxShadow }}>`
      if (code.includes(oldParagraphOpen)) code = code.replace(oldParagraphOpen, newParagraphOpen)

      return { code, map: null }
    }
  }
}
