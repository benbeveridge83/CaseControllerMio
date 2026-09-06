// Mio V299: fast Field Selector plus a Texas-style generated caption table.
function replaceOnce(code, from, to, label) {
  const first = code.indexOf(from)
  if (first < 0 || code.indexOf(from, first + from.length) >= 0) throw new Error('V299 integration anchor changed: ' + label)
  return code.replace(from, to)
}

function transformApp(source) {
  let code = source
  code = code.replace(/const MIO_APP_VERSION = 'Mio V\d+[^']*'/, "const MIO_APP_VERSION = 'Mio V299 (field selector + legal caption)'")

  const stateAnchor = "  const [draftingSourcePickerTarget, setDraftingSourcePickerTarget] = useState({ kind: 'binding', field_id: '', value: 'manual' })"
  if (!code.includes('draftingFieldSelectorMode')) {
    code = replaceOnce(code, stateAnchor, stateAnchor + "\n  const [draftingFieldSelectorMode, setDraftingFieldSelectorMode] = useState(false)", 'field-selector state')
  }

  const chooseStart = '  function draftingV276ChooseSource(value) {'
  const chooseEnd = '  function draftingV276SourcePickerButton(value, onClick) {'
  const a = code.indexOf(chooseStart)
  const b = a >= 0 ? code.indexOf(chooseEnd, a) : -1
  if (a < 0 || b < 0) throw new Error('V299 integration anchor changed: source picker choice function')

  const choiceHelpers = `  function draftingStudioV299FieldMeta(value) {
    const source = String(value || 'manual')
    let item = null
    try { item = draftingV276SourceCategories().flatMap((category) => category.items || []).find((candidate) => candidate.value === source) || null } catch {}
    const rawLabel = String(item?.label || (typeof draftingV276SourceLabel === 'function' ? draftingV276SourceLabel(source) : source) || 'Template field')
    const label = rawLabel.replace(/\\s*[\\u2014\\u2013-]\\s*/g, ' ').replace(/\\s+/g, ' ').trim()
    const withoutPrefix = source.replace(/^(?:matter|court|attorney|firm|opposing_counsel|case)\\./, '')
    const fieldKey = draftingNormalizeFieldKey(withoutPrefix.replace(/\\./g, '_') || label || 'field')
    return { label, field_key: fieldKey }
  }

  function draftingStudioV299CaptureFieldSelection(event, paragraphIndex) {
    const selectedText = String(window.getSelection?.()?.toString?.() || '').trim()
    draftingStudioCaptureSelection(event, paragraphIndex)
    if (!draftingFieldSelectorMode || !selectedText) return
    setDraftingEditingBindingId('')
    setDraftingBindingDraft({ kind: 'field', label: '', field_key: '', data_source: 'manual', grammar_role: '', linked_party: '', relief_option_ids: [], clause_id: '', condition_key: '', replace_all: false, required: false, practice_manual_form: draftingStudioDocument?.practice_manual_form || '', practice_manual_section: '' })
    setDraftingStudioStatus('Field Selector: choose the Mio field that should replace the highlighted text.')
    window.setTimeout(() => draftingV276OpenSourcePicker('binding', '', 'manual'), 0)
  }

  function draftingStudioV299ToggleFieldSelector() {
    setDraftingFieldSelectorMode((current) => {
      const next = !current
      setDraftingStudioStatus(next ? 'Field Selector is ON. Highlight text in the Word template, then choose the replacement field.' : 'Field Selector is OFF.')
      return next
    })
    setDraftingWordEditorEnabled(false)
  }

`
  code = code.slice(0, a) + choiceHelpers + `  function draftingV276ChooseSource(value) {
    if (draftingSourcePickerTarget.kind === 'template_field' && draftingSourcePickerTarget.field_id) {
      updateDraftingTemplateField(draftingSourcePickerTarget.field_id, { source: value })
      setDraftingSourcePickerOpen(false)
      return
    }
    const meta = draftingStudioV299FieldMeta(value)
    setDraftingBindingDraft((current) => ({ ...current, data_source: value, ...(draftingFieldSelectorMode && value !== 'manual' ? { kind: 'field', label: meta.label, field_key: meta.field_key } : {}) }))
    setDraftingSourcePickerOpen(false)
    if (draftingFieldSelectorMode && draftingStudioSelection && value !== 'manual') {
      setDraftingStudioStatus('Creating ' + meta.label + ' field...')
      window.setTimeout(() => document.getElementById('drafting-save-highlighted-binding-v299')?.click(), 80)
    }
  }

` + code.slice(b)

  const mouseUp = 'onMouseUp={(event) => draftingStudioCaptureSelection(event, paragraph.index)}'
  if (!code.includes(mouseUp)) throw new Error('V299 integration anchor changed: paragraph mouse selection')
  code = code.replaceAll(mouseUp, 'onMouseUp={(event) => draftingStudioV299CaptureFieldSelection(event, paragraph.index)}')

  const saveButton = '<button type="button" onClick={draftingEditingBindingId ? mioSaveBindingEditV293 : draftingStudioAddBindingFromSelection}'
  if (!code.includes(saveButton)) throw new Error('V299 integration anchor changed: highlighted binding save button')
  code = code.replace(saveButton, '<button id="drafting-save-highlighted-binding-v299" type="button" onClick={draftingEditingBindingId ? mioSaveBindingEditV293 : draftingStudioAddBindingFromSelection}')

  const editButton = '<button type="button" onClick={() => setDraftingWordEditorEnabled((value) => !value)} style={{ fontWeight: 900, background: draftingWordEditorEnabled ? \'#dbeafe\' : \'#fff\' }}>{draftingWordEditorEnabled ? \'Editing ON\' : \'Edit document\'}</button>'
  if (!code.includes(editButton)) throw new Error('V299 integration anchor changed: Word editor toolbar')
  const selectorButton = `<button type="button" onClick={draftingStudioV299ToggleFieldSelector} aria-pressed={draftingFieldSelectorMode} style={{ fontWeight: 900, background: draftingFieldSelectorMode ? '#dbeafe' : '#fff', color: draftingFieldSelectorMode ? '#1d4ed8' : '#111827', border: draftingFieldSelectorMode ? '2px solid #2563eb' : undefined }}>{draftingFieldSelectorMode ? 'Field Selector ON' : 'Field Selector'}</button>{draftingFieldSelectorMode && <span style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 800 }}>Highlight text → choose field → Mio saves it automatically</span>}`
  code = code.replace(editButton, editButton + selectorButton)

  return code
}

