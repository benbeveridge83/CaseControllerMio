import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeCategories, normalizeCategory, labelFor, EMAIL_CATEGORIES } from '../lib/email/categories.js'
import { matterContactEmails, buildMatterIndex, matchMessageToMatters, messageAddresses, matterDisplayName } from '../lib/email/matching.js'
import { selectedFolderIdsFor, isFolderSelected, applyFolderFilter, normalizeFolderSettings } from '../lib/email/folders.js'
import { setResolved, isResolved, categoryStatesFor, toIndex, isFullyResolved, openCount } from '../lib/email/resolution.js'
import { keywordClassify } from '../lib/email/classify.js'

test('categories: normalize, multi-category, and fallback', () => {
  assert.equal(normalizeCategory('Orders'), 'orders')
  assert.equal(normalizeCategory('bogus'), 'general')
  assert.deepEqual(normalizeCategories(['orders', 'settings']), ['orders', 'settings'])
  assert.deepEqual(normalizeCategories([]), ['general'])
  assert.deepEqual(normalizeCategories(['orders', 'bogus']), ['orders', 'general'])
  assert.deepEqual(EMAIL_CATEGORIES, ['orders', 'settings', 'general'])
  assert.equal(labelFor('orders'), 'Orders')
})

test('matching: client and opposing counsel emails resolve to a matter', () => {
  const matter = {
    id: 'm1',
    name: 'Bay',
    clients: { first_name: 'Jane', last_name: 'Doe', email: 'jane@client.com' },
    extra_info: { opposing_parties: [{ name: 'Opp', email: 'opp@law.com', counsel: { name: 'Counsel', email: 'counsel@law.com' } }] },
  }
  assert.equal(matterDisplayName(matter), 'Bay')
  const contacts = matterContactEmails(matter)
  assert.ok(contacts.some((c) => c.email === 'jane@client.com' && c.kind === 'client'))
  assert.ok(contacts.some((c) => c.email === 'counsel@law.com' && c.kind === 'opposing_counsel'))

  const index = buildMatterIndex([matter])
  const clientMsg = { from: { emailAddress: { address: 'jane@client.com' } }, toRecipients: [], ccRecipients: [] }
  const clientMatch = matchMessageToMatters(clientMsg, [matter], index)
  assert.equal(clientMatch.length, 1)
  assert.equal(clientMatch[0].matterName, 'Bay')
  assert.equal(clientMatch[0].isClient, true)

  const counselMsg = { from: { emailAddress: { address: 'counsel@law.com' } }, toRecipients: [], ccRecipients: [] }
  const counselMatch = matchMessageToMatters(counselMsg, [matter], index)
  assert.equal(counselMatch[0].isOpposing, true)
})

test('matching: messageAddresses normalizes from/to/cc', () => {
  const msg = {
    from: { emailAddress: { address: 'From <from@x.com>' } },
    toRecipients: [{ emailAddress: { address: 'to@x.com' } }],
    ccRecipients: [{ emailAddress: { address: 'cc@x.com' } }],
  }
  const a = messageAddresses(msg)
  assert.equal(a.from, 'from <from@x.com>')
  assert.deepEqual(a.to, ['to@x.com'])
  assert.deepEqual(a.cc, ['cc@x.com'])
  assert.ok(a.all.includes('to@x.com'))
})

test('folders: all, none, and partial selections filter the message set', () => {
  const settings = { 'service@beveridgelawfirm.com': ['inbox', 'sub1'], 'office@beveridgelawfirm.com': [] }
  assert.equal(selectedFolderIdsFor(settings, 'service@beveridgelawfirm.com').size, 2)
  assert.equal(isFolderSelected(settings, 'service@beveridgelawfirm.com', 'sub1'), true)
  assert.equal(isFolderSelected(settings, 'service@beveridgelawfirm.com', 'none'), false)
  assert.equal(isFolderSelected(settings, 'office@beveridgelawfirm.com', 'inbox'), false)

  const messages = [
    { id: '1', accountEmail: 'service@beveridgelawfirm.com', folderId: 'inbox' },
    { id: '2', accountEmail: 'service@beveridgelawfirm.com', folderId: 'other' },
    { id: '3', accountEmail: 'office@beveridgelawfirm.com', folderId: 'inbox' },
  ]
  assert.deepEqual(applyFolderFilter(messages, settings).map((m) => m.id), ['1'])
  assert.deepEqual(applyFolderFilter(messages, {}), [])

  const normalized = normalizeFolderSettings([
    { account_email: 'service@beveridgelawfirm.com', folder_id: 'inbox', enabled: true },
    { account_email: 'service@beveridgelawfirm.com', folder_id: 'junk', enabled: false },
  ])
  assert.deepEqual(normalized['service@beveridgelawfirm.com'], ['inbox'])
})

test('resolution: independent per category and survives a reload reindex', () => {
  let resolutions = {}
  resolutions = setResolved(resolutions, 'msg1', 'orders', true, '2026-01-01T00:00:00Z')
  assert.equal(isResolved(resolutions, 'msg1', 'orders'), true)
  assert.equal(isResolved(resolutions, 'msg1', 'settings'), false)

  const reindexed = toIndex([
    { message_id: 'msg1', category: 'orders', resolved: true, resolved_at: '2026-01-01T00:00:00Z' },
  ])
  assert.equal(isResolved(reindexed, 'msg1', 'orders'), true)
  assert.equal(isResolved(reindexed, 'msg1', 'settings'), false)
  assert.equal(openCount('msg1', ['orders', 'settings'], reindexed), 1)

  assert.equal(isFullyResolved({ id: 'msg1' }, ['orders'], reindexed), true)
  assert.equal(isFullyResolved({ id: 'msg1' }, ['orders', 'settings'], reindexed), false)

  const states = categoryStatesFor({ id: 'msg1' }, ['orders', 'settings'], reindexed)
  assert.deepEqual(states.map((s) => s.resolved), [true, false])
})

test('classify keyword fallback assigns orders/settings/general and multiple categories', () => {
  assert.ok(keywordClassify('Proposed Order for signature', 'Please sign.').categories.includes('orders'))
  assert.ok(keywordClassify('Hearing setting for Monday', 'We need a setting.').categories.includes('settings'))
  const both = keywordClassify('Proposed order and hearing setting', 'Dual-purpose email.')
  assert.ok(both.categories.includes('orders') && both.categories.includes('settings'))
  assert.deepEqual(keywordClassify('hello', 'how are you').categories, ['general'])
})

test('email dashboard mount adds a staff-only page, nav, and route', async () => {
  const { applyEmailDashboardMount } = await import('../mio-v331-email-dashboard.js')
  const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const code = applyEmailDashboardMount(source)
  assert.ok(code.includes("{ value: 'email', label: 'Email Dashboard' }"))
  assert.ok(code.includes("canOpenPage('email') && isFirmStaffMember()"))
  assert.ok(code.includes("page === 'email' && canOpenPage('email') && isFirmStaffMember()"))
  assert.ok(code.includes("const MioEmailDashboard = emailLazy(() => import('./email/EmailDashboard.jsx'))"))
  assert.ok(code.includes("<MioEmailDashboard key={session.user.id} userId={session.user.id} />"))
  assert.ok(code.includes("page === 'discovery' && canOpenPage('discovery')"))
  assert.throws(() => applyEmailDashboardMount(code), /already mounted/)
})

