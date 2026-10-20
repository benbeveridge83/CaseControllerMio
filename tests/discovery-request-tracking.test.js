import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformWithOxc } from 'vite'

const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
function functionSource(name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'))
  if (start < 0) return ''
  return source.slice(start, source.indexOf('\n  }', start) + 4)
}
const request = (id, matter = 'matter-a', type = 'rfp', side = 'theirs') => ({
  id, matter_id: matter, name: `${id} request`, tag_ids: [], litigation_track_id: `track-${matter}`,
  discovery_side: side, discovery_type: type, document_field_values: {}, is_active: true
})
function fixture(docs = [], options = {}) {
  const prompts = [], alerts = [], uploads = []
  const state = {
    documents: structuredClone(docs), litigationPlacements: options.placements || [], discoveryRequests: options.requests || [], discoverySideFilter: 'their',
    deletedDiscoveryRowIds: [], DISCOVERY_TRACK_TYPES: ['rfp', 'rfd', 'roggs', 'rfa'].map(id => ({ id, short: id.toUpperCase() })),
    tagFullName: id => id, discoveryStatusFilterValues: () => ['Open'],
    discoveryDocumentMatter: doc => ({ id: doc.matter_id, matter_status: 'Open', case_status: 'Open' }),
    discoveryTrialDateForDoc: () => null, discoveryThirtyDaysBeforeTrial: () => null,
    discoveryDocServiceDate: () => '', discoveryDocResponseDueDate: () => '', discoveryDateDisplay: v => v,
    dateToInputValue: () => '2026-10-20', formatMatterOption: m => m.id, matterName: id => id,
    sortedDiscoveryRows: rows => rows, discoveryLegacyRequestToTrackingRow: r => ({ ...r, legacyRequest: r }),
    confirm: message => { prompts.push(message); return options.confirm ?? false }, alert: message => alerts.push(message),
    litigationTrackForId: id => ['matter-a', 'matter-b', 'other'].map(matter_id => ({ id: `track-${matter_id}`, matter_id, type: 'discovery' })).find(track => track.id === id),
    withLitigationAssignment: (row, patch) => ({ ...row, ...patch }),
    ensureLitigationPlacementShape: row => row, LITIGATION_TRACK_ROOT_TAG_ID: 'track-root', litigationTrackTagId: id => id,
    setLitigationPlacements: updater => { state.litigationPlacements = updater(state.litigationPlacements) },
    withEmptyDocumentAiReview: row => row, tagAndParentIds: ids => ids,
    isLitigationTrackTagId: () => false, isTagAvailableForMatter: () => true,
    normalizeTagSelectionForToggle: (ids, id) => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id],
    uploadMioDocumentFile: async (...args) => { uploads.push(args); return {} }, readFileAsDataUrl: async () => ({}),
    serviceEmailRowCategory: () => 'notification_service', noticeServiceDocumentType: () => '', acceptedServiceDocumentType: () => '',
    isClientPortalMember: () => false, bulkSelectedTagIds: [], setBulkDocumentRows: () => {},
    closeDocumentEditWindow: () => {}, setDocumentForm: () => {},
    setDocuments: updater => { state.documents = typeof updater === 'function' ? updater(state.documents) : updater },
    ...options.state
  }
  vm.createContext(state)
  const names = ['normalizeDiscoveryTagPath', 'discoveryDocumentPathInfo', 'documentHasDiscoveryRequestSide',
    'discoveryDocRequestId', 'storedDiscoveryRequestForDoc', 'discoveryStoredDateOrDefault', 'discoveryDocumentTitle',
    'discoveryTypeForDoc', 'inferDiscoveryTypeFromDocument', 'discoveryRowDeleteKey', 'isDiscoveryRowDeleted', 'discoveryRows',
    'discoveryRequestAssignments', 'isDiscoveryResponseDocument', 'confirmDiscoveryRequestDocuments', 'saveDocumentEdit', 'toggleDocumentTag',
    'withLitigationAssignment', 'confirmServiceDiscoveryRequest', 'saveServicePdfViaLocalHelper', 'saveDownloadedServicePdf', 'addLitigationPlacement', 'applyTagsToDocuments', 'commitBulkRows', 'addDocument', 'updateSavedDocumentLitigation', 'updateDocumentCell']
  vm.runInContext(names.map(functionSource).join('\n'), state)
  return { state, prompts, alerts, uploads }
}

