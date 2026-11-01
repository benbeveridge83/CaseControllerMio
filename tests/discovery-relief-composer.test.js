import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformWithOxc } from 'vite'
import { composeOutgoingRequests } from '../src/discoveryRelief/compose.js'
import { discoveryTypeLabel } from '../src/discoveryRelief/types.js'
import { SEED_GENERAL, SEED_LIBRARY, SEED_MAPPINGS } from '../src/discoveryRelief/seed.js'

const source = fs.readFileSync(new URL('../src/discoveryRelief/DiscoveryReliefComposer.jsx', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export function /m, 'function ')

const groups = [
  { id: 'g-possession', kind: 'relief', label: 'Possession — 50/50', issue_id: 'rr-possession-access', option_id: 'rr-possession-schedule', source_side: 'ours', roles: { responding: 'Opposing Party' } },
  { id: 'g-support', kind: 'relief', label: 'Support — neither parent pays', issue_id: 'rr-support', option_id: 'rr-support', source_side: 'ours', roles: { responding: 'Opposing Party' } },
  { id: 'g-general', kind: 'general', label: 'General discovery', source_side: 'ours' }
]

test('the composer renders relief groups, requests, and the General group', async () => {
  const compiled = await transformWithOxc(source, 'DiscoveryReliefComposer.jsx', { jsx: { runtime: 'classic' } })
  const context = { React, composeOutgoingRequests, discoveryTypeLabel }
  vm.createContext(context)
  vm.runInContext(compiled.code, context)

  const html = renderToStaticMarkup(React.createElement(context.DiscoveryReliefComposer, {
    groups, mappings: SEED_MAPPINGS, library: SEED_LIBRARY, general: SEED_GENERAL
  }))
  assert.match(html, /Possession — 50\/50/)
  assert.match(html, /Support — neither parent pays/)
  assert.match(html, /General discovery/)
  assert.match(html, /RFP: 4/)
  assert.match(html, /Roggs: 4/)
})

test('a shared request is rendered once and grayed as a duplicate under the other relief', async () => {
  const compiled = await transformWithOxc(source, 'DiscoveryReliefComposer.jsx', { jsx: { runtime: 'classic' } })
  const context = { React, composeOutgoingRequests, discoveryTypeLabel }
  vm.createContext(context)
  vm.runInContext(compiled.code, context)

  // The same income item is mapped to both support and possession.
  const sharedMappings = [
    { issue_id: 'rr-support', source_side: 'ours', library_item_id: 'lib-support-income' },
    { issue_id: 'rr-possession-access', source_side: 'ours', library_item_id: 'lib-support-income' }
  ]
  const sharedLibrary = [
    { id: 'lib-support-income', type: 'rfp', text: 'Produce all documents reflecting your income and earning capacity for the last twelve months.' }
  ]
  const html = renderToStaticMarkup(React.createElement(context.DiscoveryReliefComposer, {
    groups, mappings: sharedMappings, library: sharedLibrary, general: []
  }))
  assert.match(html, /Included once as RFP 1/)
  assert.match(html, /data-duplicate="true"/)
  // The income request appears only once as a live request.
  const liveRequests = html.match(/Produce all documents reflecting your income/g) || []
  assert.equal(liveRequests.length, 2) // one live + one muted reference text
})
