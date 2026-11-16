import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { transformWithOxc } from 'vite'
import React from 'react'
import { applyRequestedReliefSettings } from '../mio-requested-relief-settings.js'

// Exercise the actual Settings JSX and button callbacks without booting the
// unrelated network-backed application. Only the modal's contents are stubbed.
const raw = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const app = applyRequestedReliefSettings(raw)
const start = app.indexOf('  function renderRequestedReliefSettings()')
const end = app.indexOf('\n  function ', start + 1)
const code = (await transformWithOxc(app.slice(start, end), 'settings.jsx', { jsx: { runtime: 'classic' } })).code
const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(flatten)]
for (const label of ['+ New Template', 'Open / Edit Template']) {
  test(`Settings ${label} displays the template editor`, () => {
    let open = false, selected
    const template = { id: 'test-template', name: 'Synthetic template' }
    const context = {
      React, requestedReliefOptionForm: {}, activeRequestedReliefOptions: () => [],
      requestedReliefSettingsView: 'templates', requestedReliefTemplates: [template],
      openRequestedReliefTemplateEditor: value => { open = true; selected = value },
      renderRequestedReliefBuilderModal: () => open ? React.createElement('dialog', {}, 'Template editor') : null,
    }
    vm.createContext(context)
    vm.runInContext(code, context)
    const render = () => flatten(context.renderRequestedReliefSettings())
    assert.equal(render().filter(n => n.type === 'dialog').length, 0)
    render().find(n => n.type === 'button' && n.props.children === label).props.onClick()
    assert.equal(selected, label === '+ New Template' ? null : template)
    assert.equal(render().filter(n => n.type === 'dialog').length, 1, 'Editor must be mounted on Settings after clicking')
  })
}

test('mount is idempotent and rejects a changed anchor', () => {
  assert.equal(applyRequestedReliefSettings(app), app)
  assert.throws(() => applyRequestedReliefSettings(''), /anchor changed/)
})
