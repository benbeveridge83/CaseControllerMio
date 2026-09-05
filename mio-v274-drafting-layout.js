// Mio V274: restore actual Word block layout in Drafting Studio.
// Runs after V272. This keeps the safe paragraph-format patch, then adds tables,
// Word line breaks/tabs, numbered/bulleted list labels, and real page margins.
export default function mioV274DraftingLayout() {
  return {
    name: 'mio-v274-drafting-layout',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('/src/App.jsx')) return null
      let code = source
      code = code.replace("const MIO_APP_VERSION = 'Mio V272'", "const MIO_APP_VERSION = 'Mio V274'")

      const oldParagraphText = `  function draftingStudioParagraphText(paragraph) {
    if (!paragraph) return ''
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const textNodes = Array.from(paragraph.getElementsByTagNameNS(wordNamespace, 't'))
    if (!textNodes.length) return paragraph.textContent || ''
    return textNodes.map((node) => node.textContent || '').join('')
  }`
      const newParagraphText = `  function draftingStudioParagraphText(paragraph) {
    if (!paragraph) return ''
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const pieces = []
    const walk = (node) => {
      if (!node) return
      if (node.nodeType === 3) return
      if (node.namespaceURI === wordNamespace) {
        if (['t', 'instrText', 'delText'].includes(node.localName)) { pieces.push(node.textContent || ''); return }
        if (node.localName === 'tab') { pieces.push('\\t'); return }
        if (['br', 'cr'].includes(node.localName)) { pieces.push('\\n'); return }
        if (node.localName === 'noBreakHyphen') { pieces.push('‑'); return }
        if (node.localName === 'softHyphen') { pieces.push('­'); return }
      }
      Array.from(node.childNodes || []).forEach(walk)
    }
    walk(paragraph)
    return pieces.length ? pieces.join('') : (paragraph.textContent || '')
  }`
      if (code.includes(oldParagraphText)) code = code.replace(oldParagraphText, newParagraphText)

      const parserMarker = '  async function draftingStudioParseTemplateFile(file) {'
      const parserAt = code.indexOf(parserMarker)
      if (parserAt >= 0 && !code.includes('function draftingStudioV274BuildBlocks(')) {
        const helpers = `  function draftingStudioV274DirectChild(node, localName) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    return Array.from(node?.childNodes || []).find((child) => child?.nodeType === 1 && child.namespaceURI === ns && child.localName === localName) || null
  }

  function draftingStudioV274Attr(node, name, fallback = '') {
    if (!node) return fallback
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const value = node.getAttributeNS?.(ns, name) ?? node.getAttribute?.('w:' + name) ?? node.getAttribute?.(name)
    return value == null || value === '' ? fallback : value
  }

  function draftingStudioV274BuildBlocks(doc, paragraphNodes) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const body = doc.getElementsByTagNameNS(ns, 'body')[0]
    if (!body) return []
    const indexByNode = new Map((paragraphNodes || []).map((node, index) => [node, index]))
    return Array.from(body.childNodes || []).filter((node) => node?.nodeType === 1 && ['p', 'tbl'].includes(node.localName)).map((node, blockIndex) => {
      if (node.localName === 'p') return { type: 'paragraph', id: 'p-' + blockIndex, paragraph_index: indexByNode.get(node) }
      const tblPr = draftingStudioV274DirectChild(node, 'tblPr')
      const gridNode = draftingStudioV274DirectChild(node, 'tblGrid')
      const gridColumns = Array.from(gridNode?.childNodes || []).filter((child) => child?.nodeType === 1 && child.localName === 'gridCol').map((column) => Number(draftingStudioV274Attr(column, 'w', '0')) || 0)
      const borders = draftingStudioV274DirectChild(tblPr, 'tblBorders')
      const borderNodes = Array.from(borders?.childNodes || []).filter((child) => child?.nodeType === 1)
      const bordered = borderNodes.some((border) => !['nil', 'none', '0', 'false'].includes(String(draftingStudioV274Attr(border, 'val', '')).toLowerCase()))
      const rawBorderColor = draftingStudioV274Attr(borderNodes.find((border) => draftingStudioV274Attr(border, 'color', '')), 'color', '808080')
      const rows = Array.from(node.childNodes || []).filter((child) => child?.nodeType === 1 && child.localName === 'tr').map((row, rowIndex) => ({
        id: 'row-' + blockIndex + '-' + rowIndex,
        cells: Array.from(row.childNodes || []).filter((child) => child?.nodeType === 1 && child.localName === 'tc').map((cell, cellIndex) => {
          const tcPr = draftingStudioV274DirectChild(cell, 'tcPr')
          const gridSpan = draftingStudioV274DirectChild(tcPr, 'gridSpan')
          const vAlign = draftingStudioV274DirectChild(tcPr, 'vAlign')
          const shd = draftingStudioV274DirectChild(tcPr, 'shd')
          const fill = draftingStudioV274Attr(shd, 'fill', '')
          return {
            id: 'cell-' + blockIndex + '-' + rowIndex + '-' + cellIndex,
            colspan: Math.max(1, Number(draftingStudioV274Attr(gridSpan, 'val', '1')) || 1),
            vertical_align: draftingStudioV274Attr(vAlign, 'val', 'top'),
            background: fill && String(fill).toLowerCase() !== 'auto' ? '#' + fill : '',
            paragraph_indices: Array.from(cell.getElementsByTagNameNS(ns, 'p')).map((paragraph) => indexByNode.get(paragraph)).filter((value) => Number.isFinite(value))
          }
        })
      }))
      return { type: 'table', id: 'table-' + blockIndex, grid_columns: gridColumns, bordered, border_color: rawBorderColor && String(rawBorderColor).toLowerCase() !== 'auto' ? '#' + rawBorderColor : '#808080', rows }
    })
  }

  function draftingStudioV274PageLayout(doc) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const sectPr = doc.getElementsByTagNameNS(ns, 'sectPr')[0]
    const pgSz = draftingStudioV274DirectChild(sectPr, 'pgSz')
    const pgMar = draftingStudioV274DirectChild(sectPr, 'pgMar')
    return {
      width_twips: Number(draftingStudioV274Attr(pgSz, 'w', '12240')) || 12240,
      height_twips: Number(draftingStudioV274Attr(pgSz, 'h', '15840')) || 15840,
      margin_top_twips: Number(draftingStudioV274Attr(pgMar, 'top', '1080')) || 1080,
      margin_right_twips: Number(draftingStudioV274Attr(pgMar, 'right', '1440')) || 1440,
      margin_bottom_twips: Number(draftingStudioV274Attr(pgMar, 'bottom', '1080')) || 1080,
      margin_left_twips: Number(draftingStudioV274Attr(pgMar, 'left', '1440')) || 1440
    }
  }

`
        code = code.slice(0, parserAt) + helpers + code.slice(parserAt)
      }

      const parserStart = code.indexOf(parserMarker)
      const parserEnd = parserStart >= 0 ? code.indexOf('  async function draftingStudioCreateTemplateFromUpload(file) {', parserStart) : -1
      if (parserStart >= 0 && parserEnd > parserStart) {
        let region = code.slice(parserStart, parserEnd)
        if (!region.includes('draftingStudioV274BuildBlocks(doc, paragraphNodes)')) {
          region = region.replace(
            '    const sections = []',
            `    let draftingStudioV274ListNumber = 0
    paragraphs.forEach((paragraph) => {
      if (/list\\s*number/i.test(paragraph.style_name || '')) paragraph.word_list_label = String(++draftingStudioV274ListNumber) + '.'
      else if (/list\\s*bullet/i.test(paragraph.style_name || '')) paragraph.word_list_label = '•'
      else paragraph.word_list_label = ''
    })
    const blocks = draftingStudioV274BuildBlocks(doc, paragraphNodes)
    const pageLayout = draftingStudioV274PageLayout(doc)
    const sections = []`
          )
          region = region.replace(
            '      paragraphs,\n      sections,',
            '      paragraphs,\n      blocks,\n      page_layout: pageLayout,\n      sections,'
          )
        }
        code = code.slice(0, parserStart) + region + code.slice(parserEnd)
      }

      const visualMarker = '  function renderDraftingVisualBuilder() {'
      const visualAt = code.indexOf(visualMarker)
      if (visualAt >= 0 && !code.includes('function draftingStudioV274RenderBlocks(')) {
        const renderHelpers = `  function draftingStudioV274ParagraphNode(paragraph, template, keyPrefix = '') {
    if (!paragraph || (!draftingShowHiddenManualText && paragraph.hidden)) return null
    const selected = draftingStudioSelection && paragraph.index >= draftingStudioSelection.paragraph_start && paragraph.index <= draftingStudioSelection.paragraph_end
    const align = String(paragraph.word_alignment || '').toLowerCase()
    const style = {
      minHeight: paragraph.text ? 18 : 8,
      marginTop: paragraph.word_space_before ? (paragraph.word_space_before / 20) + 'pt' : 0,
      marginBottom: paragraph.word_space_after ? (paragraph.word_space_after / 20) + 'pt' : (paragraph.style_name === 'Title' ? 12 : 2),
      marginLeft: paragraph.word_indent_left ? (paragraph.word_indent_left / 1440) + 'in' : 0,
      marginRight: paragraph.word_indent_right ? (paragraph.word_indent_right / 1440) + 'in' : 0,
      textIndent: paragraph.word_first_line ? (paragraph.word_first_line / 1440) + 'in' : (paragraph.word_hanging ? (-paragraph.word_hanging / 1440) + 'in' : 0),
      textAlign: align === 'center' ? 'center' : (align === 'right' || align === 'end') ? 'right' : (align === 'both' || align === 'distribute') ? 'justify' : (paragraph.style_name === 'Title' ? 'center' : 'left'),
      fontWeight: paragraph.is_heading || paragraph.style_name === 'Title' ? 700 : 400,
      fontSize: paragraph.style_name === 'Title' ? 18 : 14,
      color: paragraph.hidden ? '#7c3aed' : '#111827',
      background: selected ? '#dbeafe' : 'transparent',
      outline: selected ? '2px solid #60a5fa' : 'none',
      opacity: paragraph.hidden ? .72 : 1,
      whiteSpace: 'pre-wrap',
      scrollMarginTop: 10,
      boxSizing: 'border-box',
      overflowWrap: 'break-word'
    }
    return <div id={'drafting-paragraph-' + paragraph.index} data-drafting-paragraph-index={paragraph.index} key={keyPrefix + paragraph.index} onMouseUp={(event) => draftingStudioCaptureSelection(event, paragraph.index)} style={style}>
      {paragraph.word_list_label && <span aria-hidden="true" style={{ display: 'inline-block', width: '.32in', marginLeft: '-.32in', textIndent: 0, userSelect: 'none' }}>{paragraph.word_list_label}</span>}
      {paragraph.hidden && <span style={{ fontFamily: 'Arial', fontSize: 9, background: '#ede9fe', color: '#6d28d9', borderRadius: 999, padding: '2px 5px', marginRight: 6 }}>GUIDANCE</span>}
      {renderDraftingStudioHighlightedText(paragraph, template)}
    </div>
  }

  function draftingStudioV274TableNode(block, template) {
    const total = (block.grid_columns || []).reduce((sum, value) => sum + (Number(value) || 0), 0)
    return <table key={block.id} style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', margin: 0 }}>
      {!!total && <colgroup>{(block.grid_columns || []).map((value, index) => <col key={index} style={{ width: ((Number(value) || 0) / total * 100) + '%' }} />)}</colgroup>}
      <tbody>{(block.rows || []).map((row) => <tr key={row.id}>{(row.cells || []).map((cell) => <td key={cell.id} colSpan={cell.colspan || 1} style={{ border: block.bordered ? '1px solid ' + (block.border_color || '#808080') : 'none', verticalAlign: cell.vertical_align === 'center' ? 'middle' : cell.vertical_align === 'bottom' ? 'bottom' : 'top', background: cell.background || 'transparent', padding: block.bordered ? '3px 5px' : '0 3px', boxSizing: 'border-box' }}>
        {(cell.paragraph_indices || []).map((index) => draftingStudioV274ParagraphNode(draftingStudioDocument?.paragraphs?.[index], template, cell.id + '-'))}
      </td>)}</tr>)}</tbody>
    </table>
  }

  function draftingStudioV274RenderBlocks(template) {
    const doc = draftingStudioDocument
    if (!doc) return null
    const blocks = Array.isArray(doc.blocks) && doc.blocks.length ? doc.blocks : (doc.paragraphs || []).map((paragraph) => ({ type: 'paragraph', id: 'legacy-' + paragraph.index, paragraph_index: paragraph.index }))
    return blocks.map((block) => block.type === 'table' ? draftingStudioV274TableNode(block, template) : draftingStudioV274ParagraphNode(doc.paragraphs?.[block.paragraph_index], template, block.id + '-'))
  }

  function draftingStudioV274PageStyle() {
    const layout = draftingStudioDocument?.page_layout || {}
    const inches = (twips, fallback) => ((Number(twips) || fallback) / 1440) + 'in'
    const width = inches(layout.width_twips, 12240)
    const height = inches(layout.height_twips, 15840)
    return {
      width: 'min(' + width + ',100%)', minHeight: height, margin: '0 auto', background: '#fff', boxShadow: '0 8px 30px rgba(15,23,42,.18)',
      padding: inches(layout.margin_top_twips, 1080) + ' ' + inches(layout.margin_right_twips, 1440) + ' ' + inches(layout.margin_bottom_twips, 1080) + ' ' + inches(layout.margin_left_twips, 1440),
      boxSizing: 'border-box', fontFamily: 'Times New Roman,serif', fontSize: 14, lineHeight: 1.35
    }
  }

`
        code = code.slice(0, visualAt) + renderHelpers + code.slice(visualAt)
      }

      const builderAt = code.indexOf(visualMarker)
      if (builderAt >= 0) {
        const mapStart = code.indexOf('            {visibleParagraphs.map((paragraph) => {', builderAt)
        const mainEnd = mapStart >= 0 ? code.indexOf('        </main>', mapStart) : -1
        const mapEnd = mainEnd > mapStart ? code.lastIndexOf('            })}', mainEnd) : -1
        if (mapStart >= 0 && mapEnd > mapStart) {
          code = code.slice(0, mapStart) + '            {draftingStudioV274RenderBlocks(template)}' + code.slice(mapEnd + '            })}'.length)
        }
        const pageStyle = "          <div style={{ width: 'min(8.5in,100%)', minHeight: '11in', margin: '0 auto', background: '#fff', boxShadow: '0 8px 30px rgba(15,23,42,.18)', padding: '0.72in 0.78in', boxSizing: 'border-box', fontFamily: 'Times New Roman,serif', fontSize: 14, lineHeight: 1.35 }}>"
        if (code.includes(pageStyle)) code = code.replace(pageStyle, '          <div style={draftingStudioV274PageStyle()}>')
      }

      return { code, map: null }
    }
  }
}
