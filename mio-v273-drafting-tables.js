// Mio V273: restore Word table structure and automatic numbered-list labels in Drafting Studio.
// Runs after the V272 paragraph-format patch.
export default function mioV273DraftingTables() {
  return {
    name: 'mio-v273-drafting-word-tables',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('/src/App.jsx')) return null
      let code = source
      code = code.replace("const MIO_APP_VERSION = 'Mio V272'", "const MIO_APP_VERSION = 'Mio V273'")

      const parserMarker = '  async function draftingStudioParseTemplateFile(file) {'
      const parserAt = code.indexOf(parserMarker)
      if (parserAt >= 0 && !code.includes('function draftingStudioV273BuildBlocks(')) {
        const helpers = `  function draftingStudioV273DirectChild(node, localName) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    return Array.from(node?.childNodes || []).find((child) => child?.nodeType === 1 && child.namespaceURI === ns && child.localName === localName) || null
  }

  function draftingStudioV273Attr(node, name, fallback = '') {
    if (!node) return fallback
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const value = node.getAttributeNS?.(ns, name) ?? node.getAttribute?.('w:' + name) ?? node.getAttribute?.(name)
    return value == null || value === '' ? fallback : value
  }

  function draftingStudioV273BuildBlocks(doc, paragraphNodes) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const body = doc.getElementsByTagNameNS(ns, 'body')[0]
    if (!body) return []
    const indexByNode = new Map((paragraphNodes || []).map((node, index) => [node, index]))
    return Array.from(body.childNodes || []).filter((node) => node?.nodeType === 1 && ['p','tbl'].includes(node.localName)).map((node, blockIndex) => {
      if (node.localName === 'p') return { type: 'paragraph', id: 'p-' + blockIndex, paragraph_index: indexByNode.get(node) }
      const tblPr = draftingStudioV273DirectChild(node, 'tblPr')
      const gridNode = draftingStudioV273DirectChild(node, 'tblGrid')
      const gridColumns = Array.from(gridNode?.childNodes || []).filter((child) => child?.nodeType === 1 && child.localName === 'gridCol').map((column) => Number(draftingStudioV273Attr(column, 'w', '0')) || 0)
      const borders = draftingStudioV273DirectChild(tblPr, 'tblBorders')
      const borderNodes = Array.from(borders?.childNodes || []).filter((child) => child?.nodeType === 1)
      const bordered = borderNodes.some((border) => !['nil','none','0','false'].includes(String(draftingStudioV273Attr(border, 'val', '')).toLowerCase()))
      const borderColorNode = borderNodes.find((border) => draftingStudioV273Attr(border, 'color', ''))
      const rawBorderColor = draftingStudioV273Attr(borderColorNode, 'color', '808080')
      const rows = Array.from(node.childNodes || []).filter((child) => child?.nodeType === 1 && child.localName === 'tr').map((row, rowIndex) => ({
        id: 'row-' + blockIndex + '-' + rowIndex,
        cells: Array.from(row.childNodes || []).filter((child) => child?.nodeType === 1 && child.localName === 'tc').map((cell, cellIndex) => {
          const tcPr = draftingStudioV273DirectChild(cell, 'tcPr')
          const gridSpan = draftingStudioV273DirectChild(tcPr, 'gridSpan')
          const vAlign = draftingStudioV273DirectChild(tcPr, 'vAlign')
          return {
            id: 'cell-' + blockIndex + '-' + rowIndex + '-' + cellIndex,
            colspan: Math.max(1, Number(draftingStudioV273Attr(gridSpan, 'val', '1')) || 1),
            vertical_align: draftingStudioV273Attr(vAlign, 'val', 'top'),
            paragraph_indices: Array.from(cell.getElementsByTagNameNS(ns, 'p')).map((paragraph) => indexByNode.get(paragraph)).filter((value) => Number.isFinite(value))
          }
        })
      }))
      return { type: 'table', id: 'table-' + blockIndex, grid_columns: gridColumns, bordered, border_color: rawBorderColor && rawBorderColor.toLowerCase() !== 'auto' ? '#' + rawBorderColor : '#808080', rows }
    })
  }

  function draftingStudioV273PageLayout(doc) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const sectPr = doc.getElementsByTagNameNS(ns, 'sectPr')[0]
    const pgSz = draftingStudioV273DirectChild(sectPr, 'pgSz')
    const pgMar = draftingStudioV273DirectChild(sectPr, 'pgMar')
    return {
      width_twips: Number(draftingStudioV273Attr(pgSz, 'w', '12240')) || 12240,
      height_twips: Number(draftingStudioV273Attr(pgSz, 'h', '15840')) || 15840,
      margin_top_twips: Number(draftingStudioV273Attr(pgMar, 'top', '1080')) || 1080,
      margin_right_twips: Number(draftingStudioV273Attr(pgMar, 'right', '1440')) || 1440,
      margin_bottom_twips: Number(draftingStudioV273Attr(pgMar, 'bottom', '1080')) || 1080,
      margin_left_twips: Number(draftingStudioV273Attr(pgMar, 'left', '1440')) || 1440
    }
  }

`
        code = code.slice(0, parserAt) + helpers + code.slice(parserAt)
      }

      const parserStart = code.indexOf(parserMarker)
      const parserEnd = parserStart >= 0 ? code.indexOf('  async function draftingStudioCreateTemplateFromUpload(file) {', parserStart) : -1
      if (parserStart >= 0 && parserEnd > parserStart) {
        let region = code.slice(parserStart, parserEnd)
        if (!region.includes('draftingStudioV273BuildBlocks(doc, paragraphNodes)')) {
          region = region.replace(
            '    const sections = []',
            `    let draftingStudioV273ListNumber = 0
    paragraphs.forEach((paragraph) => {
      if (/list\\s*number/i.test(paragraph.style_name || '')) paragraph.word_list_label = String(++draftingStudioV273ListNumber) + '.'
      else if (paragraph.normalized) draftingStudioV273ListNumber = 0
    })
    const blocks = draftingStudioV273BuildBlocks(doc, paragraphNodes)
    const pageLayout = draftingStudioV273PageLayout(doc)
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
      if (visualAt >= 0 && !code.includes('function draftingStudioV273RenderBlocks(')) {
        const renderHelpers = `  function draftingStudioV273ParagraphNode(paragraph, template, keyPrefix = '') {
    if (!paragraph || (!draftingShowHiddenManualText && paragraph.hidden)) return null
    const selected = draftingStudioSelection && paragraph.index >= draftingStudioSelection.paragraph_start && paragraph.index <= draftingStudioSelection.paragraph_end
    const align = String(paragraph.word_alignment || '').toLowerCase()
    const style = {
      minHeight: paragraph.text ? 20 : 10,
      marginTop: paragraph.word_space_before ? (paragraph.word_space_before / 20) + 'pt' : 0,
      marginBottom: paragraph.word_space_after ? (paragraph.word_space_after / 20) + 'pt' : (paragraph.style_name === 'Title' ? 12 : 3),
      marginLeft: paragraph.word_indent_left ? (paragraph.word_indent_left / 1440) + 'in' : 0,
      marginRight: paragraph.word_indent_right ? (paragraph.word_indent_right / 1440) + 'in' : 0,
      textIndent: paragraph.word_first_line ? (paragraph.word_first_line / 1440) + 'in' : (paragraph.word_hanging ? (-paragraph.word_hanging / 1440) + 'in' : 0),
      textAlign: align === 'center' ? 'center' : (align === 'right' || align === 'end') ? 'right' : (align === 'both' || align === 'distribute') ? 'justify' : (paragraph.style_name === 'Title' ? 'center' : 'left'),
      fontWeight: paragraph.is_heading || paragraph.style_name === 'Title' ? 700 : 400,
      fontSize: paragraph.style_name === 'Title' ? 18 : 14,
      color: paragraph.hidden ? '#7c3aed' : '#111827',
      background: selected ? '#dbeafe' : 'transparent', outline: selected ? '2px solid #60a5fa' : 'none', opacity: paragraph.hidden ? .72 : 1,
      whiteSpace: 'pre-wrap', scrollMarginTop: 10, boxSizing: 'border-box', overflowWrap: 'break-word'
    }
    return <div id={`drafting-paragraph-${paragraph.index}`} data-drafting-paragraph-index={paragraph.index} key={keyPrefix + paragraph.index} onMouseUp={(event) => draftingStudioCaptureSelection(event, paragraph.index)} style={style}>
      {paragraph.word_list_label && <span aria-hidden="true" style={{ display: 'inline-block', width: '.32in', marginLeft: '-.32in', textIndent: 0, userSelect: 'none' }}>{paragraph.word_list_label}</span>}
      {paragraph.hidden && <span style={{ fontFamily: 'Arial', fontSize: 9, background: '#ede9fe', color: '#6d28d9', borderRadius: 999, padding: '2px 5px', marginRight: 6 }}>GUIDANCE</span>}
      {renderDraftingStudioHighlightedText(paragraph, template)}
    </div>
  }

  function draftingStudioV273TableNode(block, template) {
    const total = (block.grid_columns || []).reduce((sum, value) => sum + (Number(value) || 0), 0)
    return <table key={block.id} style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', margin: 0 }}>
      {!!total && <colgroup>{(block.grid_columns || []).map((value, index) => <col key={index} style={{ width: ((Number(value) || 0) / total * 100) + '%' }} />)}</colgroup>}
      <tbody>{(block.rows || []).map((row) => <tr key={row.id}>{(row.cells || []).map((cell) => <td key={cell.id} colSpan={cell.colspan || 1} style={{ border: block.bordered ? '1px solid ' + (block.border_color || '#808080') : 'none', verticalAlign: cell.vertical_align === 'center' ? 'middle' : cell.vertical_align === 'bottom' ? 'bottom' : 'top', padding: block.bordered ? '3px 5px' : '0 3px', boxSizing: 'border-box' }}>
        {(cell.paragraph_indices || []).map((index) => draftingStudioV273ParagraphNode(draftingStudioDocument?.paragraphs?.[index], template, cell.id + '-'))}
      </td>)}</tr>)}</tbody>
    </table>
  }

  function draftingStudioV273RenderBlocks(template) {
    const doc = draftingStudioDocument
    if (!doc) return null
    const blocks = Array.isArray(doc.blocks) && doc.blocks.length ? doc.blocks : (doc.paragraphs || []).map((paragraph) => ({ type: 'paragraph', id: 'legacy-' + paragraph.index, paragraph_index: paragraph.index }))
    return blocks.map((block) => block.type === 'table' ? draftingStudioV273TableNode(block, template) : draftingStudioV273ParagraphNode(doc.paragraphs?.[block.paragraph_index], template, block.id + '-'))
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
          code = code.slice(0, mapStart) + '            {draftingStudioV273RenderBlocks(template)}' + code.slice(mapEnd + '            })}'.length)
        }
      }

      return { code, map: null }
    }
  }
}