function transformComponents(source) {
  let code = source
  const applyAnchor = 'function applyMioBlockMarkers(doc, body, data) {'
  if (!code.includes(applyAnchor)) throw new Error('V299 integration anchor changed: Mio block marker generator')

  if (!code.includes('function replaceMioCaptionParagraphV299(')) {
    const helpers = `function mioCaptionParagraphV299(doc, text, alignment = 'left') {
  const p = doc.createElementNS(WORD, 'w:p')
  const pPr = doc.createElementNS(WORD, 'w:pPr')
  const jc = doc.createElementNS(WORD, 'w:jc')
  jc.setAttributeNS(WORD, 'w:val', alignment)
  pPr.appendChild(jc)
  const spacing = doc.createElementNS(WORD, 'w:spacing')
  spacing.setAttributeNS(WORD, 'w:before', '0')
  spacing.setAttributeNS(WORD, 'w:after', '0')
  spacing.setAttributeNS(WORD, 'w:line', '240')
  spacing.setAttributeNS(WORD, 'w:lineRule', 'auto')
  pPr.appendChild(spacing)
  p.appendChild(pPr)
  const r = doc.createElementNS(WORD, 'w:r')
  const rPr = doc.createElementNS(WORD, 'w:rPr')
  const fonts = doc.createElementNS(WORD, 'w:rFonts')
  for (const key of ['ascii','hAnsi','cs','eastAsia']) fonts.setAttributeNS(WORD, 'w:' + key, 'Times New Roman')
  rPr.appendChild(fonts)
  for (const key of ['sz','szCs']) { const node = doc.createElementNS(WORD, 'w:' + key); node.setAttributeNS(WORD, 'w:val', '24'); rPr.appendChild(node) }
  r.appendChild(rPr)
  const t = doc.createElementNS(WORD, 'w:t')
  t.setAttributeNS(XML_SPACE, 'xml:space', 'preserve')
  t.textContent = String(text == null ? '' : text)
  r.appendChild(t)
  p.appendChild(r)
  return p
}

function mioCaptionCellV299(doc, lines, width, alignment = 'left') {
  const tc = doc.createElementNS(WORD, 'w:tc')
  const tcPr = doc.createElementNS(WORD, 'w:tcPr')
  const tcW = doc.createElementNS(WORD, 'w:tcW')
  tcW.setAttributeNS(WORD, 'w:w', String(width))
  tcW.setAttributeNS(WORD, 'w:type', 'dxa')
  tcPr.appendChild(tcW)
  const vAlign = doc.createElementNS(WORD, 'w:vAlign')
  vAlign.setAttributeNS(WORD, 'w:val', 'center')
  tcPr.appendChild(vAlign)
  const margins = doc.createElementNS(WORD, 'w:tcMar')
  for (const side of ['top','left','bottom','right']) {
    const m = doc.createElementNS(WORD, 'w:' + side)
    m.setAttributeNS(WORD, 'w:w', side === 'left' || side === 'right' ? '60' : '0')
    m.setAttributeNS(WORD, 'w:type', 'dxa')
    margins.appendChild(m)
  }
  tcPr.appendChild(margins)
  tc.appendChild(tcPr)
  ;(lines.length ? lines : ['']).forEach((line) => tc.appendChild(mioCaptionParagraphV299(doc, line, alignment)))
  return tc
}

function mioCaptionCourtNameV299(data) {
  const raw = String(data?.court_name || data?.matter_court_name || data?.court_title || data?.court || '').trim()
  if (!raw) return '[Missing: court_name]'
  return raw.replace(/\\s+court\\s*$/i, '').trim().toUpperCase()
}

function mioCaptionCountyV299(data) {
  const raw = String(data?.county || data?.matter_county || data?.court_county || '').trim()
  if (!raw) return '[Missing: county]'
  const upper = raw.toUpperCase().replace(/,?\\s*TEXAS\\s*$/i, '').trim()
  return upper + ', TEXAS'
}

function replaceMioCaptionParagraphV299(doc, paragraph, data) {
  if (!paragraph?.parentNode) return
  const parent = paragraph.parentNode
  const table = doc.createElementNS(WORD, 'w:tbl')
  const tblPr = doc.createElementNS(WORD, 'w:tblPr')
  const tblW = doc.createElementNS(WORD, 'w:tblW')
  tblW.setAttributeNS(WORD, 'w:w', '9360')
  tblW.setAttributeNS(WORD, 'w:type', 'dxa')
  tblPr.appendChild(tblW)
  const borders = doc.createElementNS(WORD, 'w:tblBorders')
  for (const side of ['top','left','bottom','right','insideH','insideV']) {
    const border = doc.createElementNS(WORD, 'w:' + side)
    border.setAttributeNS(WORD, 'w:val', 'nil')
    borders.appendChild(border)
  }
  tblPr.appendChild(borders)
  table.appendChild(tblPr)
  const grid = doc.createElementNS(WORD, 'w:tblGrid')
  for (const width of [4320, 480, 4560]) {
    const col = doc.createElementNS(WORD, 'w:gridCol')
    col.setAttributeNS(WORD, 'w:w', String(width))
    grid.appendChild(col)
  }
  table.appendChild(grid)
  const row = doc.createElementNS(WORD, 'w:tr')
  const leftLines = String(data?.case_caption_text || '').split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean)
  const safeLeft = leftLines.length ? leftLines : ['[Missing: case_caption_text]']
  const rightLines = ['IN THE DISTRICT COURT', '', mioCaptionCourtNameV299(data), '', mioCaptionCountyV299(data)]
  const markCount = Math.max(7, safeLeft.length, rightLines.length)
  const marks = Array.from({ length: markCount }, () => '§')
  row.appendChild(mioCaptionCellV299(doc, safeLeft, 4320, 'left'))
  row.appendChild(mioCaptionCellV299(doc, marks, 480, 'center'))
  row.appendChild(mioCaptionCellV299(doc, rightLines, 4560, 'center'))
  table.appendChild(row)
  parent.insertBefore(table, paragraph)
  parent.removeChild(paragraph)
}

`
    code = code.replace(applyAnchor, helpers + applyAnchor)
  }

  const normalBlock = `    const value = String(data?.[definition.token] ?? '')
    if (!value.trim()) {
      paragraph.parentNode?.removeChild(paragraph)
      return
    }
    replaceMioBlockParagraph(doc, paragraph, value)`
  const captionAware = `    if (definition.key === 'caption') {
      replaceMioCaptionParagraphV299(doc, paragraph, data)
      return
    }
    const value = String(data?.[definition.token] ?? '')
    if (!value.trim()) {
      paragraph.parentNode?.removeChild(paragraph)
      return
    }
    replaceMioBlockParagraph(doc, paragraph, value)`
  if (!code.includes(normalBlock)) throw new Error('V299 integration anchor changed: ordinary block replacement')
  code = code.replace(normalBlock, captionAware)

  if (code.includes('  if (existing.length) return')) code = code.replace('  if (existing.length) return', "  if (existing.length) { existing.slice(1).forEach(p => p.parentNode?.removeChild(p)); return }")
  return code
}

export default function mioV299FieldSelectorCaption() {
  return {
    name: 'mio-v299-field-selector-caption',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\\\', '/')
      if (path.endsWith('/src/App.jsx')) return { code: transformApp(source), map: null }
      if (path.endsWith('/src/mioDraftingComponents.js')) return { code: transformComponents(source), map: null }
      return null
    }
  }
}
