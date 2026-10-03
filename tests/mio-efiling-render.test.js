import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'
import { createMockEfilingProvider } from '../src/efiling/mioEfilingProvider.js'
import { createInMemoryEfilingRepository } from '../src/efiling/mioEfilingRepository.js'

const cssStub = {
  name: 'mio-test-css-stub',
  enforce: 'pre',
  resolveId(id) {
    if (id.endsWith('.css')) return '\0virtual:mio-css-stub'
  },
  load(id) {
    if (id === '\0virtual:mio-css-stub') return 'export default ""'
  },
}

test('e-filing draft review panel renders the shell, mock label, and safety-gated submit controls', async () => {
  const server = await createServer({ configFile: false, plugins: [cssStub, reactPlugin()], server: { host: '127.0.0.1' }, logLevel: 'silent' })
  try {
    const { default: MioEfilingPanel } = await server.ssrLoadModule('/src/efiling/MioEfilingPanel.jsx')
    const matter = {
      id: 'matter-1',
      cause_number: '2026-00001',
      court_name: '311th District Court',
      county: 'Harris',
      matter_type: 'Divorce',
      opposing_counsel_name: 'Opposing Counsel',
      opposing_counsel_email: 'oc@example.test',
    }
    const documents = [{ id: 'doc-1', file_name: 'motion.pdf' }]
    const filer = { userId: 'user-1', name: 'Ben Attorney', barNumber: '24000000' }
    const html = renderToStaticMarkup(React.createElement(MioEfilingPanel, {
      matter,
      documents,
      filer,
      settings: {},
      flags: {},
      provider: createMockEfilingProvider(),
      repository: createInMemoryEfilingRepository(),
      ownerId: 'owner-1',
    }))
    for (const label of [
      'E-Filing Draft Review',
      'Mock provider — no live filing occurs',
      'Document',
      'Filing mode',
      'Save draft',
      'Validate draft',
      'Submit (mock)',
      'Submit to Stage',
      'Submit to Production',
      '311th District Court',
      '2026-00001',
    ]) {
      assert.ok(html.includes(label), label)
    }
    // Stage and Production submit are always rendered so the safety gate is visible.
    assert.ok(html.includes('Submit to Stage'))
    assert.ok(html.includes('Submit to Production'))
  } finally {
    await server.close()
  }
})
