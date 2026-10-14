import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { parseDiscoveryText, readDiscoveryDocx, exportDiscoveryDocx, mapRecognizedRanges } from '../src/discovery/documents.js'

const xmlEscape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
async function fixture(body, extras = {}) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`)
  for (const [path, value] of Object.entries(extras)) zip.file(path, value)
  return zip.generateAsync({ type: 'uint8array' })
}
const p = text => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`

test('recognizes mixed sets with repeated numbers and keeps multiline responses together', () => {
  const result = parseDiscoveryText('REQUEST FOR PRODUCTION NO. 1:\nProduce communications with your lawyer.\nRESPONSE:\nNone produced.\nThis answer continues.\nINTERROGATORY NO. 1:\nState your general factual basis.\nANSWER: Facts follow.\nRespectfully submitted,\n/s/ Counsel', 'rfp')
  assert.equal(result.requests.length, 2)
  assert.equal(result.requests[0].response, 'None produced.\nThis answer continues.')
  assert.equal(result.requests[1].type, 'roggs')
  assert.equal(result.requests[1].response, 'Facts follow.')
  assert.notEqual(result.requests[0].id, result.requests[1].id)
})

test('unnumbered pasted question is a single request, not an empty successful import', () => {
  assert.equal(parseDiscoveryText('Produce all correspondence with your attorney.', 'rfp').requests[0].request, 'Produce all correspondence with your attorney.')
  assert.throws(() => parseDiscoveryText('   ', 'rfp'), /empty|enter/i)
})

test('numbered subparts inside a response are not new discovery requests', () => {
  const result = parseDiscoveryText('1. Identify witnesses.\nANSWER:\n1. Jane\n2. John\nINTERROGATORY NO. 2: State your address.\nANSWER: Houston.', 'roggs')
  assert.equal(result.requests.length, 2)
  assert.match(result.requests[0].response, /2\. John/)
})

test('manually numbered request sets recognize the next imperative question after an answer', () => {
  const parsed=parseDiscoveryText('1. Produce income records.\nRESPONSE: Attached.\n2. Produce attorney communications.\nRESPONSE: Withheld.','rfp')
  assert.equal(parsed.requests.length,2)
  assert.equal(parsed.requests[0].response,'Attached.')
})

test('a request and response on the same paragraph are separated for analysis', () => {
  const parsed=parseDiscoveryText('REQUEST FOR PRODUCTION NO. 1: Produce records. RESPONSE: None.','rfp')
  assert.equal(parsed.requests[0].request,'Produce records.')
  assert.equal(parsed.requests[0].response,'None.')
})

test('question-form and nonconsecutive numbered requests do not become part of an answer', () => {
  const parsed = parseDiscoveryText('1. Identify witnesses.\nANSWER: Jane.\n2. What is your current address?\nANSWER: Houston.\n7. Your employment history for the last year.\nANSWER: Employed by Example.', 'roggs')
  assert.deepEqual(parsed.requests.map(r => r.number), ['1', '2', '7'])
  assert.deepEqual(parsed.requests.map(r => r.response), ['Jane.', 'Houston.', 'Employed by Example.'])
})

test('Word soft breaks separate a single request and response and tabs preserve words', async () => {
  const bytes = await fixture('<w:p><w:r><w:t>REQUEST FOR PRODUCTION NO. 1: Produce</w:t><w:tab/><w:t>records.</w:t><w:br/><w:t>RESPONSE: None.</w:t></w:r></w:p>')
  const parsed = await readDiscoveryDocx(bytes)
  assert.equal(parsed.requests[0].request, 'Produce\trecords.')
  assert.equal(parsed.requests[0].response, 'None.')
})

test('multiple request/response pairs in one Word paragraph are refused before analysis or export', async () => {
  for (const separator of ['<w:br/>', '<w:t> </w:t>']) {
    const bytes = await fixture('<w:p><w:r><w:t>REQUEST FOR PRODUCTION NO. 1: Produce records. RESPONSE: None.</w:t>' + separator + '<w:t>REQUEST FOR PRODUCTION NO. 2: Produce pay stubs. RESPONSE: Attached.</w:t></w:r></w:p>')
    await assert.rejects(readDiscoveryDocx(bytes), /multiple requests|separate paragraphs/i)
  }
})

test('AI ranges cannot renumber, retype, merge, omit or truncate recognized request/response pairs', () => {
  const parsed = parseDiscoveryText('REQUEST FOR PRODUCTION NO. 1: Produce records.\nRESPONSE: None.\nREQUEST FOR PRODUCTION NO. 2: Produce pay stubs.\nRESPONSE: Attached.')
  const valid = [{number:'1',type:'rfp',start:0,end:1,responseStart:1},{number:'2',type:'rfp',start:2,end:3,responseStart:3}]
  assert.equal(mapRecognizedRanges(parsed.paragraphs, valid).length, 2)
  for (const invalid of [
    [{number:'99',type:'rfa',start:0,end:3,responseStart:1}],
    [valid[1]],
    [{...valid[0],number:'99'},valid[1]],
    [{...valid[0],type:'rfa'},valid[1]],
    [{...valid[0],end:0,responseStart:-1},valid[1]],
  ]) assert.throws(() => mapRecognizedRanges(parsed.paragraphs, invalid), /recognized|boundar|identity|omit|request/i)
})

