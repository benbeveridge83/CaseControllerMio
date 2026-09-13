import{build}from'vite'
import{chromium}from'playwright-core'
import assert from'node:assert/strict'
const compiled=await build({configFile:false,root:process.cwd(),logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},build:{write:false,minify:false,lib:{entry:'tests/research-workspace-browser-fixture.jsx',name:'ResearchBrowserTest',formats:['iife']}}})
const output=Array.isArray(compiled)?compiled[0].output:compiled.output,js=output.find(x=>x.type==='chunk').code,css=output.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>x.source).join('\n')
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));page.setDefaultTimeout(10000)
try{
 await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div></body></html>');await page.addScriptTag({content:js});await page.waitForTimeout(250)
 const heading=page.getByRole('heading',{name:'Equal Parenting Research'});if(!(await heading.count())){const body=await page.locator('body').innerText();throw new Error('RESEARCH_RENDER_DIAGNOSTIC errors='+JSON.stringify(errors)+' body='+JSON.stringify(body.slice(0,1200)))}
 await heading.waitFor();assert.equal(await page.locator('tbody tr[data-research-row]').count(),5)
 await page.getByLabel('Finding direction').selectOption('disfavors_shared');assert.equal(await page.locator('tbody tr[data-research-row]').count(),1)
 await page.getByLabel('Finding direction').selectOption('');await page.getByLabel('Exact or near 50/50').check();assert.equal(await page.locator('tbody tr[data-research-row]').count(),1)
 await page.getByLabel('Exact or near 50/50').uncheck();await page.getByRole('button',{name:'Sort by Impact'}).click();assert.match(await page.locator('tbody tr[data-research-row]').first().innerText(),/88/)
 assert.ok(await page.getByText('Not available',{exact:true}).count())

 await page.getByRole('button',{name:'Unfavorable study'}).click();await page.getByRole('heading',{name:'Edit research publication'}).waitFor()
 const impact=page.getByLabel('Impact');assert.equal(await impact.inputValue(),'77')
 await page.getByLabel('Editor finding direction').selectOption('favors_shared');assert.equal(await impact.inputValue(),'77');await page.getByLabel('Editor finding direction').selectOption('disfavors_shared')
 await page.getByRole('button',{name:'Add analysis'}).click();await page.getByLabel('Parenting time definition 1').fill('50/50 alternating weeks');await page.getByLabel('Exact or near 50/50').check();await page.getByLabel('Causal claim strength 1').selectOption('low')
 await page.getByRole('button',{name:'Add link'}).click();await page.getByLabel('Access URL 1').fill('https://publisher.test/unfavorable')
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved'}).waitFor()
 await page.getByRole('button',{name:'Back to research'}).click();await page.getByRole('button',{name:'Unfavorable study'}).click();await page.getByRole('heading',{name:'Edit research publication'}).waitFor();assert.equal(await page.getByLabel('Parenting time definition 1').inputValue(),'50/50 alternating weeks');assert.equal(await page.getByLabel('Access URL 1').inputValue(),'https://publisher.test/unfavorable')
 await page.getByRole('button',{name:'published'}).click();await page.getByText('Findings summary is required before publishing.').waitFor();assert.equal((await page.evaluate(()=>window.__researchStore.publications.find(x=>x.id==='5').editorial_status)),'archived')
 await page.getByLabel('Findings summary').fill('This study found an unfavorable association under its specified design.');await page.getByRole('button',{name:'published'}).click();await page.getByRole('status').filter({hasText:'published'}).waitFor()
 const saved=await page.evaluate(()=>window.__researchStore.publications.find(x=>x.id==='5'));assert.equal(saved.editorial_status,'published');assert.equal(saved.overall_findings_summary,'This study found an unfavorable association under its specified design.');assert.ok(saved.published_at)

 await page.getByRole('button',{name:'Back to research'}).click();await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=390),true)
 assert.deepEqual(errors,[]);console.log('PASS: research filters, exact-50 rule, nullable metrics, editor persistence, publish gate, score independence, and mobile containment.')
}finally{await browser.close()}
