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
  const rows = [
    {id:'common',name:'Common issue',is_active:true},
    ...['final','temporary','tro','other','habeas'].flatMap((type,index)=>[
      {id:type+'-issue',name:type+' issue',sort_order:index+1,is_active:true,applicability:{order_type:[type]}},
      {id:type+'-choice',name:type+' choice',parent_id:type+'-issue',is_active:true,is_relief_option:true,option_type:'non_exclusive'}
    ]),
    {id:'original-issue',name:'Original only issue',is_active:true,applicability:{proceeding:['original']}},
    {id:'modification-issue',name:'Modification only issue',is_active:true,applicability:{proceeding:['modification']}}
  ]
  const seed={
    caseMioPreferredSettingsTab:'requested_relief',
    caseControllerMatterExtraInfo:{'matter-inline':{proceeding_id:'modification',litigation_parties:[{id:'our-party',source:'client',role:'Petitioner',name:'Test Client'},{id:'their-party',source:'opposing',role:'Respondent',name:'Other Party'}]}},
    caseMioRequestedReliefOptions:rows,
    caseMioLitigationTracks:[{id:'temp',matter_id:'matter-inline',name:'Temporary support',type:'general',order_type_id:'temporary',view_mode:'filings_timeline'}],
    caseMioRequestedReliefFilterGroups:[{id:'proceeding',name:'Proceeding',options:[{id:'original',name:'Original'},{id:'modification',name:'Modification'}]},{id:'order_type',name:'Order type',options:[{id:'final',name:'Final orders'},{id:'temporary',name:'Temporary orders'},{id:'tro',name:'TRO'},{id:'other',name:'Other litigation'},{id:'habeas',name:'Habeas corpus'}]}]
  }
  const states = new Map(Object.entries(seed).map(([key,value])=>[key,{key,raw_value:typeof value==='string'?value:JSON.stringify(value),json_value:null,updated_at:'2026-10-31T12:00:00Z'}]))
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', async dialog => { if(dialog.type()==='beforeunload') return dialog.accept();errors.push(dialog.message());console.log('Dialog:',dialog.message());await dialog.dismiss() })
  await context.routeWebSocket(url => !['127.0.0.1', 'localhost'].includes(url.hostname), socket => socket.close())
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return url.pathname.startsWith('/api/') ? respond({ connected: false, data: [] }) : route.continue()
    if (!url.hostname.endsWith('.supabase.co')) return respond({})
    if (url.pathname.includes('/auth/v1/')) return respond(url.pathname.endsWith('/user') ? user : session)
    const table = url.pathname.split('/').pop()
    if (table === 'matters' || table === 'mio_matters') return respond(request.method()==='PATCH'?{id:'matter-inline'}:[{id:'matter-inline',client_id:'client-test',name:'Inline Test Matter',description:'Inline Test Matter',status:'Open',is_active:true}])
    if (table === 'clients') return respond([{id:'client-test',first_name:'Test',last_name:'Client',is_active:true}])
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
  await page.goto(`${base}/#matter_dashboard:matter-inline?tab=requested_relief`, { waitUntil: 'domcontentloaded' })
  return { context, page, errors, states }
}

