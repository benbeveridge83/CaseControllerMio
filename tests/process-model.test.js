import test from 'node:test'
import assert from 'node:assert/strict'
import {newProcess,newBlock,validateDefinition,connectBlocks,removeBlock,renderTokens,starterProcess} from '../lib/process/model.js'

test('cycles cannot be saved and rejected connections do not mutate draft',()=>{
  const d=newProcess();d.blocks=[newBlock('email','a'),newBlock('calendar','b')]
  const linked=connectBlocks(d,'a','b')
  assert.throws(()=>connectBlocks(linked,'b','a'),/cycle|loop/i)
  assert.equal(linked.edges.length,1)
})
test('removing a producer removes connections and marks references invalid',()=>{
  const d=starterProcess();const next=removeBlock(d,'court')
  assert.equal(next.edges.some(e=>e.source==='court'||e.target==='court'),false)
  assert.ok(validateDefinition(next).some(e=>/court/.test(e)))
})
test('missing merge fields remain visible and prototype access is rejected',()=>{
  assert.deepEqual(renderTokens('Hi {{matter.client_name}}',{matter:{}}),{text:'Hi {{matter.client_name}}',missing:['matter.client_name']})
  assert.deepEqual(renderTokens('Hi {{matter.client_name}}',{matter:{client_name:'Alex'}}),{text:'Hi Alex',missing:[]})
  assert.ok(renderTokens('{{matter.__proto__.name}}',{matter:{}}).missing.length)
})
test('starter is structurally valid, review enabled, and separate email outputs connected',()=>{
  const d=starterProcess();assert.deepEqual(validateDefinition(d),[])
  assert.equal(d.blocks.length,7)
  assert.equal(d.blocks.filter(b=>b.type==='email').length,3)
  assert.ok(d.blocks.filter(b=>b.type==='email').every(b=>b.config.review))
  assert.equal(d.blocks.find(b=>b.id==='efile').config.mode,'both')
})
test('invalid positions and duplicate IDs are refused',()=>{
  const d=newProcess();const b=newBlock('email','a');d.blocks=[b,{...b}]
  assert.ok(validateDefinition(d).some(e=>/unique/i.test(e)))
  d.blocks=[{...b,position:{x:NaN,y:4}}];assert.ok(validateDefinition(d).length)
})
