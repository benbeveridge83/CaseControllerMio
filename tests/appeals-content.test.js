import test from 'node:test'
import assert from 'node:assert/strict'
import { APPEAL_SECTIONS } from '../src/appeals/appealsSections.js'

const catalog = await import('../src/appeals/appealsCatalog.js').catch(() => ({}))

test('research catalog covers every section with complete, uniquely identified issue guides', () => {
  const issues = catalog.APPEAL_ISSUES
  assert.ok(Array.isArray(issues) && issues.length > 0, 'researched catalog is loaded')
  assert.equal(new Set(issues.map(issue => issue.id)).size, issues.length, 'issue IDs are unique')
  for (const section of APPEAL_SECTIONS) assert.ok(issues.some(issue => issue.category === section.id), `${section.label} is covered`)
  for (const issue of issues) {
    assert.ok(APPEAL_SECTIONS.some(section => section.id === issue.category), issue.id)
    assert.match(issue.id, /^[a-z0-9-]+$/)
    for (const field of ['title', 'subcategory', 'summary', 'rule', 'preservation', 'review', 'remedy']) assert.ok(typeof issue[field] === 'string' && issue[field].trim(), `${issue.id}: ${field}`)
    for (const field of ['appellant', 'appellee', 'record']) assert.ok(Array.isArray(issue[field]) && issue[field].length && issue[field].every(x => typeof x === 'string' && x.trim()), `${issue.id}: ${field}`)
    for (const field of ['cautions', 'tags']) assert.ok(Array.isArray(issue[field]) && issue[field].every(x => typeof x === 'string'), `${issue.id}: ${field}`)
    assert.ok(issue.authorities.length > 0, `${issue.id}: governing authority`)
    for (const authority of issue.authorities) {
      for (const field of ['label', 'citation', 'proposition']) assert.ok(typeof authority[field] === 'string' && authority[field].trim(), `${issue.id}: authority ${field}`)
      const url = new URL(authority.url)
      assert.equal(url.protocol, 'https:', `${issue.id}: secure source link`)
      assert.ok(['statute', 'rule', 'case', 'guide'].includes(authority.type), `${issue.id}: source type`)
    }
  }
})

test('catalog expressly identifies statutory transitions and the newer appellate safeguards', () => {
  assert.ok(catalog.APPEAL_ISSUES?.length)
  const text = JSON.stringify(catalog.APPEAL_ISSUES)
  for (const authority of ['H.B. 116', 'J.D.H.', 'H.S.', 'N.G.', 'Holley']) assert.ok(text.includes(authority), authority)
  assert.match(text, /former.{0,50}\(O\)/i)
  assert.match(text, /161\.001\(f\)/)
})


test('CLE updates preserve current statutory transitions and local appellate conflicts', () => {
  const issues = catalog.APPEAL_ISSUES
  assert.ok(issues.length >= 162, 'supplemental issue guides joined the searchable catalog')
  const find = id => issues.find(issue => issue.id === id)
  for (const id of ['supp-icwa-concurrent-findings', 'supp-de-novo-witnesses', 'supp-withdrawn-jury-demand', 'supp-minor-parent-service', 'supp-foster-adoption-standing-2025', 'supp-ts-best-interest', 'supp-ldw-absent-service-plan', 'supp-brief-38-checklist']) {
    assert.ok(find(id), id)
  }
  assert.match(find('supp-icwa-concurrent-findings').rule, /fourteenth|four sister/i)
  assert.match(find('merits-icwa-serious-damage-expert').rule, /disagree/i)
  assert.match(find('supp-foster-adoption-standing-2025').rule, /H\.B\. 2350/)
  assert.match(find('supp-ldw-absent-service-plan').cautions.join(' '), /former.*O|2025/i)
  assert.match(find('supp-ts-best-interest').cautions.join(' '), /September 27, 2022/)
})
