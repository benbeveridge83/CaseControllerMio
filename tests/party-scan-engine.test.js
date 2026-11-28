// Synthetic data only. No sign-in, production reads, or network writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyPleading,
  normalizeRole,
  normalizeAttorneyType,
  nameKey,
  parseDocumentDate,
  extractDocumentParties,
  selectLatestPleadings,
  buildScanProposals
} from '../src/partyScan/partyScanEngine.js'

test('classifyPleading uses filename hints', () => {
  assert.equal(classifyPleading({ fileName: 'Original Petition.pdf' }).kind, 'petition')
  assert.equal(classifyPleading({ fileName: 'First Amended Petition.pdf' }).kind, 'amended_petition')
  assert.equal(classifyPleading({ fileName: 'Counterpetition.pdf' }).kind, 'counterpetition')
  assert.equal(classifyPleading({ fileName: 'Amended Answer.pdf' }).kind, 'amended_answer')
  assert.equal(classifyPleading({ fileName: 'Order Granting Motion.pdf' }).kind, 'order')
  assert.equal(classifyPleading({ fileName: 'Notice of Service.pdf' }).kind, 'service_notice')
})

test('classifyPleading prefers document text over filename', () => {
  const result = classifyPleading({ fileName: 'Document.pdf', text: 'ORIGINAL PETITION FOR DIVORCE' })
  assert.equal(result.kind, 'petition')
  assert.equal(result.method, 'text')
})

test('normalizeRole keeps the original petitioner tier and respondent tier', () => {
  assert.equal(normalizeRole('Petitioner'), 'Petitioner')
  assert.equal(normalizeRole('Respondent'), 'Respondent')
  assert.equal(normalizeRole('Counter-Petitioner'), 'Respondent / Counter-Petitioner')
  assert.equal(normalizeRole('Cross-Petitioner'), 'Respondent / Cross-Petitioner')
  assert.equal(normalizeRole('Petitioner / Counter-Respondent'), 'Petitioner / Counter-Respondent')
  assert.equal(normalizeRole('Respondent / Cross-Petitioner'), 'Respondent / Cross-Petitioner')
  assert.equal(normalizeRole('child'), 'Children')
})

test('normalizeAttorneyType maps to the seeded vocabulary', () => {
  assert.equal(normalizeAttorneyType("Party's Attorney"), 'Party Attorney')
  assert.equal(normalizeAttorneyType('Party Attorney'), 'Party Attorney')
  assert.equal(normalizeAttorneyType('Attorney ad Litem'), 'Attorney ad Litem')
  assert.equal(normalizeAttorneyType('Guardian ad Litem'), 'Guardian ad Litem')
  assert.equal(normalizeAttorneyType('Amicus Attorney'), 'Amicus Attorney')
})

test('nameKey normalizes for dedupe', () => {
  assert.equal(nameKey('  Jane  Doe, '), 'jane doe')
  assert.equal(nameKey('JANE DOE'), nameKey('jane doe'))
})

test('parseDocumentDate reads ISO and US filenames and phrase dates', () => {
  assert.equal(parseDocumentDate({ fileName: 'Petition 2024-05-02.pdf' }), '2024-05-02')
  assert.equal(parseDocumentDate({ fileName: 'Answer 05-02-2024.pdf' }), '2024-05-02')
  assert.equal(parseDocumentDate({ fileName: 'x.pdf', text: 'signed this June 3, 2024' }), '2024-06-03')
})
test('extractDocumentParties reads caption, children, and signature block', () => {
  const text = [
    'NO. 2024-12345',
    'IN THE MATTER OF THE MARRIAGE OF JANE DOE AND JOHN DOE',
    'AND IN THE INTEREST OF SAM DOE, A CHILD',
    'IN THE DISTRICT COURT OF DALLAS COUNTY, TEXAS',
    '',
    'ORIGINAL PETITION FOR DIVORCE',
    '',
    'JANE DOE, Petitioner',
    'v.',
    'JOHN DOE, Respondent',
    '',
    'Respectfully submitted,',
    'Beveridge Law Firm, PLLC',
    'By: /s/ Ben Beveridge',
    'Ben Beveridge',
    'State Bar No. 24012345',
    'Attorney for Petitioner',
    'ben@example.com'
  ].join('\n')
  const parties = extractDocumentParties(text)
  const jane = parties.find((p) => nameKey(p.name) === 'jane doe')
  const john = parties.find((p) => nameKey(p.name) === 'john doe')
  const sam = parties.find((p) => nameKey(p.name) === 'sam doe')
  assert.ok(jane, 'extracts petitioner')
  assert.equal(jane.role, 'Petitioner')
  assert.ok(john, 'extracts respondent')
  assert.equal(john.role, 'Respondent')
  assert.ok(sam, 'extracts child')
  assert.equal(sam.role, 'Children')
  assert.equal(jane.attorney?.name, 'Ben Beveridge')
  assert.equal(jane.attorney?.email, 'ben@example.com')
  assert.equal(jane.attorneyType, 'Party Attorney')
})

test('selectLatestPleadings picks newest and flags uncertainty', () => {
  const docs = [
    { name: 'Original Petition.pdf', kind: 'petition', date: '2024-01-01', text: 'x', unreadable: false },
    { name: 'Amended Petition.pdf', kind: 'amended_petition', date: '2024-03-01', text: 'x', unreadable: false },
    { name: 'Counterpetition.pdf', kind: 'counterpetition', date: '', text: 'x', unreadable: false },
    { name: 'Answer.pdf', kind: 'answer', date: '2024-04-01', text: 'x', unreadable: false }
  ]
  const result = selectLatestPleadings(docs)
  assert.equal(result.petition.doc.name, 'Original Petition.pdf')
  assert.equal(result.amended_petition.doc.name, 'Amended Petition.pdf')
  assert.equal(result.counterpetition.doc.name, 'Counterpetition.pdf')
  assert.equal(result.counterpetition.uncertain, false)
  assert.equal(result.answer.doc.name, 'Answer.pdf')
})

test('buildScanProposals dedupes and flags conflicts without silent commits', () => {
  const docs = [{
    name: 'Original Petition.pdf',
    kind: 'petition',
    date: '2024-01-01',
    webUrl: 'https://example.test/petition.pdf',
    text: 'IN THE MATTER OF THE MARRIAGE OF JANE DOE AND JOHN DOE\nRespectfully submitted,\nBeveridge Law Firm, PLLC\nBen Beveridge\nAttorney for Petitioner\nben@example.com'
  }]
  const existingParties = [{ id: 'p1', name: 'John Doe', role: 'Petitioner', source: 'client' }]
  const result = buildScanProposals({ documents: docs, existingParties })
  assert.equal(result.summary.readable, 1)
  assert.equal(result.summary.unreadable, 0)
  assert.equal(result.proposals.length, 2)
  const john = result.proposals.find((p) => nameKey(p.name) === 'john doe')
  assert.ok(john.existing, 'matches existing party')
  assert.ok(john.conflict, 'flags role conflict for existing party')
  assert.equal(john.conflict.type, 'role')
})

test('buildScanProposals reports skipped and unreadable files', () => {
  const docs = [
    { name: 'a.pdf', kind: 'other', date: '', text: '', unreadable: true, unreadableReason: 'bad bytes', skipReason: '' },
    { name: 'b.xlsx', kind: 'other', date: '', text: '', unreadable: false, skipReason: 'Unsupported file type (.xlsx)' }
  ]
  const result = buildScanProposals({ documents: docs })
  assert.equal(result.summary.unreadable, 1)
  assert.equal(result.summary.skipped, 1)
  assert.equal(result.summary.proposals, 0)
})

