import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import reactPlugin from '@vitejs/plugin-react'

test('resource opens with navigable sections, both perspectives, and current-law guidance', async () => {
  const server = await createServer({ configFile: false, plugins: [reactPlugin()], resolve: { alias: [{ find: /.*\.css$/, replacement: new URL('./fixtures/formspree/empty.js', import.meta.url).pathname }] }, server: { host: '127.0.0.1', watch: null }, logLevel: 'silent' })
  try {
    const module = await server.ssrLoadModule('/src/appeals/MioAppealsResource.jsx')
    assert.equal(typeof module.default, 'function', 'resource component exists')
    const html = renderToStaticMarkup(React.createElement(module.default, { userId: 'render-test' }))
    for (const label of ['DFPS / CPS Appeals', 'Search issues and authorities', 'Appellant', 'Appellee', 'Clerk’s record', 'Reporter’s record', 'Findings', 'H.B. 116', 'October 29, 2026']) assert.ok(html.includes(label), label)
    assert.ok(html.includes('aria-label="Appeal sections"'))
    assert.ok(!html.includes('contenteditable'))
  } finally { await server.close() }
})
