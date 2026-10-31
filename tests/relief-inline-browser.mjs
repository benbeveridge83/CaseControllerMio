import { chunkRows } from './cloud-chunk-fixture.js'
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// Tests the built application, with synthetic auth and all external traffic
// intercepted. This never logs in to or writes to the real Supabase project.
const base = process.env.RELIEF_INTEGRATION_URL || 'http://127.0.0.1:4183'
const browser = await chromium.launch({ headless: true, executablePath: process.env.RELIEF_CHROME_PATH || undefined, args: ['--no-sandbox'] })
fs.mkdirSync('test-results', { recursive: true })

async function openAs(email, pageAccess = []) {
  const context = await browser.newContext({ viewport: { width: 1536, height: 1100 } })
  const page = await context.newPage()
  const errors = []
  const id = email.startsWith('staff') ? '00000000-0000-4000-8000-000000002901' : '00000000-0000-4000-8000-000000002902'
  const exp = Math.floor(Date.now() / 1000) + 3600
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const user = { id, email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: new Date().toISOString() }
  const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp, aud: 'authenticated' })}.synthetic`, refresh_token: 'synthetic-test-only', expires_at: exp, expires_in: 3600, token_type: 'bearer', user }
  const rows=[...Array.from({length:30},(_,i)=>({id:`filler-${i}`,name:`Earlier issue ${i+1}`,parent_id:'',sort_order:i+1,is_active:true})),{id:'support',name:'Support',parent_id:'',sort_order:31,is_active:true},{id:'existing-child',name:'Existing Support Child',parent_id:'support',sort_order:1,is_active:true},{id:'seed-choice',name:'Existing relief choice',parent_id:'support',sort_order:2,is_active:true,is_relief_option:true,option_type:'non_exclusive'}]
  const seed={caseMioPreferredSettingsTab:'requested_relief',caseMioRequestedReliefOptions:rows,caseMioRequestedReliefExpandedIds:['support'],caseMioRequestedReliefs:[{id:'test-relief',matter_id:'matter-inline',name:'Inline Test Relief',relief_type:'client_relief',issue_option_ids:['support','existing-child'],selected_option_ids:['seed-choice'],option_snapshot:rows,filter_context:{}}]}
  const states = new Map(Object.entries(seed).map(([key,value])=>[key,{key,raw_value:typeof value==='string'?value:JSON.stringify(value),json_value:null,updated_at:'2026-10-31T12:00:00Z'}]))
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', async dialog => { if(dialog.type()==='beforeunload') return dialog.accept();errors.push(dialog.message());await dialog.dismiss() })
  await context.routeWebSocket(url => !['127.0.0.1', 'localhost'].includes(url.hostname), socket => socket.close())
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return url.pathname.startsWith('/api/') ? respond({ connected: false, data: [] }) : route.continue()
    if (!url.hostname.endsWith('.supabase.co')) return respond({})
    if (url.pathname.includes('/auth/v1/')) return respond(url.pathname.endsWith('/user') ? user : session)
    const table = url.pathname.split('/').pop()
    if (table === 'matters' || table === 'mio_matters') return respond([{id:'matter-inline',name:'Inline Test Matter',description:'Inline Test Matter',status:'Open',is_active:true}])
    if (table === 'team_members') {
      const member = { id: 'appeals-synthetic-member', email, first_name: 'Appeals', last_name: 'Test', is_active: true, page_access: pageAccess }
      return respond(request.headers().accept?.includes('vnd.pgrst.object') ? member : [member])
    }
    if (table === 'mio_cloud_state_read_chunks_v297') return respond(chunkRows([...states.values()].map(row=>({...row,user_id:id})),request.postDataJSON()))
    if (table === 'mio_cloud_state_write_v277') {
      const data = request.postDataJSON()
      const row = { key: data.p_key, raw_value: data.p_raw, updated_at: new Date().toISOString() }
      if (data.p_delete) states.delete(data.p_key); else states.set(data.p_key, row)
      return respond(row)
    }
    if (table === 'case_mio_user_state') return respond(request.method() === 'GET' ? [...states.values()] : [])
    return respond(request.headers().accept?.includes('vnd.pgrst.object') ? null : [])
  })
  await context.addInitScript(({session,seed})=>{localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session))},{session,seed})
  await page.goto(`${base}/#settings`, { waitUntil: 'domcontentloaded' })
  return { context, page, errors }
}

