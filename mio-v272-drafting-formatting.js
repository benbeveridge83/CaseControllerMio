// Mio V272: preserve core Word paragraph formatting in Drafting Studio.
// Deliberately small and build-safe: it augments the existing preview instead of replacing it.
export default function mioV272DraftingFormatting() {
  return {
    name: 'mio-v272-drafting-paragraph-formatting',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('/src/App.jsx')) return null
      let code = source
      code = code.replace("const MIO_APP_VERSION = 'Mio V269'", "const MIO_APP_VERSION = 'Mio V272'")

      const parserStart = code.indexOf('  async function draftingStudioParseTemplateFile(file) {')
      const parserEnd = parserStart >= 0 ? code.indexOf('  async function draftingStudioCreateTemplateFromUpload(file) {', parserStart) : -1
      if (parserStart >= 0 && parserEnd > parserStart) {
        let region = code.slice(parserStart, parserEnd)
        const oldReturn = "return { index, text, normalized, style_id: styleId, style_name: styleName, hidden, bold, is_heading: isHeading, bracket_placeholders, form_references, section_name: '' }"
        if (region.includes(oldReturn)) {
          const formatCode = `      const paragraphProperties = paragraph.getElementsByTagNameNS(wordNamespace, 'pPr')[0]
      const alignmentNode = paragraphProperties?.getElementsByTagNameNS(wordNamespace, 'jc')?.[0]
      const indentNode = paragraphProperties?.getElementsByTagNameNS(wordNamespace, 'ind')?.[0]
      const spacingNode = paragraphProperties?.getElementsByTagNameNS(wordNamespace, 'spacing')?.[0]
      const wordAttr = (node, name) => node?.getAttributeNS?.(wordNamespace, name) || node?.getAttribute?.('w:' + name) || ''
      const wordNumber = (node, name) => Number(wordAttr(node, name)) || 0
`
          const anchor = "      const normalized = String(text || '').trim()"
          region = region.replace(anchor, formatCode + anchor)
          region = region.replace(oldReturn, "return { index, text, normalized, style_id: styleId, style_name: styleName, hidden, bold, is_heading: isHeading, bracket_placeholders, form_references, section_name: '', word_alignment: wordAttr(alignmentNode, 'val'), word_indent_left: wordNumber(indentNode, 'left'), word_indent_right: wordNumber(indentNode, 'right'), word_first_line: wordNumber(indentNode, 'firstLine'), word_hanging: wordNumber(indentNode, 'hanging'), word_space_before: wordNumber(spacingNode, 'before'), word_space_after: wordNumber(spacingNode, 'after') }")
        }
        code = code.slice(0, parserStart) + region + code.slice(parserEnd)
      }

      const oldStyle = "marginBottom: paragraph.style_name === 'Title' ? 12 : 3, textAlign: paragraph.style_name === 'Title' ? 'center' : 'left', fontWeight:"
      const newStyle = "marginTop: paragraph.word_space_before ? (paragraph.word_space_before / 20) + 'pt' : 0, marginBottom: paragraph.word_space_after ? (paragraph.word_space_after / 20) + 'pt' : (paragraph.style_name === 'Title' ? 12 : 3), marginLeft: paragraph.word_indent_left ? (paragraph.word_indent_left / 1440) + 'in' : 0, marginRight: paragraph.word_indent_right ? (paragraph.word_indent_right / 1440) + 'in' : 0, textIndent: paragraph.word_first_line ? (paragraph.word_first_line / 1440) + 'in' : (paragraph.word_hanging ? (-paragraph.word_hanging / 1440) + 'in' : 0), textAlign: paragraph.word_alignment === 'center' ? 'center' : (paragraph.word_alignment === 'right' || paragraph.word_alignment === 'end') ? 'right' : (paragraph.word_alignment === 'both' || paragraph.word_alignment === 'distribute') ? 'justify' : (paragraph.style_name === 'Title' ? 'center' : 'left'), fontWeight:"
      code = code.replace(oldStyle, newStyle)

      return { code, map: null }
    }
  }
}