test('request tabs use Discovery tracks, side and type, independent of tags, preserving six requests and saved dates', () => {
  const six = ['matter-a', 'matter-b'].flatMap(matter => ['rfp', 'rfd', 'roggs'].map(type => request(`${matter}-${type}`, matter, type)))
  const uploads = Array.from({ length: 40 }, (_, i) => ({ id: `w2-${i}`, matter_id: 'matter-a', name: 'W2 - Bates copy', tag_ids: [], discovery_side: '', discovery_type: '', document_field_values: { discovery_note: '' } }))
  const ours = request('ours', 'matter-a', 'rfp', 'ours')
  const response = { ...request('response'), discovery_document_kind: 'response' }
  const tagOnly = { ...request('tag-only'), litigation_track_id: '', tag_ids: ['Case Filings > Discovery > Requests > RFP'] }
  const inactive = { ...request('inactive'), is_active: false }
  const requests = [{ id: 'saved', document_id: six[0].id, response_due: '2026-10-15', responses: [{ id: 'response-1' }] }, { id: 'orphan', matter_id: 'matter-a', side: 'their' }]
  const f = fixture([...six, ...uploads, ours, response, inactive, tagOnly], { requests })
  const rows = f.state.discoveryRows('their')
  assert.equal(rows.length, 6)
  assert.equal(rows[0].response_due, '2026-10-15')
  assert.equal(rows[0].responses[0].id, 'response-1')
  assert.equal(f.state.discoveryRows('our').length, 1)
  assert.equal(f.state.documents.length, 50, 'filtering must not delete documents')
})

test('editing a document to add a duplicate request asks before saving and Cancel preserves it', () => {
  const existing = request('first')
  const ordinary = { ...request('second'), litigation_track_id: '' }
  const f = fixture([existing, ordinary], { state: { editingDocumentId: 'second', documentEditForm: request('second') } })
  f.state.saveDocumentEdit({ preventDefault() {} })
  assert.equal(f.prompts.length, 1)
  assert.match(f.prompts[0], /first request/)
  assert.equal(f.state.documents[1].litigation_track_id, '')
})

test('bulk upload catches duplicates within the batch before uploading or saving files', async () => {
  const f = fixture()
  const result = await f.state.commitBulkRows([request('one'), { ...request('two'), file: { name: 'test.pdf' } }])
  assert.equal(result, false)
  assert.equal(f.prompts.length, 1)
  assert.equal(f.uploads.length, 0)
  assert.equal(f.state.documents.length, 0)
})

test('assigning a saved document to a duplicate request lane asks before saving', () => {
  const f = fixture([request('one'), { ...request('two'), litigation_track_id: '' }])
  f.state.updateSavedDocumentLitigation('two', { litigation_track_id: 'track-matter-a' })
  assert.equal(f.prompts.length, 1)
  assert.equal(f.state.documents[1].litigation_track_id, '')
})

test('confirming an intentional duplicate saves both documents', async () => {
  const f = fixture([request('one')], { confirm: true })
  assert.equal(await f.state.commitBulkRows([request('two')]), true)
  assert.equal(f.prompts.length, 1)
  assert.equal(f.state.documents.length, 2)
})

test('different matters, sides, types, unassigned documents and responses do not warn', async () => {
  const f = fixture([request('one')])
  const rows = [request('different-matter', 'other'), request('ours', 'matter-a', 'rfp', 'ours'), request('rfa', 'matter-a', 'rfa'),
    { ...request('unassigned'), litigation_track_id: '' }, { ...request('response'), discovery_document_kind: 'response' }]
  assert.equal(await f.state.commitBulkRows(rows), true)
  assert.equal(f.prompts.length, 0)
})

test('ordinary edits to existing intentional duplicates do not ask again', () => {
  const f = fixture([request('one'), request('two')], { state: { editingDocumentId: 'two', documentEditForm: { ...request('two'), date: '2026-10-20' } } })
  f.state.saveDocumentEdit({ preventDefault() {} })
  assert.equal(f.prompts.length, 0)
  assert.equal(f.state.documents[1].date, '2026-10-20')
})


test('drag-and-drop placements supply request membership and type without a primary assignment', () => {
  const doc = { ...request('placed'), litigation_track_id: '', discovery_side: '', discovery_type: '' }
  const placements = [{ document_id: doc.id, matter_id: 'matter-a', track_id: 'track-matter-a', discovery_side: 'ours', discovery_type: 'rfa', source: 'drag-drop' }]
  const f = fixture([doc], { placements })
  assert.equal(f.state.discoveryRows('our').length, 1)
  assert.equal(f.state.discoveryRows('our')[0].discovery_type, 'RFA')
  assert.equal(f.state.discoveryRows('their').length, 0)
})

test('stale primary placements, invalid types and cross-matter assignments cannot create rows', () => {
  const docs = [{ ...request('removed'), litigation_track_id: '' }, request('invalid', 'matter-a', 'other'), { ...request('wrong-matter'), litigation_track_id: 'track-other' }]
  const placements = [{ document_id: 'removed', matter_id: 'matter-a', track_id: 'track-matter-a', discovery_side: 'theirs', discovery_type: 'rfp', source: 'legacy-primary' }]
  assert.equal(fixture(docs, { placements }).state.discoveryRows('their').length, 0)
})

