import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const TYPES = ['rfp', 'rfd', 'roggs', 'rfa']
const TITLES = { rfp: 'REQUEST FOR PRODUCTION', rfd: 'REQUEST FOR DISCLOSURE', roggs: 'INTERROGATORY', rfa: 'REQUEST FOR ADMISSION' }
const FOOTER = /^(?:respectfully submitted|certificate of (?:service|conference)|verification\b|unsworn declaration|signature\b|signed (?:this|by)|\/s\/|notary public|state of texas\s*$|submitted by)/i
const RESPONSE = /^(?:response|answer)(?:\s+(?:to\s+)?(?:request|interrogatory)?\s*(?:no\.?|number|#)?\s*\d+)?\s*[:.\-]\s*(.*)$/i
const HEADER = /^(requests?\s*(?:for\s*)?(?:production|disclosure|admissions?)?|interrogator(?:y|ies)|rfp|rfd|rfa|rogg?s?)\s*(?:no\.?|number|#)?\s*(\d+[a-z]?)\s*[.:)\-]?\s*([\s\S]*)$/i
const typeFrom = (label, fallback) => /production|rfp/i.test(label) ? 'rfp' : /disclosure|rfd/i.test(label) ? 'rfd' : /admission|rfa/i.test(label) ? 'rfa' : /interrogator|rogg?/i.test(label) ? 'roggs' : fallback
function textOf(node) {
  if (node.namespaceURI === W) {
    if (node.localName === 'del') return ''
    if (node.localName === 't') return node.textContent || ''
    if (['br', 'cr'].includes(node.localName)) return '\n'
    if (node.localName === 'tab') return '\t'
  }
  return Array.from(node.childNodes || []).map(textOf).join('')
}
const el = (node, name) => node.getElementsByTagNameNS(W, name)[0]
const val = node => node?.getAttributeNS(W, 'val') || ''
const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
const trim = parts => parts.join('\n').trim()
const REQUEST_START = /^(?:produce|identify|state|admit|describe|list|provide|explain|set forth|specify|please)\b/i

function checkParagraphBoundaries(paragraphs) {
  for (const {text} of paragraphs) {
    const headers = text.match(/(?:^|\s)(?:requests?\s*(?:for\s*)?(?:production|disclosure|admissions?)?|interrogator(?:y|ies)|rfp|rfd|rfa|rogg?s?)\s*(?:no\.?|number|#)?\s*\d+[a-z]?\b/gi) || []
    const answers = text.match(/(?:^|\s)(?:RESPONSE|ANSWER)\s*:/gi) || []
    const numbered = text.split('\n').filter(line => /^\d+[.)]\s+/.test(line.trim()))
    const headingLines = text.split('\n').filter(line => HEADER.test(line.trim()))
    if (headingLines.length > 1 || (answers.length > 1 && (headers.length || numbered.length > 1))) throw new Error('A paragraph contains multiple requests or responses. In Word, put each request and response in separate paragraphs (Enter, not Shift+Enter), then upload again.')
  }
}

function hasFollowingResponse(paragraphs, index) {
  for (const p of paragraphs.slice(index + 1)) {
    const text = p.text.trim()
    if (!text) continue
    if (RESPONSE.test(text) || /^(?:response|answer)\s*:?$/i.test(text)) return true
    if (HEADER.test(text) || /^\d+[.)]\s+/.test(text) || FOOTER.test(text)) return false
  }
  return false
}

function parseXml(text) {
  if (text.length > 12_000_000 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsupported or oversized Word XML.')
  return new DOMParser({ onError: level => { if (level === 'fatalError' || level === 'error') throw new Error('The Word document contains invalid XML.') } }).parseFromString(text, 'application/xml')
}

function parseParagraphs(paragraphs, defaultType, single = false) {
  if (!TYPES.includes(defaultType)) throw new Error('Choose a discovery type.')
  checkParagraphBoundaries(paragraphs)
  const requests = [], warnings = []
  let current = null, currentType = defaultType, inResponse = false, stopped = false
  const finish = () => {
    if (!current) return
    current.request = trim(current.requestParts)
    current.response = trim(current.responseParts)
    current.existingObjection = /\bobjection\s*:/i.test(current.response)
    current.anchor = { start: current.start, end: current.end, sourceText: paragraphs.slice(current.start, current.end + 1).map(p => p.text).join('\n') }
    delete current.requestParts; delete current.responseParts
    if (current.request) requests.push(current)
    current = null; inResponse = false
  }
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i], text = para.text.trim()
    if (!text) continue
    if (FOOTER.test(text)) { finish(); stopped = true; break }
    const section = text.match(/^(?:(?:first|second|third|fourth|plaintiff.?s|defendant.?s|petitioner.?s|respondent.?s)\s+)*(?:set of\s+)?(?:requests?\s+for\s+(production|disclosure|admissions?)|(?:written\s+)?(interrogatories))\s*$/i)
    if (section) { finish(); currentType = typeFrom(section[0], defaultType); continue }
    let match = text.match(HEADER)
    let number = match?.[2], requestText = match?.[3], type = match ? typeFrom(match[1], currentType) : currentType
    const plain = text.match(/^(\d+)[.)]\s+(.+)$/)
    const numbered = para.number && para.level === 0
    // Inside an answer, a following response heading corroborates a new typed
    // request. Names such as "Will Smith" are not question prefixes.
    if (!match && numbered && (!inResponse || (current?.listId && para.listId === current.listId))) {
      number = String(para.number); requestText = text; match = true
    } else if (!match && plain && (!inResponse || hasFollowingResponse(paragraphs, i))) {
      number = plain[1]; requestText = plain[2]; match = true
    }
    if (!match && plain && inResponse && Number(plain[1]) > Number(current.number) && (REQUEST_START.test(plain[2]) || /\?$/.test(plain[2]))) throw new Error('A numbered item could be a request or part of an answer. Add an explicit REQUEST NO. or INTERROGATORY NO. heading and a separate RESPONSE: paragraph, then upload again.')
    if (match) {
      finish()
      current = { id: `request-${i}-${type}-${number}`, number, type, requestParts: [requestText || ''], responseParts: [], start: i, end: i, responseStart: null, listId: para.listId || '', confidence: 'recognized' }
      const inline = String(requestText || '').match(/^([\s\S]*?)\s+(?:RESPONSE|ANSWER)\s*:\s*([\s\S]*)$/i)
      if (inline) { current.requestParts=[inline[1]];current.responseParts=[inline[2]];current.responseStart=i;inResponse=true }
      currentType = type
      continue
    }
    if (!current) continue
    const response = text.match(RESPONSE) || (/^(?:response|answer)\s*:?$/i.test(text) ? ['', ''] : null)
    if (response) {
      inResponse = true
      current.responseStart ??= i
      current.responseParts.push(response[1] || '')
    } else if (/^objections?\s*:/i.test(text)) {
      inResponse = true; current.responseStart ??= i; current.responseParts.push(text)
    } else (inResponse ? current.responseParts : current.requestParts).push(text)
    current.end = i
  }
  finish()
  if (!requests.length && single && paragraphs.some(p => p.text.trim()) && !stopped) {
    const request = paragraphs.map(p => p.text).join('\n').trim()
    requests.push({ id: 'request-0-' + defaultType + '-1', number: '1', type: defaultType, request, response: '', confidence: 'single', responseStart: null, anchor: null })
  }
  if (!requests.length) warnings.push('No numbered requests were recognized. Use AI recognition or paste a request to continue.')
  if (requests.some(r => r.existingObjection)) warnings.push('Existing objection language was found. Review it against each proposed addition to avoid duplicate or inconsistent objections.')
  if (requests.some(r => !r.response) && requests.some(r => r.response)) warnings.push('Some requests have no recognized response. Confirm the request boundaries before analyzing or exporting.')
  return { requests, paragraphs, warnings }
}

export function parseDiscoveryText(text, defaultType = 'rfp') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter at least one discovery request; the text is empty.')
  if (text.length > 300_000) throw new Error('Paste a smaller set of requests (maximum 300,000 characters).')
  return parseParagraphs(text.replaceAll('\r\n', '\n').split('\n').map((text, index) => ({ index, text })), defaultType, true)
}

