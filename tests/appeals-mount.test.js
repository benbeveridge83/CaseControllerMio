import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('appeals mount adds a staff-only sidebar and route without replacing existing discovery', async () => {
  const { applyAppealsMount } = await import('../mio-dfps-appeals-mount.js').catch(() => ({}))
  assert.equal(typeof applyAppealsMount, 'function')
  const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const code = applyAppealsMount(source)
  assert.ok(code.includes("{ value: 'dfps_appeals', label: 'DFPS / CPS Appeals' }"))
  assert.ok(code.includes("canOpenPage('dfps_appeals') && isFirmStaffMember()"))
  assert.ok(code.includes("page === 'dfps_appeals' && canOpenPage('dfps_appeals') && isFirmStaffMember()"))
  assert.ok(code.includes('<MioAppealsResource key={session.user.id} userId={session.user.id} />'))
  assert.ok(code.includes("page === 'discovery' && canOpenPage('discovery')"))
  assert.throws(() => applyAppealsMount(code), /already mounted/)
  assert.throws(() => applyAppealsMount(source.replace("{ value: 'discovery', label: 'Discovery' },", '')), /anchor changed/)
})
