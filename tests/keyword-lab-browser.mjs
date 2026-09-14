import {build} from 'vite'
import {chromium} from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const compiled=await build({configFile:false,root:process.cwd(),logLevel:'error',resolve:{alias:{'../supabaseClient.js':new URL('./ads-test-auth-stub.js',import.meta.url).pathname}},define:{'process.env.NODE_ENV':'"production"'},build:{write:false,minify:false,lib:{entry:'tests/keyword-lab-browser-fixture.jsx',name:'KeywordLabTest',formats:['iife']}}})
const output=(Array.isArray(compiled)?compiled[0]:compiled).output,js=output.find(x=>x.type==='chunk').code,css=output.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>x.source).join('\n')
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000)
await page.route('**/*',route=>route.abort()) // No network request can reach Google or Supabase.
try{
 await page.setContent(`<html><head><style>${css}</style></head><body><div id="root"></div></body></html>`)
 await page.evaluate(()=>{if(!crypto.randomUUID){let i=0;crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++i).padStart(12,'0')}`}})
 await page.addScriptTag({content:js});await page.getByRole('heading',{name:'Keyword Lab',exact:true}).waitFor()
 const nav=page.getByRole('navigation',{name:'Keyword Lab tabs'})
 await page.getByLabel('Keyword Lab campaign').selectOption('12')
 for(const tab of ['Search Terms','Find Keywords','Experiments','Current Keywords'])await nav.getByRole('button',{name:tab,exact:true}).click()
 assert.equal(await page.getByLabel('Keyword Lab campaign').inputValue(),'12')
 await page.getByRole('button',{name:'CTR',exact:true}).click()
 await page.getByLabel('Filter CTR',{exact:true}).click();await page.getByLabel('CTR filter value').fill('3');await page.getByRole('button',{name:'Apply filter',exact:true}).click()
 assert.equal(await page.locator('tr[data-keyword-lab-row]').count(),1);await page.getByRole('button',{name:/CTR > 3.0%/}).waitFor()
 await page.getByRole('button',{name:'Clear all filters',exact:true}).click()
 await page.getByLabel('Filter Cost',{exact:true}).click();await page.getByLabel('Cost operator',{exact:true}).selectOption('between');await page.getByLabel('Cost filter value',{exact:true}).fill('20');await page.getByLabel('Cost upper bound').fill('100');await page.getByRole('button',{name:'Apply filter',exact:true}).click();assert.equal(await page.locator('tr[data-keyword-lab-row]').count(),1)
 await page.getByRole('button',{name:'Clear all filters',exact:true}).click()
 await page.getByRole('button',{name:'▸ custody lawyer',exact:true}).click();await page.getByRole('heading',{name:'Search terms triggered by custody lawyer'}).waitFor()
 await page.getByRole('button',{name:'Open in Search Terms'}).click();await page.getByRole('button',{name:'custody lawyer',exact:true}).click();await page.getByRole('heading',{name:'Search terms triggered by custody lawyer'}).waitFor()
 await page.getByLabel('Match type custody lawyer',{exact:true}).selectOption('EXACT')
 await page.getByRole('button',{name:'Review Basket (1)'}).click();let dialog=page.getByRole('dialog',{name:'Review Basket'})
 assert.equal(await dialog.getByRole('button',{name:'Authorize and apply'}).count(),0)
 await dialog.getByRole('button',{name:'Review exact changes'}).click();await dialog.getByLabel('I authorize these exact Keyword Lab changes.').check();await dialog.getByLabel('Basket match 1').selectOption('BROAD')
 assert.equal(await dialog.getByRole('button',{name:'Authorize and apply'}).count(),0)
 await dialog.getByRole('button',{name:'Review exact changes'}).click();await dialog.getByLabel('I authorize these exact Keyword Lab changes.').check();await dialog.getByRole('button',{name:'Authorize and apply'}).click();await dialog.getByText('Outcome: verified').waitFor();await dialog.getByRole('button',{name:'Clear verified basket'}).click()
 await nav.getByRole('button',{name:'Search Terms',exact:true}).click();await page.getByLabel('Classify custody lawyer near me').selectOption('relevant');await page.waitForFunction(()=>window.__calls.some(c=>c.action==='keyword_classify_term'))
 await nav.getByRole('button',{name:'Find Keywords',exact:true}).click();await page.getByLabel('Seed phrases').fill('custody help');await page.getByRole('button',{name:'Find with Keyword Planner'}).click();await page.getByRole('cell',{name:'custody help',exact:true}).waitFor();await page.getByLabel('Candidate destination').selectOption('12:4');await page.getByLabel('Select custody help',{exact:true}).check();await page.getByLabel('Hypothesis',{exact:true}).fill('Relevant traffic');await page.getByRole('button',{name:'Queue selected candidates'}).click();await page.getByRole('button',{name:'Review Basket (1)'}).waitFor()
 await nav.getByRole('button',{name:'Experiments',exact:true}).click();await page.getByText('2026-09-01 · 13 days').waitFor();await page.getByRole('button',{name:'Continue test',exact:true}).click();await page.getByRole('button',{name:'Promote to core',exact:true}).click();await page.getByRole('cell',{name:'promoted_to_core',exact:true}).waitFor()
 await page.getByLabel('Keyword Lab date range').selectOption('CUSTOM');await page.getByLabel('Start',{exact:true}).fill('2026-09-01');await page.getByLabel('End',{exact:true}).fill('2026-09-13');await page.getByRole('button',{name:'Apply dates',exact:true}).click();await page.waitForFunction(()=>window.__calls.some(c=>c.action==='keyword_lab_snapshot'&&c.params.startDate==='2026-09-01'))
 await page.getByRole('button',{name:'Review Basket (1)'}).click();dialog=page.getByRole('dialog',{name:'Review Basket'});await dialog.getByRole('button',{name:'Review exact changes'}).click();await dialog.getByLabel('I authorize these exact Keyword Lab changes.').check();await page.evaluate(()=>window.__failApply=true);await dialog.getByRole('button',{name:'Authorize and apply'}).click();await dialog.getByText(/Simulated uncertain network result/).waitFor();await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Review Basket (1)'}).click();assert.equal(await page.getByRole('button',{name:'Authorize and apply',exact:true}).count(),0)
 const calls=await page.evaluate(()=>window.__calls);assert.equal(calls.filter(c=>c.action==='keyword_apply').length,2);assert.equal(calls.find(c=>c.action==='keyword_candidates').params.phrases,'custody help');assert.ok((await page.evaluate(()=>window.__saved)).length)
 assert.deepEqual(errors,[]);console.log('PASS Keyword Lab: four tabs, scope, headers, mapping, match basket approval/reset, planner, classification, experiments, uncertain-write lock; external requests blocked.')
}catch(e){fs.mkdirSync('ads-test-results',{recursive:true});await page.screenshot({path:'ads-test-results/keyword-lab-failure.png',fullPage:true});throw e}finally{await browser.close()}
