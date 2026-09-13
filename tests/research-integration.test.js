import test from'node:test'
import assert from'node:assert/strict'
import fs from'node:fs'
const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
test('locate current Mio navigation and page anchors',()=>{
 const patterns=[
  "setPage('marketing')","setPage(\"marketing\")","page === 'marketing'","page==='marketing'",
  "setPage('google_ads')","setPage(\"google_ads\")","page === 'google_ads'","page==='google_ads'",
  "setPage('settings')","setPage(\"settings\")","page === 'settings'","page==='settings'",
  "setPage('mail_center')","setPage(\"mail_center\")","page === 'mail_center'","page==='mail_center'",
  "setPage('withdrawals')","setPage(\"withdrawals\")","page === 'withdrawals'","page==='withdrawals'",
  "setPage('matters')","setPage(\"matters\")","page === 'matters'","page==='matters'"
 ]
 const snippets=[]
 for(const pattern of patterns){const at=source.indexOf(pattern);if(at>=0)snippets.push(pattern+': '+source.slice(Math.max(0,at-260),Math.min(source.length,at+420)).replace(/\s+/g,' '))}
 assert.fail('ANCHOR_DIAGNOSTIC\n'+snippets.join('\n---\n'))
})
