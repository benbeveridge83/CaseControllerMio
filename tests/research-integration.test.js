import test from'node:test'
import assert from'node:assert/strict'
import fs from'node:fs'
const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
test('locate current Mio navigation and page anchors',()=>{
 const snippets=[]
 for(const term of['Snail Mail','Google Ads','Settings','Withdrawals']){
  let at=0
  while((at=source.indexOf(term,at))>=0&&snippets.length<20){snippets.push(term+': '+source.slice(Math.max(0,at-180),Math.min(source.length,at+220)).replace(/\s+/g,' '));at+=term.length}
 }
 assert.fail('ANCHOR_DIAGNOSTIC\n'+snippets.join('\n---\n'))
})
