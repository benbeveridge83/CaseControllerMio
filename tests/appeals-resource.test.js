import test from 'node:test'
import assert from 'node:assert/strict'

// These checks protect the research behaviors: hidden authorities remain
// searchable, combined filters do not leak results, and stored data is bounded.
const model = await import('../src/appeals/appealsModel.js').catch(() => ({}))
const issues = [
  { id: 'danger', category: 'predicates', title: 'Endangerment', summary: 'Conduct evidence', rule: 'A course of conduct.', appellant: ['Address rehabilitation.'], appellee: ['Identify continuing risk.'], preservation: 'Bench and jury differ.', review: 'Clear and convincing', record: ['Trial transcript'], remedy: 'Rendition or remand', cautions: ['Use the controlling version.'], tags: ['D/E'], authorities: [{ label: 'In re N.G.', citation: '577 S.W.3d 230', proposition: 'Collateral consequences', url: 'https://www.txcourts.gov/opinion' }] },
  { id: 'record', category: 'reporter-record', title: 'Missing record', summary: 'Reconstruct testimony', rule: 'Four requirements.', appellant: ['Establish no fault.'], appellee: ['Demonstrate replacement.'], preservation: 'Timely request', review: 'Rule 34.6(f)', record: ['Reporter affidavit'], remedy: 'New trial if all requirements met', cautions: [], tags: ['lost'], authorities: [] },
]

test('search finds case names, citations, and text inside an unopened issue', () => {
  assert.equal(typeof model.filterAppealIssues, 'function')
  assert.deepEqual(model.filterAppealIssues(issues, { query: 'N.G. collateral' }).map(x => x.id), ['danger'])
  assert.deepEqual(model.filterAppealIssues(issues, { query: '577 S.W.3d 230' }).map(x => x.id), ['danger'])
  assert.deepEqual(model.filterAppealIssues(issues, { query: 'reporter affidavit' }).map(x => x.id), ['record'])
})

test('section and saved filters compose with search and an empty shortlist stays empty', () => {
  assert.equal(typeof model.filterAppealIssues, 'function')
  assert.equal(model.filterAppealIssues(issues, { query: 'conduct', category: 'reporter-record' }).length, 0)
  assert.equal(model.filterAppealIssues(issues, { savedOnly: true, savedIds: [] }).length, 0)
  assert.deepEqual(model.filterAppealIssues(issues, { savedOnly: true, savedIds: ['record'] }).map(x => x.id), ['record'])
  assert.equal(model.filterAppealIssues(issues, { query: '   ' }).length, 2)
})

test('bookmark parsing handles corruption, wrong shapes, duplicate IDs and removed issues', () => {
  assert.equal(typeof model.parseSavedIssueIds, 'function')
  for (const raw of ['{broken', 'null', '{}', '"danger"', null]) assert.deepEqual(model.parseSavedIssueIds(raw, ['danger', 'record']), [])
  assert.deepEqual(model.parseSavedIssueIds('["danger","danger",42,"removed","record"]', ['danger', 'record']), ['danger', 'record'])
})

test('issue text retains preservation, remedy and source URLs for both sides or one side', () => {
  assert.equal(typeof model.buildIssueText, 'function')
  const both = model.buildIssueText(issues[0], 'both')
  for (const expected of ['Address rehabilitation.', 'Identify continuing risk.', 'Bench and jury differ.', 'Rendition or remand', 'https://www.txcourts.gov/opinion']) assert.ok(both.includes(expected), expected)
  assert.ok(!model.buildIssueText(issues[0], 'appellant').includes('Identify continuing risk.'))
  assert.ok(!model.buildIssueText(issues[0], 'appellee').includes('Address rehabilitation.'))
})
