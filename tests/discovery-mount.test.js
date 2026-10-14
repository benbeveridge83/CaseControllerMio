import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import mount from '../mio-discovery-objections-mount.js'
test('mount adds a staff-only route, sidebar link and Discovery entry button to the existing app',()=>{
  const result=mount().transform(fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8'),'/src/App.jsx')
  assert.match(result.code,/import\('\.\/DiscoveryObjections\.jsx'\)/)
  assert.match(result.code,/page === 'discovery_objections'.*isFirmStaffMember\(\)/)
  assert.match(result.code,/Discovery objection walkthrough →/)
  assert.match(result.code,/value: 'discovery_objections'/)
})
