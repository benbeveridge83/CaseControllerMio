// File preparation helpers are kept separate from the dashboard so preservation
// and generated document behavior can be tested without loading client records.
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'

export const DEFAULT_RFP_COVER_SETTINGS = Object.freeze({ headingSize: 28, bodySize: 16, topInches: 1.8, bold: true, alignment: 'center', font: 'Times New Roman', showDocumentName: true, showType: true, showSize: true })
export const rfpFileName = doc => doc.file_name || doc.original_file_name || doc.name || 'Document'
export const rfpPdfName = name => `${String(name || 'Document').replace(/\.[a-z0-9]{1,10}$/i, '')}.pdf`
export function rfpConversionKind(doc) {
  const name = rfpFileName(doc), mime = doc.file_type || doc.mime_type || ''
  if (/\.pdf$/i.test(name) || /application\/pdf/i.test(mime)) return 'pdf'
  if (doc.rfp_cover_sheet) return 'cover'
  if (/^(audio|video)\//i.test(mime) || /\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff?|opus|mp4|mov|avi|wmv|mkv|webm|m4v|mpeg|mpg)$/i.test(name)) return 'media'
  if (/\.(png|jpe?g|webp|bmp)$/i.test(name) || /^image\/(png|jpeg|webp|bmp)$/i.test(mime)) return 'image'
  if (/\.(docx|txt|html?|csv|xlsx?)$/i.test(name) || /^text\/(plain|csv|html)/i.test(mime)) return 'text'
  return 'unsupported'
}

function storedReference(doc) {
  const copy = { ...doc }
  for (const key of ['file_data', 'file_data_url', 'file_url', 'content_url', 'file', 'blob', 'pdf_conversion_source']) delete copy[key]
  return copy
}

export async function convertRfpDocuments(docs, { convert, upload, archive, onConverted = () => {}, onProgress = () => {} }) {
  const result = { converted: [], failed: [], skipped: [] }
  for (let index = 0; index < docs.length; index++) {
    const doc = docs[index], kind = rfpConversionKind(doc)
    onProgress({ completed: index, total: docs.length, name: rfpFileName(doc) })
    if (['pdf', 'media', 'unsupported'].includes(kind)) {
      result.skipped.push({ doc, reason: kind === 'pdf' ? 'Already PDF' : 'Use Create cover sheets for this file type' })
    } else {
      try {
        const bytes = await convert(doc)
        const source = doc.pdf_conversion_source || storedReference(await archive(doc))
        if (!source.file_path && !source.storage_path && !source.filePath && !source.path) throw new Error('Original could not be preserved. File was not changed.')
        const name = rfpPdfName(rfpFileName(doc))
        const stored = await upload(bytes, name, doc)
        if (!stored?.file_path) throw new Error('PDF upload failed. Original was not changed.')
        const updated = { ...storedReference(doc), ...stored, file_name: name, original_file_name: name, file_type: 'application/pdf', file_size: bytes.byteLength, converted_to_pdf: true, pdf_conversion_source: source, pdf_converted_at: new Date().toISOString() }
        await onConverted(updated)
        result.converted.push(updated)
      } catch (error) { result.failed.push({ doc, reason: error?.message || String(error) }) }
    }
    onProgress({ completed: index + 1, total: docs.length, name: rfpFileName(doc) })
  }
  return result
}

export function invalidateRfpConvertedFiles(set, ids) {
  const bates = { ...(set.bates_by_document || {}) }, names = { ...(set.export_file_names || {}) }
  let changed = false
  for (const id of ids) {
    if (bates[id]) { delete bates[id]; changed = true }
    if (names[id]) { names[id] = rfpPdfName(names[id]); changed = true }
  }
  return changed ? { ...set, bates_by_document: bates, export_file_names: names, bates_completed_at: '', updated_at: new Date().toISOString() } : set
}

export async function extractRfpDocxText(bytes) {
  const zip = await JSZip.loadAsync(bytes), file = zip.file('word/document.xml')
  if (!file) throw new Error('The file does not contain a Word document.')
  const xml = await file.async('string')
  if (xml.length > 12_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported or oversized Word XML.')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const textOf = node => {
    if (node.namespaceURI === ns) {
      if (node.localName === 'del') return ''
      if (node.localName === 't') return node.textContent || ''
      if (['br', 'cr'].includes(node.localName)) return '\n'
      if (node.localName === 'tab') return '\t'
    }
    return Array.from(node.childNodes || []).map(textOf).join('')
  }
  return Array.from(doc.getElementsByTagNameNS(ns, 'p')).map(textOf).join('\n')
}

export function createRfpCoverDraft(doc) {
  const name = rfpFileName(doc), mime = doc.file_type || doc.mime_type || ''
  const type = /^video\//i.test(mime) || /\.(mp4|mov|avi|wmv|mkv|webm|m4v|mpeg|mpg)$/i.test(name) ? 'VIDEO' : /^audio\//i.test(mime) || /\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff?|opus)$/i.test(name) ? 'AUDIO' : 'ELECTRONIC'
  return { sourceId: String(doc.id), filename: name, documentName: doc.name || name, fileType: mime || name.split('.').pop()?.toUpperCase() || 'Electronic file', fileSize: Number(doc.file_size) || 0, heading: `NATIVE ${type} FILE`, description: 'See the accompanying native file.', outputName: `${name.replace(/\.[a-z0-9]{1,10}$/i, '')} - Cover Sheet` }
}

export function normalizeRfpCoverSettings(value = {}) {
  const n = (v, fallback, min, max) => Math.max(min, Math.min(max, Number(v) || fallback))
  return { ...DEFAULT_RFP_COVER_SETTINGS, ...value, headingSize: n(value.headingSize, 28, 18, 48), bodySize: n(value.bodySize, 16, 10, 24), topInches: n(value.topInches, 1.8, .75, 3.5), font: ['Arial', 'Times New Roman'].includes(value.font) ? value.font : 'Times New Roman', alignment: ['left', 'center', 'right'].includes(value.alignment) ? value.alignment : 'center' }
}

export function rfpCoverBlocks(sheet, options) {
  const s = normalizeRfpCoverSettings(options)
  const blocks = [{ text: sheet.heading, size: s.headingSize, bold: s.bold, after: 22 }, { text: sheet.filename, size: s.bodySize, bold: true, after: 16 }]
  if (s.showDocumentName && sheet.documentName && sheet.documentName !== sheet.filename) blocks.push({ text: sheet.documentName, size: s.bodySize, after: 16 })
  if (sheet.description) blocks.push({ text: sheet.description, size: s.bodySize, after: 18 })
  if (s.showType) blocks.push({ text: `File type: ${sheet.fileType}`, size: 11, after: 8 })
  if (s.showSize && sheet.fileSize) blocks.push({ text: `File size: ${sheet.fileSize.toLocaleString('en-US')} bytes`, size: 11, after: 8 })
  return blocks
}

const xmlEscape = text => String(text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export async function buildRfpCoverDocx(sheet, options) {
  const s = normalizeRfpCoverSettings(options), zip = new JSZip()
  const paragraphs = rfpCoverBlocks(sheet, s).map(block => `<w:p><w:pPr><w:jc w:val="${s.alignment}"/><w:spacing w:after="${block.after * 20}" w:line="288" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${s.font}" w:hAnsi="${s.font}"/>${block.bold ? '<w:b/>' : ''}<w:sz w:val="${block.size * 2}"/></w:rPr>${String(block.text || '').split('\n').map((line, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`).join('')}</w:r></w:p>`).join('')
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="${Math.round(s.topInches * 1440)}" w:right="1080" w:bottom="1080" w:left="1080" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export async function buildRfpCoverPdf(sheet, options, library) {
  const s = normalizeRfpCoverSettings(options), { PDFDocument, StandardFonts } = library
  const pdf = await PDFDocument.create(), times = s.font === 'Times New Roman'
  const regular = await pdf.embedFont(times ? StandardFonts.TimesRoman : StandardFonts.Helvetica)
  const bold = await pdf.embedFont(times ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold)
  const blocks = rfpCoverBlocks(sheet, s)
  try { for (const block of blocks) (block.bold ? bold : regular).encodeText(String(block.text || '').replace(/[\r\n]/g, '')) }
  catch (error) {
    // Browser font fallback renders Unicode (including native filenames) in the
    // same font stack as the preview. Never drop or transliterate characters.
    if (typeof document === 'undefined') throw error
    return buildRfpUnicodeCoverPdf(blocks, s, pdf)
  }
  let page = pdf.addPage([612, 792]), y = 792 - s.topInches * 72
  for (const block of blocks) {
    const font = block.bold ? bold : regular, size = block.size, width = 504
    for (const paragraph of String(block.text || '').split('\n')) {
      // Wrap character-by-character when filenames have no whitespace, keeping
      // every character rather than truncating long native filenames.
      const lines = []; let line = ''
      for (const word of paragraph.split(/(\s+)/)) {
        if (line && font.widthOfTextAtSize(line + word, size) > width) { lines.push(line.trimEnd()); line = '' }
        for (const char of word) {
          if (line && font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = '' }
          line += char
        }
      }
      lines.push(line)
      for (const text of lines) {
        if (y - size < 54) { page = pdf.addPage([612, 792]); y = 738 }
        y -= size
        const textWidth = font.widthOfTextAtSize(text, size)
        const x = s.alignment === 'center' ? (612 - textWidth) / 2 : s.alignment === 'right' ? 558 - textWidth : 54
        page.drawText(text, { x, y, size, font })
        y -= size * .2
      }
    }
    y -= block.after
  }
  return pdf
}

async function buildRfpUnicodeCoverPdf(blocks, settings, pdf) {
  await document.fonts?.ready
  let canvas, context, y
  const startPage = top => {
    canvas = document.createElement('canvas'); canvas.width = 1836; canvas.height = 2376
    context = canvas.getContext('2d'); context.scale(3, 3)
    context.fillStyle = '#fff'; context.fillRect(0, 0, 612, 792); context.fillStyle = '#111'; context.textBaseline = 'top'
    y = top
  }
  const finishPage = async () => {
    const image = await pdf.embedPng(canvas.toDataURL('image/png'))
    pdf.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 612, height: 792 })
  }
  startPage(settings.topInches * 72)
  for (const block of blocks) {
    const font = `${block.bold ? 'bold' : 'normal'} ${block.size}px ${settings.font === 'Times New Roman' ? '"Times New Roman", Times, serif' : 'Arial, Helvetica, sans-serif'}`
    context.font = font
    for (const paragraph of String(block.text || '').split('\n')) {
      const lines = []; let line = ''
      for (const word of paragraph.split(/(\s+)/)) {
        if (line && context.measureText(line + word).width > 504) { lines.push(line.trimEnd()); line = '' }
        const chars = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word), entry => entry.segment) : Array.from(word)
        for (const char of chars) {
          if (line && context.measureText(line + char).width > 504) { lines.push(line); line = '' }
          line += char
        }
      }
      lines.push(line)
      for (const text of lines) {
        if (y + block.size * 1.2 > 738) { await finishPage(); startPage(54); context.font = font }
        const width = context.measureText(text).width
        const x = settings.alignment === 'center' ? (612 - width) / 2 : settings.alignment === 'right' ? 558 - width : 54
        context.fillText(text, x, y); y += block.size * 1.2
      }
    }
    y += block.after
  }
  await finishPage()
  return pdf
}