async function loadWord(bytes) {
  if (!bytes || bytes.byteLength > 20 * 1024 * 1024) throw new Error('Choose a Word .docx file of 20 MB or less.')
  let zip
  try { zip = await JSZip.loadAsync(bytes) } catch { throw new Error('This is not a readable Word .docx document. In Word, use Save As → .docx, then upload it.') }
  const entries = Object.values(zip.files)
  if (entries.length > 2500 || entries.reduce((n, f) => n + Number(f._data?.uncompressedSize || 0), 0) > 80 * 1024 * 1024) throw new Error('This Word document is too large when expanded.')
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('This file has no Word document content. Upload a .docx file.')
  const doc = parseXml(await entry.async('string'))
  const nodes = Array.from(doc.getElementsByTagNameNS(W, 'p'))
  const numberingFile = zip.file('word/numbering.xml')
  const numbering = numberingFile ? parseXml(await numberingFile.async('string')) : null
  const starts = {}, definitions = {}, counters = {}
  if (numbering) {
    for (const num of Array.from(numbering.getElementsByTagNameNS(W, 'num'))) {
      const id = num.getAttributeNS(W, 'numId'), abstractId = val(el(num, 'abstractNumId'))
      const abstract = Array.from(numbering.getElementsByTagNameNS(W, 'abstractNum')).find(a => a.getAttributeNS(W, 'abstractNumId') === abstractId)
      const level = abstract && Array.from(abstract.getElementsByTagNameNS(W, 'lvl')).find(l => l.getAttributeNS(W, 'ilvl') === '0')
      definitions[id] = val(level && el(level, 'numFmt'))
      starts[id] = Number(val(el(num, 'startOverride')) || val(level && el(level, 'start')) || 1)
    }
  }
  const paragraphs = nodes.map((node, index) => {
    const numPr = el(node, 'numPr'), listId = numPr ? val(el(numPr, 'numId')) : ''
    const level = Number(numPr ? val(el(numPr, 'ilvl')) || 0 : -1)
    let number = null
    if (listId && level === 0 && definitions[listId] === 'decimal') {
      counters[listId] = (counters[listId] ?? (starts[listId] - 1)) + 1
      number = counters[listId]
    }
    return { index, text: textOf(node), listId, level, number }
  })
  const revisions = doc.getElementsByTagNameNS(W, 'del').length + doc.getElementsByTagNameNS(W, 'ins').length
  return { zip, doc, nodes, paragraphs, revisions }
}

