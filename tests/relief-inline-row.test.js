import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import { transformWithOxc } from 'vite'
import { normalizeApplicability, effectiveApplicability, defaultReliefFilterGroups } from '../src/reliefApplicability.js'
const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
async function harness() {
  const ctx = { React, normalizeApplicability, effectiveApplicability, requestedReliefFilterGroups: defaultReliefFilterGroups,
    requestedReliefInlineEditor: null, requestedReliefExpandedIds: [], scrolls: 0, prompts: 0,
    requestedReliefOptions: [{ id: 'support', name: 'Support', parent_id: '', sort_order: 1 }],
    requestedReliefBuilderMode: 'relief', requestedReliefBuilder: { working_options: [{id:'support',name:'Support',parent_id:'',sort_order:1}], issue_option_ids: ['support'], selected_option_ids: ['existing'], option_text_by_option_id: {existing:'Keep me'} },
    crypto: { randomUUID: () => 'new-row' }, alert: message => { throw Error(message) },
  }
  for (const name of ['RequestedReliefInlineEditor','RequestedReliefExpandedIds','RequestedReliefOptions','RequestedReliefBuilder','RequestedReliefOptionForm','RequestedReliefActiveIssueId']) {
    const key = name[0].toLowerCase()+name.slice(1)
    ctx['set'+name] = update => ctx[key] = typeof update === 'function' ? update(ctx[key]) : update
  }
  ctx.window = { requestAnimationFrame: fn => fn(), scrollTo: () => ctx.scrolls++, prompt: () => { ctx.prompts++; return '' } }
  ctx.document = { getElementById: () => ({scrollIntoView: () => ctx.scrolls++}) }
  vm.createContext(ctx)
  const names = ['openRequestedReliefRowForm','openRequestedReliefInlineEditor','saveRequestedReliefInlineRow','renderRequestedReliefInlineRow','addRequestedReliefOptionRelative','addRequestedReliefBuilderIssueRelative','editRequestedReliefBuilderRow','requestedReliefWorkingRows','cloneRequestedReliefOptionRows','ensureRequestedReliefOptionShape','resequenceRequestedReliefOptions','requestedReliefBuilderSelectionField','requestedReliefBuilderOptionById','requestedReliefBuilderOptionRows']
  for (const name of names) {
    const match = new RegExp('(^|\\n)(  )?function '+name+'\\(').exec(source)
    if (!match) continue
    const start=match.index+match[1].length, indent=match[2]||'', end=source.indexOf('\n'+indent+'}',start)+indent.length+2
    vm.runInContext((await transformWithOxc(source.slice(start,end),'part.jsx',{jsx:{runtime:'classic'}})).code,ctx)
  }
  return ctx
}
const plain = x => JSON.parse(JSON.stringify(x))
test('Settings Add Child opens a draft beneath Support without scrolling or creating a blank saved row',async()=>{
  const c=await harness(); c.addRequestedReliefOptionRelative(c.requestedReliefOptions[0],'child')
  assert.equal(c.scrolls,0,'Add Child must not scroll to the top form')
  assert.equal(c.requestedReliefInlineEditor?.anchorId,'support')
  assert.equal(c.requestedReliefInlineEditor?.scope,'settings')
  assert.equal(c.requestedReliefInlineEditor?.row.parent_id,'support')
  assert.equal(c.requestedReliefOptions.length,1)
})
test('dashboard Add Child opens the same row editor without a name-only prompt',async()=>{
  const c=await harness(); c.addRequestedReliefBuilderIssueRelative('support','child')
  assert.equal(c.prompts,0,'dashboard must expose name and applicability together')
  assert.equal(c.requestedReliefInlineEditor?.anchorId,'support')
  assert.equal(c.requestedReliefInlineEditor?.scope,'builder')
})
for(const scope of ['settings','builder']) test(`${scope} child save retains proceeding and order rules under the correct parent`,async()=>{
  const c=await harness()
  if(scope==='settings') c.addRequestedReliefOptionRelative(c.requestedReliefOptions[0],'child'); else c.addRequestedReliefBuilderIssueRelative('support','child')
  assert.ok(c.requestedReliefInlineEditor,'inline draft must exist')
  Object.assign(c.requestedReliefInlineEditor.row,{name:'  Child Support  ',notes:'Notes',applicability:{proceeding:['modification'],order_type:['temporary']}})
  c.saveRequestedReliefInlineRow()
  const rows=scope==='settings'?c.requestedReliefOptions:c.requestedReliefBuilder.working_options
  const saved=rows.find(r=>r.id==='new-row')
  assert.equal(saved.parent_id,'support');assert.equal(saved.name,'Child Support')
  assert.deepEqual(plain(saved.applicability),{proceeding:['modification'],order_type:['temporary']})
  assert.equal(c.requestedReliefInlineEditor,null)
  if(scope==='builder') { assert.equal(c.requestedReliefOptions.length,1);assert.ok(c.requestedReliefBuilder.issue_option_ids.includes('new-row'));assert.deepEqual(plain(c.requestedReliefBuilder.option_text_by_option_id),{existing:'Keep me'}) }
})
test('Cancel discards an unsaved inline draft without changing Settings or the matter snapshot',async()=>{
 const c=await harness();c.ReliefInlineRowEditor=()=>null
 c.addRequestedReliefBuilderIssueRelative('support','child')
 const before=plain(c.requestedReliefBuilder)
 const rendered=c.renderRequestedReliefInlineRow('builder','support')
 rendered.props.children.props.onChange({...c.requestedReliefInlineEditor.row,name:'Discarded',applicability:{order_type:['tro']}})
 rendered.props.children.props.onCancel()
 assert.equal(c.requestedReliefInlineEditor,null);assert.deepEqual(plain(c.requestedReliefBuilder),before);assert.equal(c.requestedReliefOptions.length,1)
})
test('editing a dashboard row keeps its ID, parent, and selected relief text',async()=>{
 const c=await harness();c.editRequestedReliefBuilderRow('support')
 Object.assign(c.requestedReliefInlineEditor.row,{name:'Updated Support',applicability:{order_type:['final']}})
 c.saveRequestedReliefInlineRow()
 assert.equal(c.requestedReliefBuilder.working_options.length,1)
 assert.equal(c.requestedReliefBuilder.working_options[0].id,'support')
 assert.equal(c.requestedReliefBuilder.working_options[0].name,'Updated Support')
 assert.deepEqual(plain(c.requestedReliefBuilder.working_options[0].applicability),{order_type:['final']})
 assert.deepEqual(plain(c.requestedReliefBuilder.selected_option_ids),['existing'])
})
test('editing an excluded dashboard issue does not silently include it in relief',async()=>{
 const c=await harness();c.requestedReliefBuilder.issue_option_ids=[]
 c.editRequestedReliefBuilderRow('support');c.requestedReliefInlineEditor.row.name='Renamed';c.saveRequestedReliefInlineRow()
 assert.deepEqual(plain(c.requestedReliefBuilder.issue_option_ids),[])
})
for (const toOption of [true,false]) test(`changing row type reconciles issue and option selections (${toOption?'option':'issue'})`,async()=>{
 const c=await harness();c.requestedReliefBuilder.working_options[0].is_relief_option=!toOption
 c.requestedReliefBuilder.selected_option_ids=['support','existing']
 c.editRequestedReliefBuilderRow('support');c.requestedReliefInlineEditor.row.is_relief_option=toOption;c.saveRequestedReliefInlineRow()
 assert.equal(c.requestedReliefBuilder.issue_option_ids.includes('support'),!toOption)
 assert.equal(c.requestedReliefBuilder.selected_option_ids.includes('support'),toOption)
 assert.ok(c.requestedReliefBuilder.selected_option_ids.includes('existing'))
})
