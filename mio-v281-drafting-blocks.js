// Mio V281: insertable drafting blocks in the Word template builder.
// Blocks are stored as explicit Mio markers inside the .docx so their exact location
// and Word paragraph formatting travel with the template. At generation time the
// marker is replaced with the matter-aware caption/signature/certificate content.

function replaceOnce(code, from, to, label) {
  const first = code.indexOf(from)
  if (first < 0 || code.indexOf(from, first + from.length) >= 0) throw new Error('V281 integration anchor changed: ' + label)
  return code.replace(from, to)
}

function transformWorkspace(source) {
  let code = source
  code = replaceOnce(
    code,
    "  if (!styleId || styleId === '@custom') return 'Custom caption: keep and edit the caption already in the Word template.'",
    "  if (!styleId) return 'Automatic caption: Mio chooses the style from the matter case type and whether children are associated with the matter.'\n  if (styleId === '@custom') return 'Custom caption: keep and edit the caption already in the Word template.'",
    'automatic case-style preview'
  )
  code = replaceOnce(code, "  const styleId = draft.case_style_id || '@custom'", "  const styleId = draft.case_style_id || ''", 'template automatic case style')
  code = replaceOnce(
    code,
    '<option value="@custom">Custom — keep/edit this template\'s caption</option>',
    '<option value="">Automatic — case type + matter children</option><option value="@custom">Custom — keep/edit this template\'s caption</option>',
    'automatic style option'
  )
  code = replaceOnce(
    code,
    'Use mapped smart-block target / token',
    'Use inserted block / mapped token',
    'smart block placement label'
  )
  return code
}

function transformComponents(source) {
  let code = source
  code = replaceOnce(
    code,
    "  return binding || xmlText.includes('{{' + component.token + '}}') || (component.key === 'caption' && xmlText.includes('{{caption_left_line_1}}'))",
    "  return binding || xmlText.includes('{{' + component.token + '}}') || xmlText.includes('[[MIO_BLOCK:' + component.key + ']]') || (component.key === 'caption' && xmlText.includes('{{caption_left_line_1}}'))",
    'block target detection'
  )

  const marker = '// Only explicit instance changes reach this function. Original alignment, tabs, tables, and numbering stay intact.'
  const helpers = `function replaceMioBlockParagraph(doc, paragraph, text) {
  const previousRun = Array.from(paragraph.getElementsByTagNameNS(WORD, 'r'))[0] || null
  const previousRunProperties = previousRun ? Array.from(previousRun.children || []).find(node => node.namespaceURI === WORD && node.localName === 'rPr')?.cloneNode(true) : null
  Array.from(paragraph.childNodes || []).forEach(node => {
    if (!(node.nodeType === 1 && node.namespaceURI === WORD && node.localName === 'pPr')) paragraph.removeChild(node)
  })
  const run = doc.createElementNS(WORD, 'w:r')
  if (previousRunProperties) run.appendChild(previousRunProperties)
  const lines = String(text == null ? '' : text).split(/\\r?\\n/)
  ;(lines.length ? lines : ['']).forEach((line, index) => {
    if (index) run.appendChild(doc.createElementNS(WORD, 'w:br'))
    const value = doc.createElementNS(WORD, 'w:t')
    value.setAttributeNS(XML_SPACE, 'xml:space', 'preserve')
    value.textContent = line
    run.appendChild(value)
  })
  paragraph.appendChild(run)
}

function applyMioBlockMarkers(doc, body, data) {
  const definitions = new Map(COMPONENTS.map(component => [component.key, component]))
  const paragraphs = Array.from(body.getElementsByTagNameNS(WORD, 'p'))
  paragraphs.forEach(paragraph => {
    const match = String(paragraph.textContent || '').trim().match(/^\\[\\[MIO_BLOCK:([a-z0-9_]+)\\]\\]$/i)
    if (!match) return
    const definition = definitions.get(String(match[1] || '').toLowerCase())
    if (!definition) return
    const value = String(data?.[definition.token] ?? '')
    if (!value.trim()) {
      paragraph.parentNode?.removeChild(paragraph)
      return
    }
    replaceMioBlockParagraph(doc, paragraph, value)
  })
}

`
  if (!code.includes(marker)) throw new Error('V281 integration anchor changed: component XML marker')
  code = code.replace(marker, helpers + marker)
  code = replaceOnce(
    code,
    '  applySensitiveNotice(doc, body, setup)',
    '  applySensitiveNotice(doc, body, setup)\n  applyMioBlockMarkers(doc, body, data)',
    'apply block markers'
  )
  return code
}

