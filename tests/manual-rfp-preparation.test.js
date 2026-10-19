import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import * as preparation from '../src/manualRfpPreparation.js'

test('bulk conversion preserves identity, names and original reference; failure leaves the source intact', async () => {
  const originals = [
    { id: '1', matter_id: 'm', name: '2023 wages', file_name: '2023 W2.JPG', file_path: 'original.jpg', tag_ids: ['tax'] },
    { id: '2', name: 'Failed file', file_name: 'bad.png', file_path: 'bad.png' },
    { id: '3', name: 'Already PDF', file_name: 'done.PDF' },
    { id: '4', name: 'Video', file_name: 'visit.mp4' },
  ]
  const saved = [], progress = []
  const result = await preparation.convertRfpDocuments(originals, {
    convert: async () => new Uint8Array([1, 2]),
    upload: async (bytes, name, doc) => doc.id === '2' ? {} : { file_path: 'converted.pdf', file_name: name },
    archive: async doc => doc,
    onConverted: doc => saved.push(doc),
    onProgress: value => progress.push(value),
  })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].id, '1')
  assert.equal(saved[0].name, '2023 wages')
  assert.equal(saved[0].file_name, '2023 W2.pdf')
  assert.deepEqual(saved[0].tag_ids, ['tax'])
  assert.equal(saved[0].pdf_conversion_source.file_path, 'original.jpg')
  assert.equal(saved[0].file_path, 'converted.pdf')
  assert.equal(originals[0].file_path, 'original.jpg')
  assert.equal(result.failed.length, 1)
  assert.equal(result.skipped.length, 2)
  assert.equal(progress.at(-1).completed, 4)
})

test('conversion drops obsolete file URLs and never persists bytes inside original metadata', async () => {
  const [doc] = (await preparation.convertRfpDocuments([{ id: '1', file_name: 'scan.png', file_data: 'data:old', file_url: 'blob:old' }], {
    convert: async () => new Uint8Array([1]), archive: async doc => ({ ...doc, file_path: 'archived.png' }),
    upload: async () => ({ file_path: 'new.pdf' }),
  })).converted
  assert.equal(doc.file_data, undefined)
  assert.equal(doc.file_url, undefined)
  assert.equal(doc.pdf_conversion_source.file_data, undefined)
  assert.equal(doc.pdf_conversion_source.file_path, 'archived.png')
})

test('cover sheets keep the full native filename and generate a genuine Word document', async () => {
  const sheet = preparation.createRfpCoverDraft({ id: 'video', name: 'Exchange video', file_name: 'Exchange & pickup <original>.mp4', file_size: 1234 })
  sheet.description = 'Video of the exchange.\nProvided separately.'
  const settings = { ...preparation.DEFAULT_RFP_COVER_SETTINGS, headingSize: 32, topInches: 2, bold: true }
  const bytes = await preparation.buildRfpCoverDocx(sheet, settings)
  const zip = await JSZip.loadAsync(bytes)
  const xml = await zip.file('word/document.xml').async('string')
  assert.match(xml, /Exchange &amp; pickup &lt;original&gt;\.mp4/)
  assert.match(xml, /w:sz w:val="64"/)
  assert.match(xml, /w:top="2880"/)
  assert.match(xml, /w:jc w:val="center"/)
  assert.match(xml, /<w:b\/>/)
  assert.match(xml, /Provided separately/)
  assert.ok(zip.file('[Content_Types].xml'))
})

test('converted records invalidate stale Bates copies across jobs without changing assignments or pools', () => {
  const job = { requests: [{ assigned_document_ids: ['1'] }], document_pools: [{ document_ids: ['1'] }], bates_by_document: { 1: { start: 1 }, 2: { start: 9 } }, export_file_names: { 1: 'tax-return.jpg' } }
  const updated = preparation.invalidateRfpConvertedFiles(job, ['1'])
  assert.deepEqual(updated.requests, job.requests)
  assert.deepEqual(updated.document_pools, job.document_pools)
  assert.equal(updated.bates_by_document['1'], undefined)
  assert.deepEqual(updated.bates_by_document['2'], { start: 9 })
  assert.equal(updated.export_file_names['1'], 'tax-return.pdf')
})

test('Word text extraction keeps paragraphs and table cells and decodes XML entities', async () => {
  const zip = new JSZip()
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Taxes &amp; wages</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>2023</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>$500</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
  const text = await preparation.extractRfpDocxText(await zip.generateAsync({ type: 'uint8array' }))
  assert.match(text, /Taxes & wages\n/)
  assert.match(text, /2023[\s\S]*\$500/)
})
