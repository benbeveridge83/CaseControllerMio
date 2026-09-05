// Mio V271: preserve uploaded Word layout in Drafting Studio's visual preview.
// This patch is intentionally tolerant: if a future App.jsx moves a marker, the build
// still succeeds rather than taking Mio offline.
export default function mioV271DraftingFormatting() {
  return {
    name: 'mio-v271-drafting-format-preview',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('/src/App.jsx')) return null
      let code = source
      code = code.replace("const MIO_APP_VERSION = 'Mio V269'", "const MIO_APP_VERSION = 'Mio V271'")

      const parserMarker = '  async function draftingStudioParseTemplateFile(file) {'
      const parserAt = code.indexOf(parserMarker)
      if (parserAt >= 0 && !code.includes('function draftingStudioV271ParagraphFormat(')) {
        const helpers = `  function draftingStudioV271DirectChild(node, localName) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    return Array.from(node?.childNodes || []).find((child) => child?.nodeType === 1 && child.namespaceURI === ns && child.localName === localName) || null
  }

  function draftingStudioV271Attr(node, name, fallback = '') {
    if (!node) return fallback
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const value = node.getAttributeNS?.(ns, name) ?? node.getAttribute?.('w:' + name) ?? node.getAttribute?.(name)
    return value == null || value === '' ? fallback : value
  }

  function draftingStudioV271ParagraphFormat(paragraph) {
    const pPr = draftingStudioV271DirectChild(paragraph, 'pPr')
    const jc = draftingStudioV271DirectChild(pPr, 'jc')
    const ind = draftingStudioV271DirectChild(pPr, 'ind')
    const spacing = draftingStudioV271DirectChild(pPr, 'spacing')
    const value = (node, attr) => Number(draftingStudioV271Attr(node, attr, '0')) || 0
    return {
      alignment: draftingStudioV271Attr(jc, 'val', ''),
      indent_left_twips: value(ind, 'left'),
      indent_right_twips: value(ind, 'right'),
      first_line_twips: value(ind, 'firstLine'),
      hanging_twips: value(ind, 'hanging'),
      space_before_twips: value(spacing, 'before'),
      space_after_twips: value(spacing, 'after'),
      line_twips: value(spacing, 'line'),
      line_rule: draftingStudioV271Attr(spacing, 'lineRule', '')
    }
  }

  function draftingStudioV271RunFormat(paragraph) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const runs = Array.from(paragraph?.getElementsByTagNameNS?.(ns, 'r') || [])
    const run = runs.find((item) => Array.from(item.getElementsByTagNameNS(ns, 't')).some((node) => String(node.textContent || '').trim())) || runs[0]
    const rPr = draftingStudioV271DirectChild(run, 'rPr')
    const size = draftingStudioV271DirectChild(rPr, 'sz')
    const fonts = draftingStudioV271DirectChild(rPr, 'rFonts')
    const bold = draftingStudioV271DirectChild(rPr, 'b')
    const italic = draftingStudioV271DirectChild(rPr, 'i')
    const underline = draftingStudioV271DirectChild(rPr, 'u')
    const on = (node) => node && !['0','false','off','none'].includes(String(draftingStudioV271Attr(node, 'val', 'true')).toLowerCase())
    return {
      font_family: draftingStudioV271Attr(fonts, 'ascii', '') || draftingStudioV271Attr(fonts, 'hAnsi', ''),
      font_size_half_points: Number(draftingStudioV271Attr(size, 'val', '0')) || 0,
      bold: on(bold), italic: on(italic), underline: on(underline)
    }
  }

  function draftingStudioV271BuildBlocks(doc, paragraphNodes) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const body = doc.getElementsByTagNameNS(ns, 'body')[0]
    if (!body) return []
    const indexByNode = new Map((paragraphNodes || []).map((node, index) => [node, index]))
    return Array.from(body.childNodes || []).filter((node) => node?.nodeType === 1 && ['p','tbl'].includes(node.localName)).map((node, blockIndex) => {
      if (node.localName === 'p') return { type: 'paragraph', id: 'p-' + blockIndex, paragraph_index: indexByNode.get(node) }
      const tblPr = draftingStudioV271DirectChild(node, 'tblPr')
      const tblGrid = draftingStudioV271DirectChild(node, 'tblGrid')
      const grid = Array.from(tblGrid?.childNodes || []).filter((child) => child?.nodeType === 1 && child.localName === 'gridCol').map((col) => Number(draftingStudioV271Attr(col, 'w', '0')) || 0)
      const borders = draftingStudioV271DirectChild(tblPr, 'tblBorders')
      const bordered = Array.from(borders?.childNodes || []).some((border) => border?.nodeType === 1 && !['nil','none','0','false'].includes(String(draftingStudioV271Attr(border, 'val', '')).toLowerCase()))
      const rows = Array.from(node.childNodes || []).filter((child) => child?.nodeType === 1 && child.localName === 'tr').map((row, rowIndex) => ({
        id: 'r-' + blockIndex + '-' + rowIndex,
        cells: Array.from(row.childNodes || []).filter((child) => child?.nodeType === 1 && child.localName === 'tc').map((cell, cellIndex) => {
          const tcPr = draftingStudioV271DirectChild(cell, 'tcPr')
          const gridSpan = draftingStudioV271DirectChild(tcPr, 'gridSpan')
          const vAlign = draftingStudioV271DirectChild(tcPr, 'vAlign')
          return {
            id: 'c-' + blockIndex + '-' + rowIndex + '-' + cellIndex,
            colspan: Math.max(1, Number(draftingStudioV271Attr(gridSpan, 'val', '1')) || 1),
            vertical_align: draftingStudioV271Attr(vAlign, 'val', 'top'),
            paragraph_indices: Array.from(cell.getElementsByTagNameNS(ns, 'p')).map((p) => indexByNode.get(p)).filter((value) => Number.isFinite(value))
          }
        })
      }))
      return { type: 'table', id: 'tbl-' + blockIndex, grid_columns: grid, bordered, rows }
    })
  }

  function draftingStudioV271PageLayout(doc) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const sectPr = doc.getElementsByTagNameNS(ns, 'sectPr')[0]
    const pgSz = draftingStudioV271DirectChild(sectPr, 'pgSz')
    const pgMar = draftingStudioV271DirectChild(sectPr, 'pgMar')
    return {
      width_twips: Number(draftingStudioV271Attr(pgSz, 'w', '12240')) || 12240,
      height_twips: Number(draftingStudioV271Attr(pgSz, 'h', '15840')) || 15840,
      margin_top_twips: Number(draftingStudioV271Attr(pgMar, 'top', '1080')) || 1080,
      margin_right_twips: Number(draftingStudioV271Attr(pgMar, 'right', '1440')) || 1440,
      margin_bottom_twips: Number(draftingStudioV271Attr(pgMar, 'bottom', '1080')) || 1080,
      margin_left_twips: Number(draftingStudioV271Attr(pgMar, 'left', '1440')) || 1440
    }
  }

`
        code = code.slice(0, parserAt) + helpers + code.slice(parserAt)
      }

      // Only touch the Drafting Studio parser region, so identical snippets elsewhere are safe.
      const parserStart = code.indexOf(parserMarker)
      const parserEndMarker = '  async function draftingStudioCreateTemplateFromUpload(file) {'
      const parserEnd = parserStart >= 0 ? code.indexOf(parserEndMarker, parserStart) : -1
      if (parserStart >= 0 && parserEnd > parserStart) {
        let region = code.slice(parserStart, parserEnd)
        if (!region.includes('format: draftingStudioV271ParagraphFormat(paragraph)')) {
          region = region.replace(
            "return { index, text, normalized, style_id: styleId, style_name: styleName, hidden, bold, is_heading: isHeading, bracket_placeholders, form_references, section_name: '' }",
            "return { index, text, normalized, style_id: styleId, style_name: styleName, hidden, bold, is_heading: isHeading, bracket_placeholders, form_references, section_name: '', format: draftingStudioV271ParagraphFormat(paragraph), run_format: draftingStudioV271RunFormat(paragraph), list_label: '' }"
          )
          region = region.replace(
            '    const sections = []',
            `    let listCounter = 0
    paragraphs.forEach((paragraph) => {
      if (/list\\s*number/i.test(paragraph.style_name || '')) paragraph.list_label = String(++listCounter) + '.'
      else if (paragraph.normalized) listCounter = 0
    })
    const blocks = draftingStudioV271BuildBlocks(doc, paragraphNodes)
    const pageLayout = draftingStudioV271PageLayout(doc)
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
      if (visualAt >= 0 && !code.includes('function draftingStudioV271PreviewDocument(')) {
        const renderHelpers = `  function draftingStudioV271TwipsToInches(value) { return (Number(value) || 0) / 1440 }

  function draftingStudioV271ParagraphStyle(paragraph) {
    const format = paragraph?.format || {}
    const run = paragraph?.run_format || {}
    const align = String(format.alignment || '').toLowerCase()
    const textAlign = ['both','distribute'].includes(align) ? 'justify' : ['center'].includes(align) ? 'center' : ['right','end'].includes(align) ? 'right' : 'left'
    const left = draftingStudioV271TwipsToInches(format.indent_left_twips)
    const right = draftingStudioV271TwipsToInches(format.indent_right_twips)
    const first = draftingStudioV271TwipsToInches(format.first_line_twips)
    const hanging = draftingStudioV271TwipsToInches(format.hanging_twips)
    return {
      minHeight: paragraph?.text ? 14 : 7,
      marginTop: ((Number(format.space_before_twips) || 0) / 20) + 'pt',
      marginBottom: ((Number(format.space_after_twips) || 0) / 20) + 'pt',
      marginLeft: left ? left + 'in' : 0,
      marginRight: right ? right + 'in' : 0,
      textIndent: first ? first + 'in' : hanging ? (-hanging) + 'in' : 0,
      textAlign,
      fontFamily: run.font_family || 'Times New Roman,serif',
      fontSize: run.font_size_half_points ? (Number(run.font_size_half_points) / 2) + 'pt' : '10pt',
      fontWeight: run.bold || paragraph?.bold ? 700 : 400,
      fontStyle: run.italic ? 'italic' : 'normal',
      textDecoration: run.underline ? 'underline' : 'none',
      lineHeight: 1.08,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
      boxSizing: 'border-box'
    }
  }

  function draftingStudioV271PreviewParagraph(paragraph, template, keyPrefix = '') {
    if (!paragraph || (!draftingShowHiddenManualText && paragraph.hidden)) return null
    const selected = draftingStudioSelection && paragraph.index >= draftingStudioSelection.paragraph_start && paragraph.index <= draftingStudioSelection.paragraph_end
    const base = draftingStudioV271ParagraphStyle(paragraph)
    return <div id={`drafting-paragraph-${paragraph.index}`} data-drafting-paragraph-index={paragraph.index} key={keyPrefix + paragraph.index} onMouseUp={(event) => draftingStudioCaptureSelection(event, paragraph.index)} style={{ ...base, background: selected ? '#dbeafe' : 'transparent', outline: selected ? '2px solid #60a5fa' : 'none', opacity: paragraph.hidden ? .72 : 1, scrollMarginTop: 10 }}>
      {paragraph.list_label && <span aria-hidden="true" style={{ display: 'inline-block', width: '.34in', marginLeft: '-.34in', textIndent: 0, userSelect: 'none' }}>{paragraph.list_label}</span>}
      {paragraph.hidden && <span style={{ fontFamily: 'Arial', fontSize: 9, background: '#ede9fe', color: '#6d28d9', borderRadius: 999, padding: '2px 5px', marginRight: 6 }}>GUIDANCE</span>}
      {renderDraftingStudioHighlightedText(paragraph, template)}
    </div>
  }

  function draftingStudioV271PreviewTable(block, template) {
    const total = (block.grid_columns || []).reduce((sum, value) => sum + (Number(value) || 0), 0)
    return <table key={block.id} style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', margin: 0 }}>
      {!!total && <colgroup>{(block.grid_columns || []).map((value, index) => <col key={index} style={{ width: ((Number(value) || 0) / total * 100) + '%' }} />)}</colgroup>}
      <tbody>{(block.rows || []).map((row) => <tr key={row.id}>{(row.cells || []).map((cell) => <td key={cell.id} colSpan={cell.colspan || 1} style={{ border: block.bordered ? '1px solid #808080' : 'none', verticalAlign: cell.vertical_align === 'center' ? 'middle' : cell.vertical_align === 'bottom' ? 'bottom' : 'top', padding: block.bordered ? '3px 5px' : '0 3px' }}>
        {(cell.paragraph_indices || []).map((index) => draftingStudioV271PreviewParagraph(draftingStudioDocument?.paragraphs?.[index], template, cell.id + '-'))}
      </td>)}</tr>)}</tbody>
    </table>
  }

  function draftingStudioV271PreviewDocument(template) {
    const doc = draftingStudioDocument
    if (!doc) return null
    const blocks = Array.isArray(doc.blocks) && doc.blocks.length ? doc.blocks : (doc.paragraphs || []).map((paragraph) => ({ type: 'paragraph', id: 'legacy-' + paragraph.index, paragraph_index: paragraph.index }))
    return blocks.map((block) => block.type === 'table' ? draftingStudioV271PreviewTable(block, template) : draftingStudioV271PreviewParagraph(doc.paragraphs?.[block.paragraph_index], template, block.id + '-'))
  }

  function draftingStudioV271PageStyle() {
    const layout = draftingStudioDocument?.page_layout || {}
    const inch = draftingStudioV271TwipsToInches
    return {
      width: `min(${inch(layout.width_twips || 12240)}in,100%)`,
      minHeight: inch(layout.height_twips || 15840) + 'in',
      margin: '0 auto', background: '#fff', boxShadow: '0 8px 30px rgba(15,23,42,.18)',
      padding: inch(layout.margin_top_twips || 1080) + 'in ' + inch(layout.margin_right_twips || 1440) + 'in ' + inch(layout.margin_bottom_twips || 1080) + 'in ' + inch(layout.margin_left_twips || 1440) + 'in',
      boxSizing: 'border-box', fontFamily: 'Times New Roman,serif', fontSize: '10pt', lineHeight: 1.08
    }
  }

`
        code = code.slice(0, visualAt) + renderHelpers + code.slice(visualAt)
      }

      // Replace only the old paper preview inside the visual builder. If its markup changes later,
      // leave it alone rather than failing the whole production build.
      const builderAt = code.indexOf(visualMarker)
      if (builderAt >= 0) {
        const paperStart = code.indexOf("          <div style={{ width: 'min(8.5in,100%)'", builderAt)
        const mainEnd = paperStart >= 0 ? code.indexOf('        </main>', paperStart) : -1
        if (paperStart >= 0 && mainEnd > paperStart) {
          const paperEnd = code.lastIndexOf('          </div>', mainEnd)
          if (paperEnd > paperStart) {
            const replacement = `          <div style={draftingStudioV271PageStyle()}>
            {draftingStudioV271PreviewDocument(template)}
          </div>`
            code = code.slice(0, paperStart) + replacement + code.slice(paperEnd + '          </div>'.length)
          }
        }
      }

      return { code, map: null }
    }
  }
}
