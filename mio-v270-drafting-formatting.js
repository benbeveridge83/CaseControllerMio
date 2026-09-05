// Mio V270 build-time patch: preserve Word template formatting in Drafting Studio.
// The generated .docx already uses the uploaded Word package as its base; this patch
// makes the visual template builder honor the same OOXML layout instead of flattening
// every paragraph into a left-aligned HTML div.
function replaceRequired(code, search, replacement, label) {
  if (!code.includes(search)) throw new Error(`Mio V270 drafting-format patch could not find ${label}`)
  return code.replace(search, replacement)
}

function insertBeforeRequired(code, marker, insertion, label) {
  if (!code.includes(marker)) throw new Error(`Mio V270 drafting-format patch could not find ${label}`)
  return code.replace(marker, `${insertion}\n\n${marker}`)
}

export default function mioV270DraftingFormatting() {
  return {
    name: 'mio-v270-drafting-word-format-preservation',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('/src/App.jsx')) return null
      let code = source

      code = replaceRequired(
        code,
        "const MIO_APP_VERSION = 'Mio V269'",
        "const MIO_APP_VERSION = 'Mio V270'",
        'V269 version constant'
      )

      code = replaceRequired(
        code,
        `  function draftingStudioParagraphText(paragraph) {
    if (!paragraph) return ''
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const textNodes = Array.from(paragraph.getElementsByTagNameNS(wordNamespace, 't'))
    if (!textNodes.length) return paragraph.textContent || ''
    return textNodes.map((node) => node.textContent || '').join('')
  }`,
        `  function draftingStudioParagraphText(paragraph) {
    if (!paragraph) return ''
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const pieces = []
    const walk = (node) => {
      if (!node) return
      if (node.nodeType === 3) return
      if (node.namespaceURI === wordNamespace) {
        if (['t', 'instrText', 'delText'].includes(node.localName)) { pieces.push(node.textContent || ''); return }
        if (node.localName === 'tab') { pieces.push('\t'); return }
        if (['br', 'cr'].includes(node.localName)) { pieces.push('\n'); return }
        if (node.localName === 'noBreakHyphen') { pieces.push('‑'); return }
        if (node.localName === 'softHyphen') { pieces.push('­'); return }
      }
      Array.from(node.childNodes || []).forEach(walk)
    }
    walk(paragraph)
    return pieces.length ? pieces.join('') : (paragraph.textContent || '')
  }`,
        'paragraph text extractor'
      )

      const parserHelpers = `  function draftingStudioDirectWordChild(node, localName) {
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    return Array.from(node?.childNodes || []).find((child) => child?.nodeType === 1 && child.namespaceURI === wordNamespace && child.localName === localName) || null
  }

  function draftingStudioDirectWordChildren(node, localName) {
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    return Array.from(node?.childNodes || []).filter((child) => child?.nodeType === 1 && child.namespaceURI === wordNamespace && (!localName || child.localName === localName))
  }

  function draftingStudioWordAttr(node, name, fallback = '') {
    if (!node) return fallback
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const value = node.getAttributeNS?.(wordNamespace, name) ?? node.getAttribute?.('w:' + name) ?? node.getAttribute?.(name)
    return value == null || value === '' ? fallback : value
  }

  function draftingStudioWordOnOff(node) {
    if (!node) return undefined
    const value = String(draftingStudioWordAttr(node, 'val', 'true')).toLowerCase()
    return !['0', 'false', 'off', 'none'].includes(value)
  }

  function draftingStudioReadRunFormat(rPr) {
    if (!rPr) return {}
    const rFonts = draftingStudioDirectWordChild(rPr, 'rFonts')
    const sz = draftingStudioDirectWordChild(rPr, 'sz')
    const color = draftingStudioDirectWordChild(rPr, 'color')
    const highlight = draftingStudioDirectWordChild(rPr, 'highlight')
    const underline = draftingStudioDirectWordChild(rPr, 'u')
    const fontFamily = draftingStudioWordAttr(rFonts, 'ascii', '') || draftingStudioWordAttr(rFonts, 'hAnsi', '') || draftingStudioWordAttr(rFonts, 'eastAsia', '')
    return {
      ...(fontFamily ? { font_family: fontFamily } : {}),
      ...(draftingStudioWordAttr(sz, 'val', '') ? { font_size_half_points: Number(draftingStudioWordAttr(sz, 'val', '')) || 0 } : {}),
      ...(draftingStudioDirectWordChild(rPr, 'b') ? { bold: draftingStudioWordOnOff(draftingStudioDirectWordChild(rPr, 'b')) } : {}),
      ...(draftingStudioDirectWordChild(rPr, 'i') ? { italic: draftingStudioWordOnOff(draftingStudioDirectWordChild(rPr, 'i')) } : {}),
      ...(underline ? { underline: !['none', '0', 'false'].includes(String(draftingStudioWordAttr(underline, 'val', 'single')).toLowerCase()) } : {}),
      ...(draftingStudioDirectWordChild(rPr, 'smallCaps') ? { small_caps: draftingStudioWordOnOff(draftingStudioDirectWordChild(rPr, 'smallCaps')) } : {}),
      ...(draftingStudioWordAttr(color, 'val', '') && !['auto', '000000'].includes(String(draftingStudioWordAttr(color, 'val', '')).toLowerCase()) ? { color: '#' + draftingStudioWordAttr(color, 'val', '') } : {}),
      ...(draftingStudioWordAttr(highlight, 'val', '') ? { highlight: draftingStudioWordAttr(highlight, 'val', '') } : {})
    }
  }

  function draftingStudioReadParagraphFormat(pPr) {
    if (!pPr) return {}
    const jc = draftingStudioDirectWordChild(pPr, 'jc')
    const ind = draftingStudioDirectWordChild(pPr, 'ind')
    const spacing = draftingStudioDirectWordChild(pPr, 'spacing')
    const numPr = draftingStudioDirectWordChild(pPr, 'numPr')
    const numId = draftingStudioDirectWordChild(numPr, 'numId')
    const ilvl = draftingStudioDirectWordChild(numPr, 'ilvl')
    const shd = draftingStudioDirectWordChild(pPr, 'shd')
    const result = {}
    const assignNumber = (key, node, attr) => {
      const raw = draftingStudioWordAttr(node, attr, '')
      if (raw !== '') result[key] = Number(raw) || 0
    }
    if (jc) result.alignment = draftingStudioWordAttr(jc, 'val', '')
    assignNumber('indent_left_twips', ind, 'left')
    assignNumber('indent_right_twips', ind, 'right')
    assignNumber('first_line_twips', ind, 'firstLine')
    assignNumber('hanging_twips', ind, 'hanging')
    assignNumber('space_before_twips', spacing, 'before')
    assignNumber('space_after_twips', spacing, 'after')
    assignNumber('line_twips', spacing, 'line')
    if (spacing && draftingStudioWordAttr(spacing, 'lineRule', '')) result.line_rule = draftingStudioWordAttr(spacing, 'lineRule', '')
    if (numId && draftingStudioWordAttr(numId, 'val', '') !== '') result.num_id = draftingStudioWordAttr(numId, 'val', '')
    if (ilvl && draftingStudioWordAttr(ilvl, 'val', '') !== '') result.num_level = Number(draftingStudioWordAttr(ilvl, 'val', '0')) || 0
    if (draftingStudioDirectWordChild(pPr, 'keepNext')) result.keep_next = draftingStudioWordOnOff(draftingStudioDirectWordChild(pPr, 'keepNext'))
    if (draftingStudioDirectWordChild(pPr, 'pageBreakBefore')) result.page_break_before = draftingStudioWordOnOff(draftingStudioDirectWordChild(pPr, 'pageBreakBefore'))
    if (shd && draftingStudioWordAttr(shd, 'fill', '') && draftingStudioWordAttr(shd, 'fill', '').toLowerCase() !== 'auto') result.background = '#' + draftingStudioWordAttr(shd, 'fill', '')
    return result
  }

  function draftingStudioMergeWordFormat(...formats) {
    return Object.assign({}, ...formats.filter((format) => format && typeof format === 'object'))
  }

  function draftingStudioRoman(value) {
    let number = Math.max(1, Number(value) || 1)
    const pairs = [['M',1000],['CM',900],['D',500],['CD',400],['C',100],['XC',90],['L',50],['XL',40],['X',10],['IX',9],['V',5],['IV',4],['I',1]]
    let output = ''
    pairs.forEach(([letter, amount]) => { while (number >= amount) { output += letter; number -= amount } })
    return output
  }

  function draftingStudioAlpha(value) {
    let number = Math.max(1, Number(value) || 1)
    let output = ''
    while (number > 0) { number -= 1; output = String.fromCharCode(65 + (number % 26)) + output; number = Math.floor(number / 26) }
    return output
  }

  function draftingStudioFormatListValue(value, format) {
    if (format === 'lowerLetter') return draftingStudioAlpha(value).toLowerCase()
    if (format === 'upperLetter') return draftingStudioAlpha(value)
    if (format === 'lowerRoman') return draftingStudioRoman(value).toLowerCase()
    if (format === 'upperRoman') return draftingStudioRoman(value)
    return String(value)
  }

  function draftingStudioNumberingDefinitions(numberingXml, parser) {
    if (!numberingXml) return { numToAbstract: {}, levels: {} }
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const numberingDoc = parser.parseFromString(numberingXml, 'application/xml')
    if (numberingDoc.getElementsByTagName('parsererror').length) return { numToAbstract: {}, levels: {} }
    const numToAbstract = {}
    Array.from(numberingDoc.getElementsByTagNameNS(wordNamespace, 'num')).forEach((num) => {
      const numId = draftingStudioWordAttr(num, 'numId', '')
      const abstractIdNode = draftingStudioDirectWordChild(num, 'abstractNumId')
      if (numId) numToAbstract[numId] = draftingStudioWordAttr(abstractIdNode, 'val', '')
    })
    const levels = {}
    Array.from(numberingDoc.getElementsByTagNameNS(wordNamespace, 'abstractNum')).forEach((abstractNum) => {
      const abstractId = draftingStudioWordAttr(abstractNum, 'abstractNumId', '')
      if (!abstractId) return
      levels[abstractId] = {}
      draftingStudioDirectWordChildren(abstractNum, 'lvl').forEach((lvl) => {
        const level = Number(draftingStudioWordAttr(lvl, 'ilvl', '0')) || 0
        const numFmt = draftingStudioDirectWordChild(lvl, 'numFmt')
        const lvlText = draftingStudioDirectWordChild(lvl, 'lvlText')
        const start = draftingStudioDirectWordChild(lvl, 'start')
        const pPr = draftingStudioDirectWordChild(lvl, 'pPr')
        levels[abstractId][level] = {
          format: draftingStudioWordAttr(numFmt, 'val', 'decimal'),
          text: draftingStudioWordAttr(lvlText, 'val', '%' + (level + 1) + '.'),
          start: Number(draftingStudioWordAttr(start, 'val', '1')) || 1,
          paragraph_format: draftingStudioReadParagraphFormat(pPr)
        }
      })
    })
    return { numToAbstract, levels }
  }

  function draftingStudioApplyListLabels(paragraphs, numbering) {
    const counters = {}
    ;(paragraphs || []).forEach((paragraph) => {
      const numId = paragraph?.format?.num_id
      if (!numId) return
      const abstractId = numbering?.numToAbstract?.[numId]
      const level = Math.max(0, Number(paragraph?.format?.num_level || 0))
      const definition = numbering?.levels?.[abstractId]?.[level]
      if (!definition) return
      if (!counters[numId]) counters[numId] = []
      const levels = counters[numId]
      if (!Number.isFinite(levels[level])) levels[level] = (definition.start || 1) - 1
      levels[level] += 1
      levels.splice(level + 1)
      if (definition.format === 'bullet') {
        paragraph.list_label = definition.text || '•'
        return
      }
      let label = definition.text || '%' + (level + 1) + '.'
      label = label.replace(/%([1-9])/g, (_, rawLevel) => {
        const targetLevel = Math.max(0, Number(rawLevel) - 1)
        const targetDef = numbering?.levels?.[abstractId]?.[targetLevel] || definition
        const value = Number.isFinite(levels[targetLevel]) ? levels[targetLevel] : (targetDef.start || 1)
        return draftingStudioFormatListValue(value, targetDef.format)
      })
      paragraph.list_label = label
    })
  }

  function draftingStudioTableBorderInfo(tblPr) {
    const borders = draftingStudioDirectWordChild(tblPr, 'tblBorders')
    if (!borders) return { bordered: false, color: '#808080' }
    const names = ['top','left','bottom','right','insideH','insideV']
    const present = names.map((name) => draftingStudioDirectWordChild(borders, name)).filter(Boolean)
    const bordered = present.some((border) => !['nil','none','0','false'].includes(String(draftingStudioWordAttr(border, 'val', '')).toLowerCase()))
    const colorNode = present.find((border) => draftingStudioWordAttr(border, 'color', ''))
    const rawColor = draftingStudioWordAttr(colorNode, 'color', '808080')
    return { bordered, color: rawColor && rawColor.toLowerCase() !== 'auto' ? '#' + rawColor : '#808080' }
  }

  function draftingStudioBuildDocumentBlocks(doc, paragraphNodes) {
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const paragraphIndexByNode = new Map((paragraphNodes || []).map((node, index) => [node, index]))
    const body = doc.getElementsByTagNameNS(wordNamespace, 'body')[0]
    if (!body) return []
    return draftingStudioDirectWordChildren(body).filter((node) => ['p','tbl'].includes(node.localName)).map((node, blockIndex) => {
      if (node.localName === 'p') return { type: 'paragraph', id: 'p-' + blockIndex, paragraph_index: paragraphIndexByNode.get(node) }
      const tblPr = draftingStudioDirectWordChild(node, 'tblPr')
      const grid = draftingStudioDirectWordChild(node, 'tblGrid')
      const gridColumns = draftingStudioDirectWordChildren(grid, 'gridCol').map((column) => Number(draftingStudioWordAttr(column, 'w', '0')) || 0)
      const borderInfo = draftingStudioTableBorderInfo(tblPr)
      const tableWidth = draftingStudioDirectWordChild(tblPr, 'tblW')
      const tableJc = draftingStudioDirectWordChild(tblPr, 'jc')
      const rows = draftingStudioDirectWordChildren(node, 'tr').map((row, rowIndex) => ({
        id: 'row-' + blockIndex + '-' + rowIndex,
        cells: draftingStudioDirectWordChildren(row, 'tc').map((cell, cellIndex) => {
          const tcPr = draftingStudioDirectWordChild(cell, 'tcPr')
          const tcW = draftingStudioDirectWordChild(tcPr, 'tcW')
          const gridSpan = draftingStudioDirectWordChild(tcPr, 'gridSpan')
          const vAlign = draftingStudioDirectWordChild(tcPr, 'vAlign')
          const shd = draftingStudioDirectWordChild(tcPr, 'shd')
          const indices = Array.from(cell.getElementsByTagNameNS(wordNamespace, 'p')).map((paragraph) => paragraphIndexByNode.get(paragraph)).filter((value) => Number.isFinite(value))
          return {
            id: 'cell-' + blockIndex + '-' + rowIndex + '-' + cellIndex,
            paragraph_indices: indices,
            width_twips: Number(draftingStudioWordAttr(tcW, 'w', '0')) || 0,
            colspan: Math.max(1, Number(draftingStudioWordAttr(gridSpan, 'val', '1')) || 1),
            vertical_align: draftingStudioWordAttr(vAlign, 'val', 'top'),
            background: draftingStudioWordAttr(shd, 'fill', '') && draftingStudioWordAttr(shd, 'fill', '').toLowerCase() !== 'auto' ? '#' + draftingStudioWordAttr(shd, 'fill', '') : ''
          }
        })
      }))
      return {
        type: 'table', id: 'tbl-' + blockIndex, rows, grid_columns: gridColumns,
        width_twips: Number(draftingStudioWordAttr(tableWidth, 'w', '0')) || 0,
        width_type: draftingStudioWordAttr(tableWidth, 'type', 'auto'),
        alignment: draftingStudioWordAttr(tableJc, 'val', 'left'),
        bordered: borderInfo.bordered, border_color: borderInfo.color
      }
    })
  }

  function draftingStudioPageLayout(doc) {
    const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const body = doc.getElementsByTagNameNS(wordNamespace, 'body')[0]
    const sectPr = draftingStudioDirectWordChild(body, 'sectPr') || doc.getElementsByTagNameNS(wordNamespace, 'sectPr')[0]
    const pgSz = draftingStudioDirectWordChild(sectPr, 'pgSz')
    const pgMar = draftingStudioDirectWordChild(sectPr, 'pgMar')
    return {
      width_twips: Number(draftingStudioWordAttr(pgSz, 'w', '12240')) || 12240,
      height_twips: Number(draftingStudioWordAttr(pgSz, 'h', '15840')) || 15840,
      margin_top_twips: Number(draftingStudioWordAttr(pgMar, 'top', '1080')) || 1080,
      margin_right_twips: Number(draftingStudioWordAttr(pgMar, 'right', '1440')) || 1440,
      margin_bottom_twips: Number(draftingStudioWordAttr(pgMar, 'bottom', '1080')) || 1080,
      margin_left_twips: Number(draftingStudioWordAttr(pgMar, 'left', '1440')) || 1440
    }
  }`

      code = insertBeforeRequired(code, '  async function draftingStudioParseTemplateFile(file) {', parserHelpers, 'drafting template parser')

      code = replaceRequired(
        code,
        `    const [documentXml, stylesXml] = await Promise.all([
      documentEntry.async('string'),
      zip.file('word/styles.xml') ? zip.file('word/styles.xml').async('string') : Promise.resolve('')
    ])`,
        `    const [documentXml, stylesXml, numberingXml] = await Promise.all([
      documentEntry.async('string'),
      zip.file('word/styles.xml') ? zip.file('word/styles.xml').async('string') : Promise.resolve(''),
      zip.file('word/numbering.xml') ? zip.file('word/numbering.xml').async('string') : Promise.resolve('')
    ])`,
        'Word XML load set'
      )

      code = replaceRequired(
        code,
        `    const styleNames = {}
    if (stylesXml) {`,
        `    const styleNames = {}
    const styleParagraphFormats = {}
    const styleRunFormats = {}
    const styleParents = {}
    let defaultRunFormat = {}
    if (stylesXml) {`,
        'style maps'
      )

      code = replaceRequired(
        code,
        `      const stylesDoc = parser.parseFromString(stylesXml, 'application/xml')
      Array.from(stylesDoc.getElementsByTagNameNS(wordNamespace, 'style')).forEach((style) => {`,
        `      const stylesDoc = parser.parseFromString(stylesXml, 'application/xml')
      const docDefaults = stylesDoc.getElementsByTagNameNS(wordNamespace, 'docDefaults')[0]
      const rPrDefault = docDefaults?.getElementsByTagNameNS(wordNamespace, 'rPrDefault')?.[0]
      defaultRunFormat = draftingStudioReadRunFormat(rPrDefault?.getElementsByTagNameNS(wordNamespace, 'rPr')?.[0])
      Array.from(stylesDoc.getElementsByTagNameNS(wordNamespace, 'style')).forEach((style) => {`,
        'style defaults'
      )

      code = replaceRequired(
        code,
        `        const name = nameNode?.getAttributeNS(wordNamespace, 'val') || nameNode?.getAttribute('w:val') || id
        if (id) styleNames[id] = name`,
        `        const name = nameNode?.getAttributeNS(wordNamespace, 'val') || nameNode?.getAttribute('w:val') || id
        if (id) {
          styleNames[id] = name
          const basedOn = draftingStudioDirectWordChild(style, 'basedOn')
          styleParents[id] = draftingStudioWordAttr(basedOn, 'val', '')
          styleParagraphFormats[id] = draftingStudioReadParagraphFormat(draftingStudioDirectWordChild(style, 'pPr'))
          styleRunFormats[id] = draftingStudioReadRunFormat(draftingStudioDirectWordChild(style, 'rPr'))
        }`,
        'style metadata extraction'
      )

      code = replaceRequired(
        code,
        `    const doc = parser.parseFromString(documentXml, 'application/xml')`,
        `    const resolvedStyleParagraphFormats = {}
    const resolvedStyleRunFormats = {}
    const resolveStyleFormats = (styleId, seen = new Set()) => {
      if (!styleId || seen.has(styleId)) return { paragraph: {}, run: {} }
      if (resolvedStyleParagraphFormats[styleId] || resolvedStyleRunFormats[styleId]) return { paragraph: resolvedStyleParagraphFormats[styleId] || {}, run: resolvedStyleRunFormats[styleId] || {} }
      const nextSeen = new Set(seen); nextSeen.add(styleId)
      const parent = resolveStyleFormats(styleParents[styleId], nextSeen)
      resolvedStyleParagraphFormats[styleId] = draftingStudioMergeWordFormat(parent.paragraph, styleParagraphFormats[styleId])
      resolvedStyleRunFormats[styleId] = draftingStudioMergeWordFormat(parent.run, styleRunFormats[styleId])
      return { paragraph: resolvedStyleParagraphFormats[styleId], run: resolvedStyleRunFormats[styleId] }
    }
    Object.keys(styleNames).forEach((styleId) => resolveStyleFormats(styleId))
    const numbering = draftingStudioNumberingDefinitions(numberingXml, parser)
    const doc = parser.parseFromString(documentXml, 'application/xml')`,
        'resolved style maps'
      )

      code = replaceRequired(
        code,
        `      const pStyle = paragraph.getElementsByTagNameNS(wordNamespace, 'pStyle')[0]
      const styleId = pStyle?.getAttributeNS(wordNamespace, 'val') || pStyle?.getAttribute('w:val') || ''
      const styleName = styleNames[styleId] || styleId || ''
      const runNodes = Array.from(paragraph.getElementsByTagNameNS(wordNamespace, 'r'))`,
        `      const pPr = draftingStudioDirectWordChild(paragraph, 'pPr')
      const pStyle = draftingStudioDirectWordChild(pPr, 'pStyle')
      const styleId = pStyle?.getAttributeNS(wordNamespace, 'val') || pStyle?.getAttribute('w:val') || ''
      const styleName = styleNames[styleId] || styleId || ''
      let paragraphFormat = draftingStudioMergeWordFormat(resolvedStyleParagraphFormats[styleId], draftingStudioReadParagraphFormat(pPr))
      const abstractId = numbering?.numToAbstract?.[paragraphFormat.num_id]
      const listLevelDefinition = numbering?.levels?.[abstractId]?.[Math.max(0, Number(paragraphFormat.num_level || 0))]
      if (listLevelDefinition?.paragraph_format) paragraphFormat = draftingStudioMergeWordFormat(listLevelDefinition.paragraph_format, paragraphFormat)
      const runNodes = Array.from(paragraph.getElementsByTagNameNS(wordNamespace, 'r'))`,
        'paragraph format extraction'
      )

      code = replaceRequired(
        code,
        `      const hidden = /hidden/i.test(styleName) || (hiddenRunCount > 0 && visibleRunCount === 0)
      const bold = runNodes.some((run) => run.getElementsByTagNameNS(wordNamespace, 'b').length > 0)
      const normalized = String(text || '').trim()`,
        `      const hidden = /hidden/i.test(styleName) || (hiddenRunCount > 0 && visibleRunCount === 0)
      const textRuns = runNodes.filter((run) => draftingStudioParagraphText(run).trim() && !run.getElementsByTagNameNS(wordNamespace, 'vanish').length)
      const bold = textRuns.length > 0 && textRuns.every((run) => draftingStudioWordOnOff(draftingStudioDirectWordChild(draftingStudioDirectWordChild(run, 'rPr'), 'b')) === true)
      const firstTextRun = textRuns[0] || runNodes[0]
      const runFormat = draftingStudioMergeWordFormat(defaultRunFormat, resolvedStyleRunFormats[styleId], draftingStudioReadRunFormat(draftingStudioDirectWordChild(firstTextRun, 'rPr')))
      const normalized = String(text || '').trim()`,
        'run format extraction'
      )

      code = replaceRequired(
        code,
        `      return { index, text, normalized, style_id: styleId, style_name: styleName, hidden, bold, is_heading: isHeading, bracket_placeholders, form_references, section_name: '' }
    })
    const sections = []`,
        `      return { index, text, normalized, style_id: styleId, style_name: styleName, hidden, bold, is_heading: isHeading, bracket_placeholders, form_references, section_name: '', format: paragraphFormat, run_format: runFormat, list_label: '' }
    })
    draftingStudioApplyListLabels(paragraphs, numbering)
    const blocks = draftingStudioBuildDocumentBlocks(doc, paragraphNodes)
    const pageLayout = draftingStudioPageLayout(doc)
    const sections = []`,
        'paragraph metadata and document blocks'
      )

      code = replaceRequired(
        code,
        `      paragraphs,
      sections,
      form_references: formReferences,`,
        `      paragraphs,
      blocks,
      page_layout: pageLayout,
      sections,
      form_references: formReferences,`,
        'parsed document return value'
      )

      const renderHelpers = `  function draftingStudioTwipsInches(value = 0) {
    return (Number(value) || 0) / 1440
  }

  function draftingStudioParagraphPreviewStyle(paragraph, { inTable = false } = {}) {
    const format = paragraph?.format || {}
    const run = paragraph?.run_format || {}
    const alignment = String(format.alignment || '').toLowerCase()
    const cssAlignment = alignment === 'both' || alignment === 'distribute' ? 'justify' : alignment === 'center' ? 'center' : alignment === 'right' || alignment === 'end' ? 'right' : 'left'
    const left = draftingStudioTwipsInches(format.indent_left_twips)
    const right = draftingStudioTwipsInches(format.indent_right_twips)
    const firstLine = draftingStudioTwipsInches(format.first_line_twips)
    const hanging = draftingStudioTwipsInches(format.hanging_twips)
    let lineHeight = 1.08
    if (format.line_twips) lineHeight = format.line_rule === 'auto' ? Math.max(.8, Number(format.line_twips) / 240) : (Number(format.line_twips) / 20) + 'pt'
    const style = {
      minHeight: paragraph?.text ? 14 : 7,
      marginTop: (Number(format.space_before_twips) || 0) / 20 + 'pt',
      marginBottom: (Number(format.space_after_twips) || 0) / 20 + 'pt',
      marginLeft: left ? left + 'in' : 0,
      marginRight: right ? right + 'in' : 0,
      textIndent: firstLine ? firstLine + 'in' : hanging ? (-hanging) + 'in' : 0,
      textAlign: cssAlignment,
      fontFamily: run.font_family || 'Times New Roman,serif',
      fontSize: run.font_size_half_points ? (Number(run.font_size_half_points) / 2) + 'pt' : '10pt',
      fontWeight: run.bold === true || paragraph?.bold ? 700 : 400,
      fontStyle: run.italic ? 'italic' : 'normal',
      textDecoration: run.underline ? 'underline' : 'none',
      fontVariant: run.small_caps ? 'small-caps' : 'normal',
      color: paragraph?.hidden ? '#7c3aed' : (run.color || '#111827'),
      background: format.background || 'transparent',
      whiteSpace: 'pre-wrap',
      tabSize: 8,
      lineHeight,
      boxSizing: 'border-box',
      overflowWrap: 'break-word'
    }
    if (inTable) {
      style.marginTop = style.marginTop || 0
      style.marginBottom = style.marginBottom || 0
    }
    return style
  }

  function draftingStudioPreviewParagraph(paragraph, template, { inTable = false, keyPrefix = '' } = {}) {
    if (!paragraph || (!draftingShowHiddenManualText && paragraph.hidden)) return null
    const selected = draftingStudioSelection && paragraph.index >= draftingStudioSelection.paragraph_start && paragraph.index <= draftingStudioSelection.paragraph_end
    const baseStyle = draftingStudioParagraphPreviewStyle(paragraph, { inTable })
    const listLabel = String(paragraph.list_label || '')
    return <div id={`drafting-paragraph-${paragraph.index}`} data-drafting-paragraph-index={paragraph.index} key={keyPrefix + paragraph.index} onMouseUp={(event) => draftingStudioCaptureSelection(event, paragraph.index)} style={{ ...baseStyle, position: 'relative', background: selected ? '#dbeafe' : baseStyle.background, outline: selected ? '2px solid #60a5fa' : 'none', opacity: paragraph.hidden ? .72 : 1, scrollMarginTop: 10 }}>
      {listLabel && <span aria-hidden="true" style={{ display: 'inline-block', width: '.34in', marginLeft: '-.34in', textIndent: 0, userSelect: 'none', WebkitUserSelect: 'none' }}>{listLabel}</span>}
      {paragraph.hidden && <span style={{ fontFamily: 'Arial', fontSize: 9, background: '#ede9fe', color: '#6d28d9', borderRadius: 999, padding: '2px 5px', marginRight: 6 }}>GUIDANCE</span>}
      {renderDraftingStudioHighlightedText(paragraph, template)}
    </div>
  }

  function draftingStudioPreviewTable(block, template) {
    const totalGrid = (block.grid_columns || []).reduce((sum, value) => sum + (Number(value) || 0), 0)
    return <table key={block.id} style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', margin: 0, border: 0 }}>
      {!!totalGrid && <colgroup>{(block.grid_columns || []).map((width, index) => <col key={index} style={{ width: ((Number(width) || 0) / totalGrid * 100) + '%' }} />)}</colgroup>}
      <tbody>{(block.rows || []).map((row) => <tr key={row.id}>{(row.cells || []).map((cell) => {
        const paragraphs = (cell.paragraph_indices || []).map((index) => draftingStudioDocument?.paragraphs?.[index]).filter((paragraph) => paragraph && (draftingShowHiddenManualText || !paragraph.hidden))
        return <td key={cell.id} colSpan={cell.colspan || 1} style={{ border: block.bordered ? '1px solid ' + (block.border_color || '#808080') : 'none', verticalAlign: cell.vertical_align === 'center' ? 'middle' : cell.vertical_align === 'bottom' ? 'bottom' : 'top', background: cell.background || 'transparent', padding: block.bordered ? '3px 5px' : '0 3px', boxSizing: 'border-box' }}>
          {paragraphs.length ? paragraphs.map((paragraph) => draftingStudioPreviewParagraph(paragraph, template, { inTable: true, keyPrefix: cell.id + '-' })) : <span>&nbsp;</span>}
        </td>
      })}</tr>)}</tbody>
    </table>
  }

  function draftingStudioPreviewDocument(template) {
    const document = draftingStudioDocument
    if (!document) return null
    const blocks = Array.isArray(document.blocks) && document.blocks.length ? document.blocks : (document.paragraphs || []).map((paragraph) => ({ type: 'paragraph', id: 'legacy-' + paragraph.index, paragraph_index: paragraph.index }))
    return blocks.map((block) => {
      if (block.type === 'table') return draftingStudioPreviewTable(block, template)
      return draftingStudioPreviewParagraph(document.paragraphs?.[block.paragraph_index], template, { keyPrefix: block.id + '-' })
    })
  }

  function draftingStudioPreviewPageStyle() {
    const layout = draftingStudioDocument?.page_layout || {}
    const width = draftingStudioTwipsInches(layout.width_twips || 12240)
    const height = draftingStudioTwipsInches(layout.height_twips || 15840)
    const top = draftingStudioTwipsInches(layout.margin_top_twips || 1080)
    const right = draftingStudioTwipsInches(layout.margin_right_twips || 1440)
    const bottom = draftingStudioTwipsInches(layout.margin_bottom_twips || 1080)
    const left = draftingStudioTwipsInches(layout.margin_left_twips || 1440)
    return { width: `min(${width}in,100%)`, minHeight: height + 'in', margin: '0 auto', background: '#fff', boxShadow: '0 8px 30px rgba(15,23,42,.18)', padding: top + 'in ' + right + 'in ' + bottom + 'in ' + left + 'in', boxSizing: 'border-box', fontFamily: 'Times New Roman,serif', fontSize: '10pt', lineHeight: 1.08 }
  }`

      code = insertBeforeRequired(code, '  function renderDraftingVisualBuilder() {', renderHelpers, 'visual builder renderer')

      code = replaceRequired(
        code,
        `          <div style={{ width: 'min(8.5in,100%)', minHeight: '11in', margin: '0 auto', background: '#fff', boxShadow: '0 8px 30px rgba(15,23,42,.18)', padding: '0.72in 0.78in', boxSizing: 'border-box', fontFamily: 'Times New Roman,serif', fontSize: 14, lineHeight: 1.35 }}>
            {visibleParagraphs.map((paragraph) => {
              const selected = draftingStudioSelection && paragraph.index >= draftingStudioSelection.paragraph_start && paragraph.index <= draftingStudioSelection.paragraph_end
              return <div id={`drafting-paragraph-${paragraph.index}`} data-drafting-paragraph-index={paragraph.index} key={paragraph.index} onMouseUp={(event) => draftingStudioCaptureSelection(event, paragraph.index)} style={{ minHeight: paragraph.text ? 20 : 10, marginBottom: paragraph.style_name === 'Title' ? 12 : 3, textAlign: paragraph.style_name === 'Title' ? 'center' : 'left', fontWeight: paragraph.is_heading || paragraph.style_name === 'Title' ? 700 : 400, fontSize: paragraph.style_name === 'Title' ? 18 : 14, color: paragraph.hidden ? '#7c3aed' : '#111827', background: selected ? '#dbeafe' : 'transparent', outline: selected ? '2px solid #60a5fa' : 'none', opacity: paragraph.hidden ? .72 : 1, whiteSpace: 'pre-wrap', scrollMarginTop: 10 }}>
                {paragraph.hidden && <span style={{ fontFamily: 'Arial', fontSize: 9, background: '#ede9fe', color: '#6d28d9', borderRadius: 999, padding: '2px 5px', marginRight: 6 }}>GUIDANCE</span>}{renderDraftingStudioHighlightedText(paragraph, template)}
              </div>
            })}
          </div>`,
        `          <div style={draftingStudioPreviewPageStyle()}>
            {draftingStudioPreviewDocument(template)}
          </div>`,
        'flattened left-aligned Word preview'
      )

      code = code.replace(
        'const visibleParagraphs = (draftingStudioDocument?.paragraphs || []).filter((paragraph) => draftingShowHiddenManualText || !paragraph.hidden)\n',
        ''
      )

      return { code, map: null }
    }
  }
}
