import{build}from'vite'
import{chromium}from'playwright-core'
import assert from'node:assert/strict'
const compiled=await build({configFile:false,root:process.cwd(),logLevel:'error',build:{write:false,minify:false,lib:{entry:'tests/research-workspace-browser-fixture.jsx',name:'ResearchBrowserTest',formats:['iife']}}})
const output=Array.isArray(compiled)?compiled[0].output:compiled.output,js=output.find(x=>x.type==='chunk').code,css=output.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>x.source).join('\n')
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000)
try{
 await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div></body></html>');await page.addScriptTag({content:js})
 await page.getByRole('heading',{name:'Equal Parenting Research'}).waitFor();assert.equal(await page.locator('tbody tr[data-research-row]').count(),5)
 await page.getByLabel('Finding direction').selectOption('disfavors_shared');assert.equal(await page.locator('tbody tr[data-research-row]').count(),1)
 await page.getByLabel('Finding direction').selectOption('');await page.getByLabel('Exact or near 50/50').check();assert.equal(await page.locator('tbody tr[data-research-row]').count(),1)
 await page.getByLabel('Exact or near 50/50').uncheck();await page.getByRole('button',{name:'Sort by Impact'}).click();assert.match(await page.locator('tbody tr[data-research-row]').first().innerText(),/88/)
 assert.ok(await page.getByText('Not available',{exact:true}).count())
 await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=390),true)
 assert.deepEqual(errors,[]);console.log('PASS: research filters, exact-50 rule, nullable metrics, sorting, and mobile containment.')
}finally{await browser.close()}