let activePage
try {
 const {page,context,errors,states}=await openAs('staff-track-test@beveridgelawfirm.com');activePage=page
 await page.getByRole('button',{name:'+ New relief on this track',exact:true}).first().waitFor({timeout:30000})
 const card=page.locator('strong').filter({hasText:/^Temporary support$/}).locator('xpath=../../..')
 await card.getByRole('button',{name:'+ Work on requested relief',exact:true}).first().click()
 const summary=page.getByRole('region',{name:'Prefilled relief context'})
 await summary.waitFor();assert.match(await summary.innerText(),/Modification/);assert.match(await summary.innerText(),/Temporary orders/);assert.match(await summary.innerText(),/Test Client/)
 await page.screenshot({path:'test-results/relief-track-setup.png'})
 console.log('Setup summary inherited matter, track and party')
 await page.getByRole('button',{name:'Continue to relief builder',exact:true}).click()
 await page.getByRole('button',{name:'Save Relief',exact:true}).waitFor()
 assert.match(await page.getByLabel('Relief filters',{exact:true}).innerText(),/Temporary orders/)
 await page.screenshot({path:'test-results/relief-track-builder.png'})
 fs.writeFileSync('test-results/relief-track-builder.txt',await page.locator('body').innerText())
 await page.getByText(/^\d+\. temporary issue$/).click()
 assert.equal(await page.getByText(/^\d+\. final issue$/).count(),0)
 assert.equal(await page.getByText(/^\d+\. Original only issue$/).count(),0)
 await page.getByRole('button',{name:'Select',exact:true}).click()
 await page.getByText('Change filters for this relief',{exact:true}).click()
 await page.getByLabel('Order type: Temporary orders',{exact:true}).uncheck()
 await page.getByLabel('Order type: Final orders',{exact:true}).check()
 await page.getByRole('button',{name:'Save Relief',exact:true}).click()
 for(let attempt=0;attempt<50&&!states.get('caseMioRequestedReliefs');attempt++) await page.waitForTimeout(100)
 const saved=JSON.parse(states.get('caseMioRequestedReliefs')?.raw_value||'[]').find(r=>r.litigation_track_id==='temp')
 assert.ok(saved,'relief persisted through the cloud-state API')
 assert.deepEqual(saved.filter_context.order_type,['final']);assert.ok(saved.selected_option_ids.includes('temporary-choice'))
 await page.getByRole('button',{name:'Select Options',exact:true}).first().click()
 assert.match(await page.getByLabel('Relief filters',{exact:true}).innerText(),/Final orders/)
 await page.getByText('Change filters for this relief',{exact:true}).click()
 await page.getByRole('button',{name:'Use matter + track defaults',exact:true}).click()
 assert.match(await page.getByLabel('Relief filters',{exact:true}).innerText(),/Temporary orders/)
 await page.getByRole('button',{name:'Save Relief',exact:true}).click()
 console.log('Saved override, hidden selections, reopening and restore defaults passed')
 await page.getByRole('button',{name:'+ New Relief',exact:true}).click()
 await summary.waitFor();assert.match(await summary.innerText(),/Final orders/)
 await page.getByText('Change matter, track, party, name or filing',{exact:true}).click()
 await page.getByRole('button',{name:'+ Create Litigation Track',exact:true}).click()
 const type=page.getByLabel('Track type / order type',{exact:true});await type.waitFor()
 const choices=await type.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value))
 assert.deepEqual(choices,['','temporary','tro','other','habeas'])
 await type.selectOption('habeas')
 await page.getByRole('button',{name:'Save Track',exact:true}).click()
 await page.getByRole('heading',{name:'New Litigation Track',exact:true}).waitFor({state:'hidden'})
 await page.waitForFunction(()=>document.querySelector('[aria-label="Prefilled relief context"]')?.textContent.includes('Order type: Habeas corpus'))
 await page.getByRole('button',{name:'Continue to relief builder',exact:true}).click()
 assert.match(await page.getByLabel('Relief filters',{exact:true}).innerText(),/Habeas corpus/)
 await page.getByText(/^\d+\. habeas issue$/).click()
 await page.getByRole('button',{name:'Select',exact:true}).click()
 await page.getByRole('button',{name:'Save Relief',exact:true}).click()
 console.log('Automatic Final Relief and custom track creation from setup passed')
 await page.getByRole('button',{name:'Open Litigation Tracks',exact:true}).click()
 fs.writeFileSync('test-results/relief-track-timeline.txt',await page.locator('body').innerText())
 await page.getByRole('button',{name:'+ Requested relief',exact:true}).first().click()
 await summary.waitFor();assert.match(await summary.innerText(),/Final orders/);assert.match(await summary.innerText(),/Modification/)
 await page.getByRole('button',{name:'Continue to relief builder',exact:true}).click()
 await page.getByText('Matter, track, party, and filing',{exact:true}).click()
 await page.getByTitle('Create Litigation Track',{exact:true}).click()
 await page.getByLabel('Track type / order type',{exact:true}).selectOption('tro')
 await page.getByRole('button',{name:'Save Track',exact:true}).click()
 await page.getByRole('heading',{name:'New Litigation Track',exact:true}).waitFor({state:'hidden'})
 await page.waitForFunction(()=>document.querySelector('[aria-label="Relief filters"]')?.textContent.includes('Order type: TRO'))
 await page.getByText(/^\d+\. tro issue$/).click()
 await page.getByRole('button',{name:'Select',exact:true}).click()
 await page.getByRole('button',{name:'Save Relief',exact:true}).click()
 console.log('Timeline link and creating a track inside relief builder passed')
 await page.getByRole('button',{name:'Matter Information',exact:true}).click()
 await page.getByRole('button',{name:'Edit Matter',exact:true}).click()
 await page.getByLabel('Matter proceeding',{exact:true}).selectOption('original')
 await page.getByRole('button',{name:'Update Matter',exact:true}).click()
 for(let attempt=0;attempt<50&&JSON.parse(states.get('caseControllerMatterExtraInfo')?.raw_value||'{}')['matter-inline']?.proceeding_id!=='original';attempt++) await page.waitForTimeout(100)
 assert.equal(JSON.parse(states.get('caseControllerMatterExtraInfo').raw_value)['matter-inline'].proceeding_id,'original')
 await page.goto(`${base}/#matter_dashboard:matter-inline?tab=requested_relief`);await page.reload()
 await page.getByRole('button',{name:'+ New Relief',exact:true}).click({timeout:30000})
 await summary.waitFor();assert.match(await summary.innerText(),/Original/);assert.match(await summary.innerText(),/Final orders/)
 console.log('Matter proceeding saved and inherited after reload')
 await context.close();assert.equal(errors.length,0,errors.join('\n'))
} catch(error){if(activePage){await activePage.screenshot({path:'test-results/relief-track-failure.png'});fs.writeFileSync('test-results/relief-track-failure.txt',await activePage.locator('body').innerText())}throw error}finally{await browser.close()}
