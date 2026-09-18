import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync,readFileSync} from 'node:fs'

test('Need to Set source mounts Paralegal and builds its snapshot from the same workflow rows', () => {
  const source = readFileSync(new URL('../src/App.jsx', import.meta.url),'utf8')
  assert.match(source, /import ParalegalPanel from '.\/paralegal\/ParalegalPanel\.jsx'/)
  assert.match(source, /function needToSetParalegalSnapshot\(/)
  assert.match(source, /filteredChecklistEvents\('need_date'\)/)
  assert.match(source, /<ParalegalPanel[^>]+getSnapshot=\{needToSetParalegalSnapshot\}/)
})

test('Paralegal panel presents a read-only Need to Set conversation surface', () => {
  const url = new URL('../src/paralegal/ParalegalPanel.jsx', import.meta.url)
  assert.equal(existsSync(url), true)
  const source = readFileSync(url,'utf8')
  assert.match(source,/Paralegal/)
  assert.match(source,/read-only/i)
  assert.match(source,/Ask about Need to Set/i)
  assert.match(source,/askParalegal/)
})
