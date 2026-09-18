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

test('Paralegal import preserves the existing Vite checklist repair import anchor', () => {
  const source = readFileSync(new URL('../src/App.jsx', import.meta.url),'utf8')
  const anchor = "import { createPortal } from 'react-dom'\nimport { supabase } from './supabaseClient'\nimport * as XLSX from 'xlsx'\n\nconst MIO_APP_VERSION = 'Mio V267'"
  assert.match(source, /import React[^\n]+\nimport ParalegalPanel from '.\/paralegal\/ParalegalPanel\.jsx'\nimport \{ createPortal \} from 'react-dom'/)
  assert.equal(source.includes(anchor), true)
})
