import{build}from'vite'
import{chromium}from'playwright-core'
import assert from'node:assert/strict'
import fs from'node:fs'
// Offline compiled component tests. All Google/cloud interactions use synthetic fixtures.
const compiled=await build({configFile:false,root:process.cwd(),logLevel:'error',resolve:{alias:{'../supabaseClient.js':new URL('./ads-test-auth-stub.js',import.meta.url).pathname}},define:{'process.env.NODE_ENV':'"production"'},build:{write:false,minify:false,lib:{entry:'tests/ads-workspace-browser-fixture.jsx',name:'AdsBrowserTest',formats:['iife']}}})
const output=Array.isArray(compiled)?compiled[0].output:compiled.output,js=output.find(x=>x.type==='chunk').code,css=output.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>x.source).join('\n')
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000)
fs.mkdirSync('ads-test-results',{recursive:true})
try{
 await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div></body></html>')
 await page.evaluate(()=>{if(!crypto.randomUUID){let n=0;crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`}})
 await page.addScriptTag({content:js});await page.getByRole('heading',{name:'Search-term decision table'}).waitFor()
 await page.getByLabel('Filter intent').selectOption('Needs review');assert.equal(await page.locator('tbody tr[data-term-row]').count(),2)
 await page.getByLabel('Select all filtered rows').check();await page.getByRole('button',{name:/Review 2 campaign negatives/}).click();assert.equal(await page.getByRole('button',{name:'Authorize & apply selected'}).isEnabled(),false)
 await page.getByLabel('I authorize only these listed campaign negatives.').check();await page.getByLabel('Match type 1').selectOption('PHRASE');assert.equal(await page.getByLabel('I authorize only these listed campaign negatives.').isChecked(),false);await page.getByLabel('Match type 1').selectOption('EXACT')
 assert.equal((await page.evaluate(()=>window.__calls.filter(c=>c.action==='workspace_apply'))).length,0)
 await page.getByLabel('I authorize only these listed campaign negatives.').check();await page.getByRole('button',{name:'Authorize & apply selected'}).click();await page.getByText(/Verified: 2/).waitFor();const write=await page.evaluate(()=>window.__calls.find(c=>c.action==='workspace_apply'));assert.deepEqual(write.body.items.map(x=>x.campaignId).sort(),['12','13']);assert.ok(write.body.items.every(x=>x.matchType==='EXACT'))
 await page.getByRole('button',{name:'Close review'}).click();assert.equal(await page.locator('tbody tr[data-term-row]').count(),0)
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.getByRole('button',{name:'Columns',exact:true}).click();await page.getByLabel('Show Device').check();assert.ok((await page.evaluate(()=>window.__saved.at(-1))).includes('device'));await page.getByRole('button',{name:'Columns',exact:true}).click()
 await page.getByText('Audience & locations',{exact:true}).click();await page.getByText('Pearland, Texas').waitFor();assert.ok(await page.getByText(/not the demographics of individual/).count());await page.screenshot({path:'ads-test-results/search-workspace.png',fullPage:true})
 await page.getByRole('button',{name:'Campaign negative',exact:true}).click();await page.evaluate(()=>{window.__failNext=true});await page.getByLabel('I authorize only these listed campaign negatives.').check();await page.getByRole('button',{name:'Authorize & apply selected'}).click();await page.getByText(/Simulated network failure/).waitFor();assert.equal(await page.getByRole('button',{name:'Authorize & apply selected'}).isEnabled(),false);await page.getByRole('button',{name:'Close review'}).click()
 await page.getByRole('button',{name:'Test Ads'}).click();await page.getByRole('heading',{name:'Ad workspace'}).waitFor();await page.getByRole('button',{name:'Ask AI for suggestions'}).click();await page.getByText('AI proposal - not applied').waitFor();assert.equal((await page.evaluate(()=>window.__calls.filter(c=>c.action==='workspace_apply'))).length,2)
 await page.getByRole('button',{name:'Dismiss suggestion'}).click();await page.getByRole('button',{name:'Edit draft',exact:true}).click();await page.getByLabel('Headline 1 text').fill('Custody Help In Brazoria');await page.getByRole('button',{name:'Review ad changes'}).click();assert.equal(await page.getByRole('button',{name:'Authorize & apply ad changes'}).isEnabled(),false)
 await page.getByLabel('I authorize this exact ad revision.').check();await page.getByRole('button',{name:'Authorize & apply ad changes'}).click();await page.getByText('Confirmed by Google',{exact:true}).waitFor();await page.getByRole('button',{name:'Close review'}).click()
 const update=await page.evaluate(()=>window.__calls.filter(c=>c.action==='workspace_apply').at(-1));assert.deepEqual(update.body.references,[{campaignId:'12',adGroupId:'4'}]);assert.equal(update.body.adGroupId,'4')
 await page.screenshot({path:'ads-test-results/ad-workspace.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'ads-test-results/ad-workspace-mobile.png',fullPage:true})
 assert.deepEqual(errors,[]);console.log('PASS: intent/status workflow, selection scoping, approval reset, fresh resolved rows, saved columns, audience, AI read-only, ad review, desktop/mobile UI.')
}finally{await browser.close()}