let activePage
try {
 const {page,context,errors}=await openAs('staff-inline-test@beveridgelawfirm.com');activePage=page
 await page.getByRole('button',{name:'Requested Relief',exact:true}).click({timeout:30000})
 await page.getByRole('heading',{name:'Issues / Relief Options',exact:true}).waitFor({timeout:15000})
 const support=page.locator('.rr-tree-row').filter({has:page.getByText('Support',{exact:true})})
 await support.scrollIntoViewIfNeeded()
 const before=await page.evaluate(()=>scrollY)
 await support.getByRole('button',{name:'+ Child Issue',exact:true}).click()
 const editor=page.locator('.rr-inline-row-editor');await editor.waitFor()
 assert.ok(Math.abs((await page.evaluate(()=>scrollY))-before)<3,'Add Child leaves page scroll unchanged')
 const parentBox=await support.boundingBox(),editorBox=await editor.boundingBox()
 assert.ok(editorBox.y>=parentBox.y+parentBox.height-2 && editorBox.y<parentBox.y+parentBox.height+20,'child editor appears immediately below Support')
 await editor.getByLabel('Row name',{exact:true}).fill('Inline Settings Child')
 await editor.getByLabel('Proceeding: Original',{exact:true}).uncheck()
 await editor.getByLabel('Order type: Final orders',{exact:true}).uncheck()
 await editor.getByLabel('Order type: TRO',{exact:true}).uncheck()
 await page.screenshot({path:'test-results/relief-inline-settings.png'})
 await editor.getByRole('button',{name:'Save row',exact:true}).click()
 const saved=page.locator('.rr-tree-row').filter({has:page.getByText('Inline Settings Child',{exact:true})})
 await saved.getByRole('button',{name:'Edit',exact:true}).click()
 assert.equal(await editor.getByLabel('Proceeding: Original',{exact:true}).isChecked(),false)
 assert.equal(await editor.getByLabel('Proceeding: Modification',{exact:true}).isChecked(),true)
 assert.equal(await editor.getByLabel('Order type: Temporary orders',{exact:true}).isChecked(),true)
 assert.equal(await editor.getByLabel('Order type: TRO',{exact:true}).isChecked(),false)
 await editor.getByRole('button',{name:'Cancel',exact:true}).click()
 console.log('Settings checks passed');await page.goto(`${base}/#matter_dashboard:matter-inline?tab=requested_relief`,{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'})
 await page.getByRole('button',{name:'Select Options',exact:true}).first().click({timeout:15000})
 await page.getByRole('button',{name:/Add\/Edit Issues/}).click()
 await page.getByRole('button',{name:'◫ Split',exact:true}).click()
 const childButton=page.getByRole('button',{name:'＋ Child',exact:true}).first()
 await childButton.click()
 await editor.waitFor()
 await editor.getByLabel('Row name',{exact:true}).fill('Dashboard Inline Child')
 await editor.getByLabel('Proceeding: Original',{exact:true}).uncheck()
 await editor.getByLabel('Order type: Final orders',{exact:true}).uncheck()
 await editor.getByLabel('Order type: TRO',{exact:true}).uncheck()
 await page.screenshot({path:'test-results/relief-inline-dashboard.png'})
 await editor.getByRole('button',{name:'Save row',exact:true}).click()
 await page.getByRole('button',{name:'☷ Multiple choice',exact:true}).click()
 const prompt=page.locator('section[id^="rr-prompt-"]').filter({has:page.getByText('Dashboard Inline Child',{exact:true})})
 await prompt.getByRole('button',{name:'✎',exact:true}).click()
 assert.equal(await editor.getByLabel('Proceeding: Original',{exact:true}).isChecked(),false)
 assert.equal(await editor.getByLabel('Order type: Temporary orders',{exact:true}).isChecked(),true)
 await editor.getByRole('button',{name:'Cancel',exact:true}).click()
 await page.getByRole('button',{name:'🛠 Template Maker',exact:true}).click()
 const builderSupport=page.locator('.rr-template-maker-row').filter({has:page.getByText('Support',{exact:true})})
 await builderSupport.getByRole('button',{name:'＋ Child',exact:true}).click()
 await editor.getByLabel('Row name',{exact:true}).fill('Canceled child')
 await editor.getByRole('button',{name:'Cancel',exact:true}).click()
 assert.equal(await page.getByText('Canceled child',{exact:true}).count(),0)
 console.log('Dashboard view checks passed');await page.getByRole('button',{name:'Save Relief',exact:true}).click()
 await page.getByRole('button',{name:'Select Options',exact:true}).first().click()
 await page.getByRole('button',{name:'🛠 Template Maker',exact:true}).click()
 const reopened=page.locator('.rr-template-maker-row').filter({has:page.getByText('Dashboard Inline Child',{exact:true})})
 await reopened.getByRole('button',{name:'✎',exact:true}).click()
 assert.equal(await editor.getByLabel('Proceeding: Original',{exact:true}).isChecked(),false)
 assert.equal(await editor.getByLabel('Order type: Temporary orders',{exact:true}).isChecked(),true)
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({status:'passed',verified:['Settings child appears below clicked row','no Add Child scroll jump','Settings save and edit applicability','matter dashboard split child editor','multiple-choice edit','template child cancel','saved relief reopen preserves applicability'],realExternalWrites:0}))
 await context.close()
} catch(error) {
 if(activePage){await activePage.screenshot({path:'test-results/relief-inline-failure.png'});console.error((await activePage.locator('body').innerText()).slice(-1200))}
 throw error
} finally {await browser.close()}