test('references to another request stay inside the actual request', () => {
  const parsed = parseDiscoveryText('REQUEST FOR PRODUCTION NO. 2: Produce the documents identified in your answer to Interrogatory No. 1.\nRESPONSE: Attached.')
  assert.equal(parsed.requests.length, 1)
  assert.match(parsed.requests[0].request, /Interrogatory No. 1/)
})

test('numbered witness names that resemble question prefixes remain in the answer', () => {
  const parsed = parseDiscoveryText('INTERROGATORY NO. 7: Identify witnesses.\nANSWER:\n1. Will Smith\n2. John Jones\nINTERROGATORY NO. 8: State your address.\nANSWER: Houston.', 'roggs')
  assert.deepEqual(parsed.requests.map(r => r.number), ['7', '8'])
  assert.match(parsed.requests[0].response, /1\. Will Smith\n2\. John Jones/)
})

test('DOCX export preserves parts and places a bold label after the response, before the next request', async () => {
  const bytes = await fixture(p('REQUEST FOR PRODUCTION NO. 1: Produce attorney communications.') + p('RESPONSE: Withheld.') + p('REQUEST FOR PRODUCTION NO. 2: Produce pay stubs.') + p('RESPONSE: Attached.') + p('CERTIFICATE OF SERVICE') + p('Served on counsel.'), {'word/header1.xml': '<header>Keep me</header>'})
  const parsed = await readDiscoveryDocx(bytes, 'rfp')
  const output = await exportDiscoveryDocx({ originalBytes: bytes, requests: parsed.requests, objections: [{ id: parsed.requests[0].id, text: 'Confidential legal advice is privileged. Tex. R. Evid. 503.' }] })
  const zip = await JSZip.loadAsync(output), xml = await zip.file('word/document.xml').async('string')
  assert.match(xml, /<w:b\/?[ >]/)
  assert.ok(xml.indexOf('Withheld.') < xml.indexOf('OBJECTION:'))
  assert.ok(xml.indexOf('OBJECTION:') < xml.indexOf('REQUEST FOR PRODUCTION NO. 2'))
  assert.equal(await zip.file('word/header1.xml').async('string'), '<header>Keep me</header>')
  assert.equal((xml.match(/OBJECTION:/g)||[]).length, 1)
})

test('last response insertion stays before verification/signature and supports table cells', async () => {
  const bytes = await fixture('<w:tbl><w:tr><w:tc>' + p('INTERROGATORY NO. 1: Identify counsel advice.') + p('ANSWER: Withheld.') + '</w:tc></w:tr></w:tbl>' + p('VERIFICATION') + p('Signed by client.'))
  const parsed = await readDiscoveryDocx(bytes, 'roggs')
  const output = await exportDiscoveryDocx({originalBytes: bytes, requests: parsed.requests, objections:[{id:parsed.requests[0].id,text:'Privileged legal advice.'}]})
  const xml = await (await JSZip.loadAsync(output)).file('word/document.xml').async('string')
  assert.ok(xml.indexOf('OBJECTION:') < xml.indexOf('</w:tc>'))
  assert.ok(xml.indexOf('OBJECTION:') < xml.indexOf('VERIFICATION'))
})

test('Word automatic numbering is recognized, including consecutive requests', async () => {
  const numbered = (text) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
  const bytes = await fixture(numbered('Produce relevant pay stubs.') + p('RESPONSE: Attached.') + numbered('Produce all attorney advice.') + p('RESPONSE: Withheld.'), {'word/numbering.xml':'<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="1"/></w:num></w:numbering>'})
  const parsed = await readDiscoveryDocx(bytes, 'rfp')
  assert.equal(parsed.requests.length, 2)
  assert.deepEqual(parsed.requests.map(r=>r.number), ['1','2'])
  assert.equal(parsed.requests[1].request, 'Produce all attorney advice.')
})

test('export refuses unknown or stale anchors and rejects invalid documents', async () => {
  const bytes = await fixture(p('REQUEST NO. 1: Produce records.') + p('RESPONSE: None.'))
  const parsed = await readDiscoveryDocx(bytes, 'rfp')
  await assert.rejects(exportDiscoveryDocx({originalBytes:bytes,requests:parsed.requests,objections:[{id:'wrong',text:'Wrong mapping'}]}), /match|unknown|request/i)
  await assert.rejects(readDiscoveryDocx(new TextEncoder().encode('Not a Word file'), 'rfp'), /Word|DOCX|zip|document/i)
})

test('new response document contains numbered requests, response spaces and selected objections', async () => {
  const {requests} = parseDiscoveryText('REQUEST FOR ADMISSION NO. 1: Admit receipt of the letter.', 'rfa')
  const bytes = await exportDiscoveryDocx({requests,objections:[]})
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')
  assert.match(xml,/Admit receipt/)
  assert.match(xml,/RESPONSE:/)
  assert.doesNotMatch(xml,/OBJECTION:/)
})
