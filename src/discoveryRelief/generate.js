// Pure document-generation for the discovery composer: render the numbered,
// deduplicated requests into a minimal Word (.docx) body. This produces a real,
// downloadable Word document; it does not yet route through a drafting template's
// caption/heading/definitions layout (that reuse comes later via
// generateDocxFromTemplateFile). The pure XML part is unit-tested.

import { discoveryTypeLabel } from './types.js'

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function discoveryDocxFileName(matter = {}) {
  const base = String(matter?.cause_number || matter?.name || 'Matter').trim() || 'Matter'
  return `Discovery Requests - ${base}.docx`.replace(/[\\/:*?"<>|]+/g, '-')
}

export function buildDiscoveryDocxBodyXml(composed = {}) {
  const included = Array.isArray(composed?.included) ? composed.included : []
  const paragraphs = []
  const types = ['rfp', 'roggs', 'rfa', 'rfd']
  for (const type of types) {
    const requests = included.filter((request) => request.type === type)
    if (!requests.length) continue
    paragraphs.push(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(discoveryTypeLabel(type).toUpperCase())}</w:t></w:r></w:p>`)
    for (const request of requests) {
      paragraphs.push(`<w:p><w:r><w:t>${escapeXml(`${discoveryTypeLabel(type)} ${request.number}. ${request.text}`)}</w:t></w:r></w:p>`)
    }
  }
  if (!paragraphs.length) paragraphs.push('<w:p><w:r><w:t>No discovery requests selected.</w:t></w:r></w:p>')
  return paragraphs.join('')
}

// Minimal WordprocessingML document.xml wrapping the body.
export function buildDiscoveryDocxXml(composed = {}) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${buildDiscoveryDocxBodyXml(composed)}</w:body></w:document>`
}

export async function generateDiscoveryDocx(composed, matter, JSZip) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.folder('word').file('document.xml', buildDiscoveryDocxXml(composed))
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  return { blob, name: discoveryDocxFileName(matter) }
}