export async function readDiscoveryDocx(bytes, defaultType = 'rfp') {
  const { paragraphs, revisions } = await loadWord(bytes)
  const parsed = parseParagraphs(paragraphs, defaultType)
  if (revisions) parsed.warnings.push('Tracked changes are present. Accept or reject revisions in Word and upload a clean copy before exporting inserted objections.')
  return { ...parsed, hasTrackedChanges: Boolean(revisions) }
}

export function mapRecognizedRanges(paragraphs, ranges, defaultType = 'rfp') {
  if (!Array.isArray(ranges) || !ranges.length || ranges.length > 150) throw new Error('AI did not identify a usable set of requests.')
  const recognized = parseParagraphs(paragraphs, defaultType).requests
  for (const request of recognized) {
    const range = ranges.find(r => r.start === request.start)
    if (!range || String(range.number) !== request.number || range.type !== request.type || range.end !== request.end || range.responseStart !== (request.responseStart ?? -1)) throw new Error('AI changed or omitted an already recognized request or response boundary. Keep the numbered recognition, or put each request and response in separate paragraphs and upload again.')
  }
  let previousEnd = -1
  return ranges.map((range) => {
    const { start, end, responseStart } = range
    if (![start, end, responseStart].every(Number.isInteger) || start <= previousEnd || start < 0 || end < start || end >= paragraphs.length || (responseStart !== -1 && (responseStart < start || responseStart > end))) throw new Error('AI request boundaries overlap or are invalid. Review the document manually.')
    if (paragraphs.slice(start, end + 1).some(p => FOOTER.test(p.text.trim()))) throw new Error('AI included a signature or verification in a request. Use the numbered recognition or paste the requests.')
    if (recognized.some(r => r.start !== start && r.start <= end && r.end >= start)) throw new Error('AI merged already recognized request boundaries. Keep the numbered recognition.')
    previousEnd = end
    const known = recognized.find(r => r.start === start)
    if (known) return { ...known, confidence: 'ai-confirmed' }
    const type = TYPES.includes(range.type) ? range.type : defaultType
    const number = String(range.number || '').slice(0, 20) || String(start + 1)
    const requestEnd = responseStart === -1 ? end + 1 : responseStart
    const request = paragraphs.slice(start, requestEnd).map(p => p.text).join('\n').trim()
    const response = responseStart === -1 ? '' : paragraphs.slice(responseStart, end + 1).map(p => p.text).join('\n').replace(RESPONSE, '$1').trim()
    if (!request) throw new Error('AI did not separate the request from its response. Use the numbered recognition or paste the requests.')
    return { id: `request-${start}-${type}-${number}`, type, number, request, response, responseStart: responseStart < 0 ? null : responseStart, existingObjection: /\bobjection\s*:/i.test(response), confidence: 'ai-recognized', anchor: { start, end, sourceText: paragraphs.slice(start, end + 1).map(p => p.text).join('\n') } }
  })
}

