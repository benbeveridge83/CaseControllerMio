import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import {transformWithOxc} from 'vite'
import {defaultReliefFilterGroups} from '../src/reliefApplicability.js'
const raw=fs.readFileSync(new URL('../src/ReliefApplicability.jsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace(/export function /g,'function ')
const code=(await transformWithOxc(raw,'controls.jsx',{jsx:{runtime:'classic'}})).code
const ctx={React};vm.createContext(ctx);vm.runInContext(code,ctx)
const flat=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(flat)]
test('checkbox editor distinguishes All, None and individual values without altering another group',()=>{
 let value={order_type:['final']};const render=()=>flat(ctx.ReliefApplicabilityFields({groups:defaultReliefFilterGroups,value,onChange:v=>value=v}))
 render().find(n=>n.type==='button'&&n.props.children==='None').props.onClick();assert.deepEqual(JSON.parse(JSON.stringify(value)),{order_type:['final'],proceeding:[]})
 render().find(n=>n.type==='input'&&n.props['aria-label']==='Proceeding: Original').props.onChange({target:{checked:true}});assert.deepEqual([...value.proceeding],['original'])
 render().find(n=>n.type==='button'&&n.props.children==='All').props.onClick();assert.equal(Object.hasOwn(value,'proceeding'),false);assert.deepEqual(value.order_type,['final'])
})
test('row editor offers inheritance and labels unselected restrictions',()=>{const nodes=flat(ctx.ReliefApplicabilityFields({groups:defaultReliefFilterGroups,value:{},onChange(){},mode:'row'}));assert.ok(nodes.some(n=>n.type==='button'&&n.props.children==='Inherit'));assert.ok(nodes.some(n=>n.type==='input'&&n.props.checked))})
test('group manager creates custom groups/choices and renames without changing IDs',()=>{
 let groups=structuredClone(defaultReliefFilterGroups),answer='Custom group',next=0
 ctx.window={prompt:()=>answer};ctx.crypto={randomUUID:()=>`new-${++next}`}
 const render=()=>flat(ctx.ReliefFilterGroupSettings({groups,onChange:v=>groups=v}))
 render().find(n=>n.type==='button'&&n.props.children==='+ Add filter group').props.onClick();assert.equal(groups.at(-1).name,'Custom group')
 answer='Custom choice';render().filter(n=>n.type==='button'&&n.props.children==='+ Add choice').at(-1).props.onClick();assert.equal(groups.at(-1).options[0].name,'Custom choice')
 const id=groups.at(-1).options[0].id;answer='Renamed choice';render().filter(n=>n.type==='button'&&n.props.children==='Rename').at(-1).props.onClick();assert.equal(groups.at(-1).options[0].id,id);assert.equal(groups.at(-1).options[0].name,'Renamed choice')
 render().filter(n=>n.type==='button'&&n.props.children==='Archive').at(-1).props.onClick();assert.equal(groups.at(-1).options[0].archived,true)
 render().find(n=>n.type==='button'&&n.props.children==='Restore').props.onClick();assert.equal(groups.at(-1).options[0].archived,false)
})