test('linked responses remain excluded even if they share the request track and type', () => {
  const requests = [{ id: 'r', document_id: 'one', responses: [{ document_id: 'response' }] }]
  const f = fixture([request('one'), request('response')], { requests })
  assert.equal(f.state.discoveryRows('their').length, 1)
})

test('a document in duplicate primary/manual placements appears only once', () => {
  const doc = request('one')
  const placements = [{ document_id: doc.id, matter_id: 'matter-a', track_id: 'track-matter-a', discovery_side: 'theirs', discovery_type: 'rfp' }]
  assert.equal(fixture([doc], { placements }).state.discoveryRows('their').length, 1)
})


test('canceling a duplicate drag/drop leaves both placements and document metadata unchanged', () => {
  const f = fixture([request('one'), { ...request('two'), litigation_track_id: '' }])
  assert.equal(f.state.addLitigationPlacement({ documentId: 'two', matterId: 'matter-a', trackId: 'track-matter-a', discoverySide: 'theirs', discoveryType: 'rfp' }), false)
  assert.equal(f.prompts.length, 1)
  assert.equal(f.state.litigationPlacements.length, 0)
  assert.equal(f.state.documents[1].tag_ids.length, 0)
})

test('a confirmed drag/drop adds one placement and repeating it does not warn or duplicate it', () => {
  const f = fixture([request('one'), { ...request('two'), litigation_track_id: '' }], { confirm: true })
  const input = { documentId: 'two', matterId: 'matter-a', trackId: 'track-matter-a', discoverySide: 'theirs', discoveryType: 'rfp' }
  f.state.addLitigationPlacement(input)
  f.state.addLitigationPlacement(input)
  assert.equal(f.prompts.length, 1)
  assert.equal(f.state.litigationPlacements.length, 1)
})

test('canceling a duplicate Service Inbox save stops before external file writes', async () => {
  let writes = 0
  const row = { id: 'mail', suggested_matter_id: 'matter-a', litigation_track_id: 'track-matter-a', discovery_side: 'theirs', discovery_type: 'rfp' }
  const f = fixture([request('one')], { state: {
    serviceEmailRows: [row], resolveServiceEmailMatterId: () => 'matter-a', serviceEmailPathIsKnown: () => true,
    resolveServiceActualPdfFileName: () => ({ name: 'Second RFP.pdf' }), normalizeServicePdfBlob: async blob => blob,
    uploadServicePdfToOneDriveFolder: () => { writes++; throw new Error('Must not write on cancellation') },
    primaryServiceFilingLink: () => ({ url: 'https://example.invalid/file' }), serviceEmailSavePath: () => 'existing-folder',
    callMioLocalHelper: () => { writes++; throw new Error('Must not write on cancellation') }
  } })
  assert.equal(await f.state.saveDownloadedServicePdf(row, { blob: {} }), false)
  assert.equal(await f.state.saveServicePdfViaLocalHelper(row), false)
  assert.equal(f.prompts.length, 2)
  assert.equal(writes, 0)
})

test('Service Inbox responses do not prompt as requests', () => {
  const f = fixture([request('one')])
  assert.equal(f.state.confirmServiceDiscoveryRequest({ ...request('mail'), id: 'mail', suggested_matter_id: 'matter-a', discovery_document_kind: 'response' }, 'Response.pdf'), true)
  assert.equal(f.prompts.length, 0)
})


test('service preflight uses the same inferred type and latest batch catalog as the saved document', () => {
  const f = fixture()
  const row = { id: 'mail', suggested_matter_id: 'matter-a', litigation_track_id: 'track-matter-a', discovery_side: 'theirs', notice_service_type: 'Request for Production' }
  assert.equal(f.state.confirmServiceDiscoveryRequest(row, 'Document.pdf', [request('previous-batch-file')]), false)
  assert.equal(f.prompts.length, 1)
})

test('the actual shared assignment form renders the request/response choice', async () => {
  const f = fixture()
  f.state.React = React
  f.state.DISCOVERY_TRACK_SIDES = [{ id: 'ours', name: 'Our Requests' }, { id: 'theirs', name: 'Their Requests' }]
  f.state.litigationTracksForMatter = () => [{ id: 'track-matter-a', matter_id: 'matter-a', type: 'discovery', name: 'Discovery' }]
  f.state.LabeledField = ({ label, children }) => React.createElement('label', null, label, children)
  const compiled = await transformWithOxc(functionSource('renderLitigationAssignmentFields'), 'assignment.jsx', { jsx: { runtime: 'classic' } })
  vm.runInContext(compiled.code, f.state)
  const html = renderToStaticMarkup(f.state.renderLitigationAssignmentFields({ ...request('response'), discovery_document_kind: 'response' }, () => {}))
  assert.match(html, /Discovery document/)
  assert.match(html, /value="response" selected=""/)
})