function paragraphXml(text, bold = false) {
  return `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}
function annotationXml(text, label = 'OBJECTION') {
  const clean = String(text).replace(/^\s*(?:OBJECTION|PRIVILEGE)\s*:\s*/i, '').trim()
  if (!clean || clean.length > 20_000) throw new Error('An objection or privilege is empty or too long.')
  return `<w:p><w:pPr><w:spacing w:before="100" w:after="180"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(label)}: </w:t></w:r><w:r><w:t xml:space="preserve">${escapeXml(clean)}</w:t></w:r></w:p>`
}
function insertXml(doc, parent, before, xml) {
  if (!xml) return
  const fragment = parseXml(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`)
  for (const node of Array.from(el(fragment, 'body').childNodes)) parent.insertBefore(doc.importNode(node, true), before)
}
function splitInlineResponse(node) {
  const text = textOf(node), match = /\s+(?:RESPONSE|ANSWER)\s*:/i.exec(text)
  if (!match) throw new Error('The inline response boundary could not be verified. Put the request and response in separate Word paragraphs.')
  const offset = match.index + match[0].search(/RESPONSE|ANSWER/i)
  const elements = Array.from(node.childNodes).filter(n => n.nodeType === 1)
  const unsupported = elements.some(n => n.namespaceURI !== W || !['pPr','r'].includes(n.localName) || (n.localName === 'r' && Array.from(n.childNodes).some(c => c.nodeType === 1 && (c.namespaceURI !== W || !['rPr','t','br','cr','tab'].includes(c.localName)))))
  if (unsupported || el(node, 'sectPr')) throw new Error('This inline response contains complex Word formatting. Put the request and response in separate paragraphs in Word, then upload again.')
  const before = node.cloneNode(false), after = node.cloneNode(false)
  // The new response paragraph is not another numbered request.
  for (const attr of Array.from(after.attributes || [])) if (['paraId','textId'].includes(attr.localName)) after.removeAttributeNode(attr)
  let position = 0
  for (const child of elements) {
    if (child.localName === 'pPr') {
      before.appendChild(child.cloneNode(true))
      const props = child.cloneNode(true), numPr = el(props, 'numPr')
      if (numPr) numPr.parentNode.removeChild(numPr)
      after.appendChild(props); continue
    }
    const left = child.cloneNode(false), right = child.cloneNode(false)
    const props = el(child, 'rPr')
    if (props) { left.appendChild(props.cloneNode(true)); right.appendChild(props.cloneNode(true)) }
    let leftCount = 0, rightCount = 0
    for (const part of Array.from(child.childNodes).filter(n => n.nodeType === 1 && n.localName !== 'rPr')) {
      const value = textOf(part), cut = Math.max(0, Math.min(value.length, offset - position))
      if (part.localName === 't') {
        for (const [target, chunk] of [[left,value.slice(0,cut)],[right,value.slice(cut)]]) if (chunk) {
          const copy = part.cloneNode(false); copy.setAttribute('xml:space','preserve'); copy.textContent = chunk; target.appendChild(copy)
          if (target === left) leftCount++; else rightCount++
        }
      } else if (position < offset) { left.appendChild(part.cloneNode(true)); leftCount++ } else { right.appendChild(part.cloneNode(true)); rightCount++ }
      position += value.length
    }
    if (leftCount) before.appendChild(left)
    if (rightCount) after.appendChild(right)
  }
  node.parentNode.insertBefore(before, node)
  node.parentNode.insertBefore(after, node)
  node.parentNode.removeChild(node)
  return { requestNode:before, responseNode:after }
}

