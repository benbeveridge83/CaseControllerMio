import test from'node:test'
import assert from'node:assert/strict'
import fs from'node:fs'
import{applyEqualParentingResearch}from'../mio-v318-equal-parenting-research.js'
const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')

test('research integration adds exactly one import, nav entry, and workspace',()=>{
 const r=applyEqualParentingResearch(source)
 assert.equal((r.match(/MioResearchWorkspace/g)||[]).length,2)
 assert.equal((r.match(/>Equal Parenting Research<\/a>/g)||[]).length,1)
 assert.equal((r.match(/page === 'equal_parenting_research'/g)||[]).length,2)
 assert.equal(applyEqualParentingResearch(r),r)
})

test('missing navigation or render anchors refuse a partial installation',()=>{
 assert.throws(()=>applyEqualParentingResearch('missing'),/research integration anchors/i)
})
