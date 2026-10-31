import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { transformWithOxc } from 'vite'

const resourceURL = new URL('../src/cps/cps-navigator.html', import.meta.url)
function openResource() {
  assert.ok(existsSync(resourceURL), 'approved resource must be included in Mio')
  return new JSDOM(readFileSync(resourceURL, 'utf8'), { runScripts: 'dangerously', beforeParse(window) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  } })
}

test('CPS route renders only for permitted staff and keeps other navigation', async () => {
  const { applyCPSNavigatorMount } = await import('../mio-cps-navigator-mount.js').catch(() => ({}))
  assert.equal(typeof applyCPSNavigatorMount, 'function', 'Mio must register CPS Navigator')
  const app = `import React from 'react'
  const appPages = [
  { value: 'discovery', label: 'Discovery' },
  ]
  export default function App({page, staff, allowed}) {
    const canOpenPage = name => allowed && ['documents', ...appPages.map(p => p.value)].includes(name)
    const isFirmStaffMember = () => staff
    const setPage = () => {}; const session = {user: {id:'test'}}
    return <div><aside>
        {canOpenPage('documents') && (
          <a href="#documents">Documents</a>
        )}
      </aside><main>
        {page === 'discovery' && canOpenPage('discovery') && (
          <p>Existing Discovery</p>
        )}
    </main></div>
  }`
  const code = applyCPSNavigatorMount(app)
  const out = await transformWithOxc(code, '/src/App.jsx', { lang: 'jsx', jsx: { runtime: 'classic' } })
  const path = new URL('../.cps-route-test.mjs', import.meta.url)
  const { writeFileSync, unlinkSync } = await import('node:fs')
  writeFileSync(path, out.code)
  try {
    const { default: App } = await import(path.href)
    const staff = renderToString(React.createElement(App, {page:'cps_navigator',staff:true,allowed:true}))
    assert.match(staff, /href="#cps_navigator"/)
    assert.match(staff, /Loading CPS Navigator/)
    for (const props of [{staff:false,allowed:true}, {staff:true,allowed:false}]) {
      const denied = renderToString(React.createElement(App, {...props,page:'cps_navigator'}))
      assert.doesNotMatch(denied, /CPS Navigator|cps_navigator/)
    }
    assert.match(renderToString(React.createElement(App, {page:'discovery',staff:true,allowed:true})), /Existing Discovery/)
    assert.throws(() => applyCPSNavigatorMount(code), /already mounted/)
    assert.throws(() => applyCPSNavigatorMount(app.replace("{ value: 'discovery', label: 'Discovery' },", '')), /anchor changed/)
  } finally { unlinkSync(path) }
})

test('approved map opens stages, parent guidance, next steps, and printable overview', () => {
  const dom = openResource(), doc = dom.window.document
  try {
    assert.equal(doc.querySelector('.sidebar'), null, 'Mio supplies the real navigation')
    assert.equal(doc.querySelectorAll('[data-stage]').length, 14)
    doc.querySelector('[data-stage="report"]').click()
    assert.equal(doc.querySelector('#stageInspector h2').textContent, 'A report is made')
    doc.querySelector('[data-mode="parent"]').click()
    assert.match(doc.querySelector('#stageInspector').textContent, /Questions and next steps/)
    doc.querySelector('[data-detail="next"]').click()
    doc.querySelector('[data-next="intake"]').click()
    assert.equal(doc.querySelector('#stageInspector h2').textContent, 'Intake & screening')
    doc.querySelector('[data-detail="deeper"]').click()
    assert.match(doc.querySelector('#stageInspector').textContent, /not completed case-law summaries/)
    let prints = 0; dom.window.print = () => { prints++ }
    doc.querySelector('[data-print]').click()
    assert.equal(prints, 1)
    assert.equal(doc.querySelector('#stageInspector [data-detail="overview"]').classList.contains('active'), true)
  } finally { dom.window.close() }
})

test('service, rights, source, and search paths remain usable without interpreting search as HTML', () => {
  const dom = openResource(), doc = dom.window.document
  try {
    doc.querySelector('[data-view="services"]').click()
    assert.equal(doc.querySelector('#servicesPanel').hidden, false)
    assert.equal(doc.querySelectorAll('[data-service]').length, 8)
    doc.querySelector('[data-service="therapy"]').click()
    assert.equal(doc.querySelector('#serviceInspector h2').textContent, 'Counseling & family therapy')
    doc.querySelector('[data-mode="parent"]').click()
    assert.match(doc.querySelector('#serviceInspector').textContent, /Questions to discuss with counsel/)
    doc.querySelector('[data-view="rights"]').click()
    doc.querySelector('[data-right-stage="report"]').click()
    assert.equal(doc.querySelector('#processPanel').hidden, false)
    assert.equal(doc.querySelector('#stageInspector h2').textContent, 'A report is made')
    const search = doc.querySelector('#search')
    search.value = 'therapy'; search.dispatchEvent(new dom.window.Event('input'))
    doc.querySelector('[data-result="therapy"]').click()
    assert.equal(doc.querySelector('#servicesPanel').hidden, false)
    assert.equal(doc.querySelector('#results').hidden, true)
    search.value = '<img src=x onerror=alert(1)>'; search.dispatchEvent(new dom.window.Event('input'))
    assert.equal(doc.querySelector('#results img'), null)
    assert.match(doc.querySelector('#results').textContent, /0 matches/)
    doc.querySelector('[data-view="authorities"]').click()
    assert.equal(doc.querySelectorAll('#sourceShelf a').length, 12)
    for (const link of doc.querySelectorAll('#sourceShelf a')) {
      assert.equal(new URL(link.href).protocol, 'https:')
      assert.equal(link.target, '_blank'); assert.ok(link.rel.includes('noopener'))
    }
  } finally { dom.window.close() }
})