export async function exportDiscoveryDocx({ originalBytes, requests, objections = [], privileges = [], privilegePlacement = 'before_request' }) {
  if (!Array.isArray(requests) || !requests.length) throw new Error('There are no requests to export.')
  if (!['before_request','after_request'].includes(privilegePlacement)) throw new Error('Choose a valid privilege placement.')
  const ids = new Set(requests.map(r => r.id)), selected = new Map(), privileged = new Map()
  if (ids.size !== requests.length) throw new Error('Duplicate request identities prevent safe export.')
  for (const [entries, target] of [[objections,selected],[privileges,privileged]]) for (const entry of entries) {
    if (!ids.has(entry.id) || target.has(entry.id)) throw new Error('An objection or privilege does not match a unique request.')
    if (typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 20000) throw new Error('An objection or privilege is empty or too long.')
    target.set(entry.id, entry.text)
  }
  const additions = r => ({
    objection: selected.has(r.id) ? annotationXml(selected.get(r.id)) : '',
    privilege: privileged.has(r.id) ? annotationXml(privileged.get(r.id), `PRIVILEGE (${TITLES[r.type] || 'REQUEST'} NO. ${r.number})`) : ''
  })
  let zip
  if (originalBytes) {
    const loaded = await loadWord(originalBytes)
    checkParagraphBoundaries(loaded.paragraphs)
    if (loaded.revisions) throw new Error('Accept or reject tracked changes in Word and upload a clean copy before inserting objections.')
    zip = loaded.zip
    const ranges = requests.filter(r => selected.has(r.id) || privileged.has(r.id)).sort((a,b) => a.anchor?.start - b.anchor?.start)
    let previousEnd = -1
    for (const request of ranges) {
      const a = request.anchor
      if (!a || !Number.isInteger(a.start) || !Number.isInteger(a.end) || a.start <= previousEnd || a.end < a.start || !loaded.nodes[a.end]) throw new Error('A request has no reliable original Word position. Re-upload the document before exporting.')
      if (loaded.paragraphs.slice(a.start,a.end+1).map(p => p.text).join('\n') !== a.sourceText) throw new Error('The original document no longer matches the recognized request. Re-upload it.')
      const responseStart = request.responseStart
      if (responseStart != null && (!Number.isInteger(responseStart) || responseStart < a.start || responseStart > a.end)) throw new Error('The response position is invalid. Re-upload the document.')
      previousEnd = a.end
      let requestNode = loaded.nodes[a.start], responseNode = responseStart == null ? null : loaded.nodes[responseStart]
      if (responseStart === a.start) ({requestNode,responseNode} = splitInlineResponse(requestNode))
      const {objection,privilege} = additions(request)
      if (privilegePlacement === 'before_request') insertXml(loaded.doc,requestNode.parentNode,requestNode,privilege)
      const beforeResponse = (privilegePlacement === 'after_request' ? privilege : '') + objection
      if (responseNode) insertXml(loaded.doc,responseNode.parentNode,responseNode,beforeResponse)
      else {
        const end = loaded.nodes[a.end]
        insertXml(loaded.doc,end.parentNode,end.nextSibling,beforeResponse + paragraphXml('RESPONSE:'))
      }
    }
    zip.file('word/document.xml',new XMLSerializer().serializeToString(loaded.doc))
  } else {
    zip = new JSZip()
    const body = paragraphXml('Discovery responses',true) + requests.map(r => {
      const {objection,privilege} = additions(r)
      return (privilegePlacement === 'before_request' ? privilege : '') + paragraphXml(`${TITLES[r.type] || 'REQUEST'} NO. ${r.number}: ${r.request}`,true) + (privilegePlacement === 'after_request' ? privilege : '') + objection + paragraphXml(`RESPONSE: ${r.response || ''}`)
    }).join('')
    zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    zip.file('word/document.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`)
  }
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'})
}
