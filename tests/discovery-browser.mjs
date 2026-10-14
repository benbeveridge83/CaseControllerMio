// Synthetic account and intercepted service responses only; no client records.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import JSZip from 'jszip'
import { preview } from 'vite'
import { chunkRows } from './cloud-chunk-fixture.js'
import { parseDiscoveryText, exportDiscoveryDocx } from '../src/discovery/documents.js'

fs.mkdirSync('test-results', { recursive: true })
const server = await preview({ preview: { host: '127.0.0.1', port: 4173, strictPort: true } })
const browser = await chromium.launch({ headless: true, executablePath: process.env.MIO_TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })
const id = '00000000-0000-4000-8000-000000000334', email = 'synthetic-discovery@beveridgelawfirm.com'
const user = { id, email, email_confirmed_at: new Date().toISOString(), aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: new Date().toISOString() }
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url'), exp = Math.floor(Date.now() / 1000) + 3600
const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp, aud: 'authenticated' })}.test-signature`, refresh_token: 'synthetic-test-token', expires_at: exp, expires_in: 3600, token_type: 'bearer', user }
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true }), page = await context.newPage()
const errors = [], calls = [], states = new Map()
let failSecondBatch = true, analysisCount = 0, failChat = true, failProfileWrite = false, failChatWrite = false, holdProfileSave = true, releaseProfileSave, notifyProfileSave
const profileSaveStarted = new Promise(resolve=>{notifyProfileSave=resolve})
page.on('pageerror', error => errors.push(error.message))
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (['127.0.0.1', 'localhost'].includes(url.hostname)) {
    if (url.pathname === '/api/discovery-objections') {
      const body = request.postDataJSON(); calls.push(body)
      assert.match(request.headers().authorization, /^Bearer /)
      if (body.action === 'status') return respond({ ok: true, aiConfigured: true })
      if (body.action === 'chat') {
        assert.equal(body.personal.styleInstructions,'Use concise, request-specific language.')
        assert.equal(body.personal.rules[0].title,'Attorney communications')
        assert.equal(body.requests,undefined,'Chat does not silently transmit the uploaded set')
        if(failChat){failChat=false;return respond({ok:false,error:'Synthetic chat retry.'},502)}
        return respond({ok:true,answer:'The limit depends on the discovery level. Level 2 ordinarily permits 25 interrogatories, counting discrete subparts, with an identification/authentication exception.',authorities:['trcp190'],factsNeeded:['Confirm the discovery control order.'],appliedRuleIds:[]})
      }
      if (body.action === 'analyze') {
        analysisCount++
        if (analysisCount === 2 && failSecondBatch) return respond({ ok: false, error: 'Synthetic temporary provider failure.' }, 502)
        assert.equal(body.regime, 'family_current')
        assert.equal(body.personal.rules[0].title,'Attorney communications')
        assert.equal(body.strategy,2)
        return respond({ ok: true, results: body.requests.map(r => {
          const privileged = /attorney/i.test(r.request), broad = /all material/i.test(r.request)
          return { id: r.id, assessment: privileged || broad ? 'partial' : 'proper',
            reason: privileged ? 'Confidential legal advice may be privileged; ordinary underlying facts remain discoverable.' : broad ? 'The request has no subject or time limit.' : 'This request seeks a defined set of relevant records.',
            privilege: privileged ? 'Confidential communications made to obtain legal advice are withheld, limited to [confirm privileged scope].' : '',
            privilegeAuthorities:privileged?['tre503','trcp193-privilege']:[],privilegeStrength:privileged?75:null,privilegeStrengthReason:privileged?'Legal basis is strong; confirm the confidential scope.':'',objectionStrength:broad?70:null,objectionStrengthReason:broad?'The request lacks subject and time limits.':'',appliedRuleIds:privileged?[body.personal.rules[0].id]:[],screenedOut:[],
            objection: broad ? 'The phrase “all material” is not limited to the disputed possession issues or a relevant time period.' : '',
            authorities: privileged ? ['tre503', 'trcp193-privilege'] : ['trcp192-scope'], factsNeeded: privileged ? ['Confirm confidentiality and legal-advice purpose.'] : [],
            responseGuidance: 'Produce responsive nonprivileged material within the proper scope.', withholding: privileged ? 'Provide the required privilege withholding statement.' : '' }
        }) })
      }
      return respond({ ok: false, error: 'Unexpected test action' }, 400)
    }
    return url.pathname.startsWith('/api/') ? respond({ ok: true, connected: false, data: [] }) : route.continue()
  }
  if (!url.hostname.endsWith('.supabase.co')) return respond({})
  if (url.pathname.includes('/auth/v1/')) return respond(url.pathname.endsWith('/user') ? user : session)
  const table = url.pathname.split('/').pop()
  if (table === 'mio_cloud_state_read_chunks_v297') return respond(chunkRows([...states.values()].map(row => ({ ...row, user_id: id })), request.postDataJSON()))
  if (table === 'mio_cloud_state_write_v277') {
    const data = request.postDataJSON(), row = { key: data.p_key, raw_value: data.p_raw, updated_at: new Date().toISOString() }
    if((row.key==='caseMioDiscoveryPersonalV1'&&failProfileWrite)||(row.key==='caseMioDiscoveryChatV1'&&failChatWrite))return respond({message:'Synthetic unacknowledged discovery save.'},500)
    if(row.key==='caseMioDiscoveryPersonalV1'&&holdProfileSave){holdProfileSave=false;await new Promise(resolve=>{releaseProfileSave=resolve;notifyProfileSave()})}
    states.set(row.key, row); return respond(row)
  }
  if (table === 'case_mio_user_state') {
    let data = [...states.values()], key = url.searchParams.get('key')
    if (key?.startsWith('eq.')) data = data.filter(row => row.key === key.slice(3))
    if (key?.startsWith('neq.')) data = data.filter(row => row.key !== key.slice(4))
    const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000)
    const fields = (url.searchParams.get('select') || '*').split(',')
    return respond(data.slice(offset, offset + limit).map(row => fields.includes('*') ? row : Object.fromEntries(fields.map(field => [field, row[field]]))))
  }
  if (table === 'team_members') {
    const member = { id: 'synthetic-discovery-member', email, first_name: 'Discovery', last_name: 'Test', is_active: true, page_access: [] }
    return respond(request.headers().accept?.includes('vnd.pgrst.object') ? member : [member])
  }
  return respond(request.headers().accept?.includes('vnd.pgrst.object') ? null : [])
})
await page.addInitScript(session => localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token', JSON.stringify(session)), session)
try {
  await page.goto('http://127.0.0.1:4173/#discovery_objections', { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Discovery objection walkthrough', exact: true }).waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: /RFD Requests for disclosure/ }).click()
  await page.getByRole('heading', { name: /Requests for disclosure/ }).waitFor()
  await page.getByLabel('Rules regime').selectOption('civil_current')
  await page.getByRole('heading', { name: 'Disclosure depends on the filing date' }).waitFor()
  await page.getByLabel('Rules regime').selectOption('family_current')
  await page.getByRole('button', { name: /RFP Requests for production/ }).click()
  await page.screenshot({ path: 'test-results/discovery-rules-desktop.png', fullPage: true })
  await page.getByRole('button', { name: /Request examples/ }).click()
  await page.getByLabel('Search request examples').fill('attorney')
  assert.ok(await page.locator('.disco-example-list button').count() > 0)
  await page.screenshot({ path: 'test-results/discovery-examples-desktop.png', fullPage: true })
  await page.getByRole('button', { name: /My rules & examples/ }).click()
  await page.getByLabel('General objection and privilege style').fill('Use concise, request-specific language.')
  await page.getByRole('button', {name:'Add rule or example',exact:true}).click()
  await page.getByLabel('Rule title',{exact:true}).fill('Attorney communications')
  await page.getByLabel('Example discovery request',{exact:true}).fill('Produce attorney communications.')
  await page.getByLabel('Preferred privilege assertion',{exact:true}).fill('Confidential legal advice is withheld.')
  await page.getByLabel('How to identify this request',{exact:true}).fill('Separate underlying facts from confidential legal advice.')
  await page.getByRole('button',{name:'Save my rules & style',exact:true}).click()
  await profileSaveStarted
  await page.getByRole('button',{name:/Analyze & draft/}).click()
  assert.equal(await page.getByLabel('Case context').isDisabled(),true,'A pending guidance save must lock analysis settings and actions')
  await page.getByRole('button',{name:/Discovery chat/}).click()
  assert.equal(await page.getByLabel('Ask about discovery',{exact:true}).isDisabled(),true,'Chat must not use the old guidance while a save is pending')
  releaseProfileSave()
  await page.getByRole('button',{name:/My rules & examples/}).click()
  await page.getByText('Saved to your account. Enabled guidance will be used in new analysis and chat.',{exact:true}).waitFor()
  assert.equal(JSON.parse(states.get('caseMioDiscoveryPersonalV1').raw_value).rules.length,1)
  await page.screenshot({path:'test-results/discovery-personal-desktop.png',fullPage:true})
  await page.reload()
  await page.getByRole('heading', { name: 'Discovery objection walkthrough', exact: true }).waitFor({timeout:45000})
  await page.getByRole('button', {name:/My rules & examples/}).click()
  assert.equal(await page.getByLabel('General objection and privilege style').inputValue(),'Use concise, request-specific language.')
  assert.equal(await page.getByLabel('Rule title',{exact:true}).inputValue(),'Attorney communications')
  failProfileWrite=true
  await page.getByLabel('General objection and privilege style').fill('Unacknowledged personal style.')
  await page.getByRole('button',{name:'Save my rules & style',exact:true}).click()
  await page.locator('.disco-personal .disco-error').filter({hasText:'Synthetic unacknowledged discovery save.'}).waitFor()
  await page.getByRole('link',{name:'Discovery',exact:true}).click()
  await page.getByRole('heading',{name:'Discovery',exact:true}).waitFor()
  await page.getByRole('link',{name:'Discovery Objections',exact:true}).click()
  await page.getByRole('heading',{name:'Discovery objection walkthrough',exact:true}).waitFor()
  await page.getByRole('button',{name:/My rules & examples/}).click()
  assert.equal(await page.getByLabel('General objection and privilege style').inputValue(),'Unacknowledged personal style.')
  await page.getByText('A previous save has not been confirmed.',{exact:false}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Save my rules & style',exact:true}).isEnabled(),true)
  failProfileWrite=false
  await page.getByLabel('General objection and privilege style').fill('Use concise, request-specific language.')
  await page.getByRole('button',{name:'Save my rules & style',exact:true}).click()
  await page.getByText('Saved to your account. Enabled guidance will be used in new analysis and chat.',{exact:true}).waitFor()
  failChatWrite=true
  await page.getByRole('button', {name:/Discovery chat/}).click()
  await page.getByLabel('Ask about discovery',{exact:true}).fill('What is the interrogatory limit?')
  await page.getByRole('button', {name:'Send question',exact:true}).click()
  await page.locator('.disco-chat .disco-error').filter({hasText:'Synthetic chat retry.'}).waitFor()
  await page.getByRole('link',{name:'Discovery',exact:true}).click()
  await page.getByRole('heading',{name:'Discovery',exact:true}).waitFor()
  await page.getByRole('link',{name:'Discovery Objections',exact:true}).click()
  await page.getByRole('heading',{name:'Discovery objection walkthrough',exact:true}).waitFor()
  await page.getByRole('button',{name:/Discovery chat/}).click()
  await page.locator('.disco-chat .disco-error').filter({hasText:'A previous chat save is still pending.'}).waitFor()
  failChatWrite=false
  await page.getByRole('button',{name:'Retry question',exact:true}).click()
  await page.locator('.disco-chat-message.assistant').waitFor()
  await page.getByLabel('Ask about discovery',{exact:true}).fill('What about discrete subparts?')
  await page.getByRole('button', {name:'Send question',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.disco-chat-message.assistant').length===2)
  await page.getByRole('button',{name:'Send question',exact:true}).isDisabled()
  await page.waitForFunction(()=>!document.querySelector('#disco-chat-question').disabled)
  assert.equal(calls.filter(c=>c.action==='chat').at(-1).messages.length,3)
  assert.equal(JSON.parse(states.get('caseMioDiscoveryChatV1').raw_value).messages.length,4)
  assert.ok(await page.locator('.disco-chat .disco-authority').filter({hasText:'25 interrogatories'}).count()>0)
  await page.screenshot({path:'test-results/discovery-chat-desktop.png',fullPage:true})
  await page.getByRole('button', { name: /Analyze & draft/ }).click()
  const source = 'REQUEST FOR PRODUCTION NO. 1: Produce confidential communications with your attorney.\nRESPONSE: Privileged communications withheld.\nREQUEST FOR PRODUCTION NO. 2: Produce pay stubs for June 2026.\nRESPONSE: See Exhibit A.\nREQUEST FOR PRODUCTION NO. 3: Produce all material in your possession.\nRESPONSE: Responsive materials will be produced.\nREQUEST FOR PRODUCTION NO. 4: Produce the signed agreement.\nRESPONSE: See Exhibit B.'
  const parsed = parseDiscoveryText(source)
  const bytes = await exportDiscoveryDocx({ requests: parsed.requests })
  fs.writeFileSync('test-results/discovery-original.docx', bytes)
  await page.getByLabel('Upload discovery Word document').setInputFiles({ name: 'Synthetic-responses.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(bytes) })
  await page.getByText('4 requests recognized.', { exact: false }).waitFor()
  assert.equal(await page.locator('.disco-request').count(), 4)
  await page.getByLabel('Case context').fill('Synthetic possession modification, disputed conduct during June 2026.')
  const second=page.locator('.disco-request').nth(1)
  await second.getByRole('button',{name:'+ Add objection',exact:true}).click()
  await second.getByLabel('Objection for RFP 2',{exact:true}).fill('Manual objection text for this specific request.')
  await second.getByLabel('Objection strength for RFP 2',{exact:true}).fill('78')
  await second.getByLabel('Include this objection between the request and response in Word').check()
  await second.getByRole('button',{name:'+ Add privilege',exact:true}).click()
  await second.getByLabel('Privilege for RFP 2',{exact:true}).fill('Manual privilege text for a confidential subset.')
  await second.getByLabel('Include this privilege before the request in Word').check()
  await page.getByRole('button', { name: 'Analyze 4 requests', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Synthetic temporary provider failure' }).waitFor()
  assert.equal(await page.locator('.disco-result').count(), 3)
  failSecondBatch = false
  await page.getByRole('button', { name: 'Analyze 1 remaining', exact: true }).click()
  await page.getByRole('button', { name: 'All requests analyzed', exact: true }).waitFor()
  assert.equal(await page.locator('.disco-result').count(), 4)
  assert.equal(await page.locator('.disco-proper').count(), 2)
  assert.equal(await second.getByLabel('Objection for RFP 2',{exact:true}).inputValue(),'Manual objection text for this specific request.')
  assert.equal(await second.getByLabel('Objection strength for RFP 2',{exact:true}).inputValue(),'78')
  await page.locator('.disco-request').first().getByLabel('Include this privilege before the request in Word').check()
  await page.getByRole('button', { name: 'Download Word response', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'bracketed fact placeholders' }).waitFor()
  const draft = page.getByRole('textbox', { name: 'Privilege for RFP 1', exact: true })
  await draft.fill((await draft.inputValue()).replace('[confirm privileged scope]', 'confidential legal-advice communications concerning this action'))
  await page.getByLabel('Privilege strength for RFP 1',{exact:true}).fill('90')
  await page.locator('.disco-request').nth(2).getByLabel('Include this objection between the request and response in Word').check()
  const downloadCopy=async path=>{
    const downloading=page.waitForEvent('download')
    await page.getByRole('button',{name:'Download Word response',exact:true}).click()
    await (await downloading).saveAs(path)
    const zip=await JSZip.loadAsync(fs.readFileSync(path))
    return zip.file('word/document.xml').async('string')
  }
  await page.screenshot({ path: 'test-results/discovery-analysis-desktop.png', fullPage: true })
  const xml=await downloadCopy('test-results/discovery-with-objections.docx')
  assert.equal((xml.match(/OBJECTION:/g)||[]).length,2)
  assert.equal((xml.match(/PRIVILEGE \(/g)||[]).length,2)
  assert.ok(xml.indexOf('PRIVILEGE (')<xml.indexOf('Produce confidential communications'))
  assert.ok(xml.indexOf('Manual objection text')<xml.indexOf('See Exhibit A.'))
  assert.ok(xml.indexOf('Produce pay stubs')<xml.indexOf('Manual objection text'))
  assert.ok(xml.indexOf('not limited to the disputed possession')<xml.indexOf('Responsive materials will be produced.'))
  assert.match(xml, /<w:b\/?[ >]/)
  assert.ok(xml.includes('See Exhibit A.')&&xml.includes('See Exhibit B.'))
  await page.getByLabel('Privilege placement in Word').selectOption('after_request')
  const after=await downloadCopy('test-results/discovery-privileges-after-request.docx')
  assert.ok(after.indexOf('Produce confidential communications')<after.indexOf('PRIVILEGE ('))
  assert.ok(after.indexOf('PRIVILEGE (')<after.indexOf('Privileged communications withheld.'))
  assert.equal(calls.filter(c => c.action === 'analyze').at(-1).requests.length, 1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/discovery-analysis-mobile.png', fullPage: true })
  assert.ok(await page.locator('.disco-workspace').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Discovery content must not overflow on mobile')
  await page.getByLabel('Objection drafting threshold',{exact:true}).fill('4')
  assert.equal(await page.locator('.disco-result').count(),0)
  assert.equal(await second.getByLabel('Objection for RFP 2',{exact:true}).inputValue(),'Manual objection text for this specific request.')
  assert.equal(await page.getByLabel('Objection for RFP 3',{exact:true}).count(),0,'Unedited AI draft clears when the threshold changes')
  assert.equal(await page.getByLabel('Privilege for RFP 1',{exact:true}).inputValue().then(x=>x.includes('confidential legal-advice communications')),true)
  await page.getByRole('button',{name:/Discovery chat/}).click()
  await page.screenshot({path:'test-results/discovery-chat-mobile.png',fullPage:true})
  assert.ok(await page.locator('.disco-workspace').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  await page.getByRole('button',{name:/Analyze & draft/}).click()
  await page.getByLabel('Rules regime').selectOption('civil_current')
  assert.equal(await page.locator('.disco-result').count(), 0, 'A changed legal regime invalidates previous analysis')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ typesAndRegimes: true, searchableExamples: true, wordPairs: 4, retryRemaining: true, properRequestsWithoutObjections: 2, placeholdersBlocked: true, objectionsExported: 2, privilegesExported:2, manualOverrides:true, savedRulesReload:true, chatRetryAndFollowup:true, thresholds:true, mobileOverflow: false, pageErrors: errors }))
} finally { releaseProfileSave?.(); await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)) }