function transformApp(source) {
  let code = source
  code = replaceOnce(code, "const MIO_APP_VERSION = 'Mio V280 (document setup)'", "const MIO_APP_VERSION = 'Mio V281 (template blocks)'", 'version')

  const state = '  const [draftingWordEditorParagraphIndex, setDraftingWordEditorParagraphIndex] = useState(-1)'
  code = replaceOnce(
    code,
    state,
    state + "\n  const [draftingWordBlockInsert, setDraftingWordBlockInsert] = useState({ key: 'caption', alignment: 'center', start_percent: 0, position: 'after' })",
    'block insert state'
  )

  const toolbar = '  function draftingStudioV275Toolbar() {'
  const helpers = `  function draftingStudioV281BlockMarker(key) {
    return '[[MIO_BLOCK:' + String(key || '') + ']]'
  }

  function draftingStudioV281BlockLabel(key) {
    const labels = {
      caption: 'Heading / case caption',
      conference: 'Certificate of conference',
      certificate_simple: 'Certificate of service — all parties',
      certificate_detailed: 'Certificate of service — detailed recipients',
      signature: 'Signature block',
      notice: 'Notice block',
      custom: 'Custom reusable block'
    }
    return labels[key] || MIO_DRAFT_COMPONENTS.find(item => item.key === key)?.label || key
  }

  function draftingStudioV281BlockPreset(key) {
    if (key === 'signature') return { alignment: 'left', start_percent: 50 }
    if (key === 'caption') return { alignment: 'center', start_percent: 0 }
    return { alignment: 'left', start_percent: 0 }
  }

  function draftingStudioV281ReadWordNumber(node, name, ns, fallback) {
    const raw = node?.getAttributeNS?.(ns, name) || node?.getAttribute?.('w:' + name) || ''
    const value = Number(raw)
    return Number.isFinite(value) ? value : fallback
  }

  function draftingStudioV281ApplyBlockLayout(xmlDoc, paragraph, ns, options = draftingWordBlockInsert) {
    if (!paragraph) return
    const pPr = draftingStudioV275EnsureChild(paragraph, 'pPr', ns, true)
    const jc = draftingStudioV275EnsureChild(pPr, 'jc', ns)
    draftingStudioV275SetWordAttr(jc, 'val', ['left', 'center', 'right'].includes(options.alignment) ? options.alignment : 'left', ns)
    const ind = draftingStudioV275EnsureChild(pPr, 'ind', ns)
    const section = Array.from(xmlDoc.getElementsByTagNameNS(ns, 'sectPr'))[0]
    const pageSize = section ? draftingStudioV275WordChild(section, 'pgSz', ns) : null
    const margins = section ? draftingStudioV275WordChild(section, 'pgMar', ns) : null
    const pageWidth = draftingStudioV281ReadWordNumber(pageSize, 'w', ns, 12240)
    const leftMargin = draftingStudioV281ReadWordNumber(margins, 'left', ns, 1440)
    const rightMargin = draftingStudioV281ReadWordNumber(margins, 'right', ns, 1440)
    const contentWidth = Math.max(1440, pageWidth - leftMargin - rightMargin)
    const percent = Math.max(0, Math.min(75, Number(options.start_percent || 0)))
    const indent = Math.round(contentWidth * percent / 100)
    draftingStudioV275SetWordAttr(ind, 'left', indent > 0 ? indent : '', ns)
  }

  async function draftingStudioV281InsertBlock() {
    const index = draftingStudioV275SelectedParagraphIndex()
    if (index < 0) return alert('Click the paragraph immediately before or after where this block should go.')
    const definition = MIO_DRAFT_COMPONENTS.find(item => item.key === draftingWordBlockInsert.key)
    if (!definition) return alert('Choose a block type first.')
    const position = draftingWordBlockInsert.position === 'before' ? 'before' : 'after'
    await draftingStudioV275MutateCurrentDocx(({ xmlDoc, paragraphs, ns }) => {
      const current = paragraphs[index]
      if (!current?.parentNode) throw new Error('Mio could not find the selected Word paragraph.')
      const paragraph = xmlDoc.createElementNS(ns, 'w:p')
      const run = xmlDoc.createElementNS(ns, 'w:r')
      const text = xmlDoc.createElementNS(ns, 'w:t')
      text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
      text.textContent = draftingStudioV281BlockMarker(definition.key)
      run.appendChild(text)
      paragraph.appendChild(run)
      draftingStudioV281ApplyBlockLayout(xmlDoc, paragraph, ns, draftingWordBlockInsert)
      if (position === 'before') current.parentNode.insertBefore(paragraph, current)
      else current.parentNode.insertBefore(paragraph, current.nextSibling)
    }, 'Inserted ' + draftingStudioV281BlockLabel(definition.key) + ' block')
    setDraftingWordEditorParagraphIndex(position === 'before' ? index : index + 1)
  }

  async function draftingStudioV281UpdateSelectedBlock() {
    const index = draftingStudioV275SelectedParagraphIndex()
    if (index < 0) return alert('Select a Mio block placeholder first.')
    const definition = MIO_DRAFT_COMPONENTS.find(item => item.key === draftingWordBlockInsert.key)
    if (!definition) return
    await draftingStudioV275MutateCurrentDocx(({ xmlDoc, paragraphs, ns }) => {
      const paragraph = paragraphs[index]
      if (!paragraph) throw new Error('Mio could not find the selected Word paragraph.')
      const existing = MIO_DRAFT_COMPONENTS.find(item => String(paragraph.textContent || '').trim() === draftingStudioV281BlockMarker(item.key))
      if (!existing) throw new Error('The selected paragraph is not a Mio block placeholder.')
      draftingWordSetElementText(paragraph, draftingStudioV281BlockMarker(definition.key))
      draftingStudioV281ApplyBlockLayout(xmlDoc, paragraph, ns, draftingWordBlockInsert)
    }, 'Updated selected drafting block')
    setDraftingWordEditorParagraphIndex(index)
  }

  async function draftingStudioV281DeleteSelectedBlock() {
    const index = draftingStudioV275SelectedParagraphIndex()
    if (index < 0) return alert('Select a Mio block placeholder first.')
    if (!window.confirm('Remove this Mio block from the Word template?')) return
    await draftingStudioV275MutateCurrentDocx(({ paragraphs }) => {
      const paragraph = paragraphs[index]
      const existing = MIO_DRAFT_COMPONENTS.find(item => String(paragraph?.textContent || '').trim() === draftingStudioV281BlockMarker(item.key))
      if (!paragraph || !existing) throw new Error('The selected paragraph is not a Mio block placeholder.')
      paragraph.parentNode?.removeChild(paragraph)
    }, 'Removed drafting block')
    setDraftingWordEditorParagraphIndex(-1)
  }

  function draftingStudioV281BlockPanel() {
    const selected = draftingStudioV275SelectedParagraphIndex()
    const choices = MIO_DRAFT_COMPONENTS.filter(item => ['caption', 'conference', 'certificate_simple', 'certificate_detailed', 'signature', 'notice', 'custom'].includes(item.key))
    const setType = (key) => {
      const preset = draftingStudioV281BlockPreset(key)
      setDraftingWordBlockInsert(current => ({ ...current, key, ...preset }))
    }
    return <details style={{ margin: '8px 0 10px', border: '1px solid #bfdbfe', borderRadius: 10, background: '#eff6ff', padding: '9px 11px' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 900 }}>Insert blocks</summary>
      <p style={{ margin: '8px 0', color: '#334155', fontSize: 12 }}>Select the paragraph next to the insertion point. Mio stores the block marker in the actual Word template. <strong>Alignment</strong> controls the text inside the block; <strong>start position</strong> controls where the block begins across the usable page width. For the signature layout in your example, use Left alignment + 50% start.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(185px,1fr))', gap: 8 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 800 }}>Block<select value={draftingWordBlockInsert.key} onChange={event => setType(event.target.value)}>{choices.map(item => <option key={item.key} value={item.key}>{draftingStudioV281BlockLabel(item.key)}</option>)}</select></label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 800 }}>Insert<select value={draftingWordBlockInsert.position} onChange={event => setDraftingWordBlockInsert(current => ({ ...current, position: event.target.value }))}><option value="after">After selected paragraph</option><option value="before">Before selected paragraph</option></select></label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 800 }}>Alignment<select value={draftingWordBlockInsert.alignment} onChange={event => setDraftingWordBlockInsert(current => ({ ...current, alignment: event.target.value }))}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 800 }}>Start position<select value={String(draftingWordBlockInsert.start_percent)} onChange={event => setDraftingWordBlockInsert(current => ({ ...current, start_percent: Number(event.target.value) }))}><option value="0">0% — normal margin</option><option value="25">25% across</option><option value="33">33% across</option><option value="40">40% across</option><option value="50">50% — halfway across</option><option value="60">60% across</option></select></label>
      </div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginTop: 9 }}>
        <button type="button" disabled={selected < 0} onClick={draftingStudioV281InsertBlock}>Insert block</button>
        <button type="button" disabled={selected < 0} onClick={draftingStudioV281UpdateSelectedBlock}>Apply options to selected block</button>
        <button type="button" disabled={selected < 0} onClick={draftingStudioV281DeleteSelectedBlock} style={{ color: '#991b1b' }}>Remove selected block</button>
        <span style={{ fontSize: 11, color: '#64748b' }}>{selected >= 0 ? 'Paragraph ' + (selected + 1) + ' selected' : 'Click a paragraph in the Word preview first'}</span>
      </div>
      {draftingWordBlockInsert.key === 'caption' && <p style={{ margin: '7px 0 0', fontSize: 11, color: '#475569' }}>Heading / case caption uses the template Case Style setting. Choose Automatic there to let Mio select Divorce vs. SAPCR/Modification styling from the matter and its children.</p>}
      {draftingWordBlockInsert.key === 'signature' && <p style={{ margin: '7px 0 0', fontSize: 11, color: '#475569' }}>Signature wording comes from the selected signature block in Drafting settings; 50% start + Left alignment creates a left-aligned block beginning around the middle of the page.</p>}
    </details>
  }

`
  if (!code.includes(toolbar)) throw new Error('V281 integration anchor changed: V275 toolbar')
  code = code.replace(toolbar, helpers + toolbar)

  code = replaceOnce(
    code,
    '{draftingStudioDocument && draftingStudioV275Toolbar()}',
    '{draftingStudioDocument && <>{draftingStudioV275Toolbar()}{draftingStudioV281BlockPanel()}</>}',
    'block panel placement'
  )
  return code
}

export default function mioV281DraftingBlocks() {
  return {
    name: 'mio-v281-drafting-blocks',
    enforce: 'pre',
    transform(source, id) {
      const clean = id.split('?')[0].replaceAll('\\\\', '/')
      if (clean.endsWith('/src/App.jsx')) return { code: transformApp(source), map: null }
      if (clean.endsWith('/src/MioDraftingWorkspace.jsx')) return { code: transformWorkspace(source), map: null }
      if (clean.endsWith('/src/mioDraftingComponents.js')) return { code: transformComponents(source), map: null }
      return null
    }
  }
}
