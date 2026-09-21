import test from 'node:test'
import assert from 'node:assert/strict'
import {newProcess,newBlock,connectBlocks} from '../lib/process/model.js'
import {startSimulation,advanceSimulation,simulationStatus} from '../lib/process/simulation.js'
const process=()=>{const d=newProcess();d.blocks=[newBlock('email','court'),newBlock('draft','notice')];return connectBlocks(d,'court','notice')}
test('reply does not complete email; output triggers next step only after sending',()=>{
  let s=startSimulation(process());assert.equal(simulationStatus(s).category,'me')
  assert.throws(()=>advanceSimulation(s,'court','complete','dates'),/send/i)
  s=advanceSimulation(s,'court','send');assert.equal(simulationStatus(s).category,'others')
  s=advanceSimulation(s,'court','reply');assert.equal(simulationStatus(s).unread,true)
  assert.equal(s.states.notice.status,'not_started')
  assert.throws(()=>advanceSimulation(s,'court','complete',''),/result/i)
  s=advanceSimulation(s,'court','complete','2026-10-01 09:00')
  assert.equal(s.states.notice.status,'review')
  assert.equal(s.outputs.court.court_result,'2026-10-01 09:00')
})
test('simulation pins definition, prevents duplicate sends, and cannot act on inactive block',()=>{
  const d=process();let s=startSimulation(d);d.blocks[0].name='changed'
  assert.notEqual(s.definition.blocks[0].name,'changed')
  assert.throws(()=>advanceSimulation(s,'notice','complete','document'),/active/i)
  s=advanceSimulation(s,'court','send');assert.throws(()=>advanceSimulation(s,'court','send'),/sent/i)
})
test('automatic send is simulated; action completion can skip reply waiting',()=>{
  const d=process();d.blocks[0].config.review=false;d.blocks[0].config.waitForReply=false;d.blocks[0].completion='action'
  const s=startSimulation(d);assert.equal(s.states.court.status,'complete');assert.equal(s.states.notice.status,'review')
})
