import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import { transformWithOxc } from 'vite'
import * as contextHelpers from '../src/reliefTrackContext.js'
import { defaultReliefFilterGroups, normalizeApplicability } from '../src/reliefApplicability.js'
const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
const plain=value=>JSON.parse(JSON.stringify(value))
async function load(name,globals={}) {
 const match=new RegExp('(^|\\n)(  )?(?:async )?function '+name+'\\(').exec(source);assert.ok(match,`${name} exists`)
 const start=match.index+match[1].length,indent=match[2]||'',end=source.indexOf('\n'+indent+'}',start)+indent.length+2
 const code=(await transformWithOxc(source.slice(start,end),'function.jsx',{jsx:{runtime:'classic'}})).code
 const ctx={React,...contextHelpers,normalizeApplicability,requestedReliefFilterGroups:defaultReliefFilterGroups,...globals};vm.createContext(ctx);vm.runInContext(code,ctx);return ctx[name]
}
const tree=node=>!node||typeof node!=='object'?[]:[node,...React.Children.toArray(node.props?.children).flatMap(tree)]
const track={id:'temp',matter_id:'m',name:'Interim support',order_type_id:'temporary',type:'general'}
const defaults={proceeding:['modification'],order_type:['temporary']}
async function openBuilder(args={}) {
 let builder
 const fn=await load('beginRequestedReliefBuilder',{requestedReliefMatterFilter:'all',setRequestedReliefInlineEditor(){},requestedReliefSnapshotRows:x=>x,cloneRequestedReliefOptionRows:x=>x,activeRequestedReliefOptions:()=>[{id:'issue'},{id:'choice',parent_id:'issue',is_relief_option:true}],requestedReliefBuilderExpandIssueIds:x=>x,requestedReliefBuilderLeafIdsWithin:()=>['choice'],requestedReliefTables:[],requestedReliefDefaultContext:()=>defaults,requestedReliefKindLabel:()=> 'Our relief',setRequestedReliefBuilderMode(){},setRequestedReliefBuilder:x=>builder=x,setRequestedReliefActiveIssueId(){},setRequestedReliefBuilderEditMode(){},setShowRequestedReliefEditMenu(){},setRequestedReliefExpandedIds(){},setShowRequestedReliefBuilder(){}})
 fn({matter_id:'m',litigationTrackId:'temp',useFullTree:true,...args});return builder
}
test('track normalization retains explicit type and classifies default Final Relief',async()=>{
 const fn=await load('ensureLitigationTrackShape',{LITIGATION_TRACK_COLORS:['#fff'],LITIGATION_TRACK_VIEW_OPTIONS:[],cloneLitigationTrackRows:x=>x||[]})
 assert.equal(fn(track).order_type_id,'temporary');assert.equal(fn({is_default:true,type:'general'}).order_type_id,'final');assert.equal(fn({type:'discovery',is_default:true}).order_type_id,'')
})
test('new relief builder inherits context before filtering issues',async()=>{const b=await openBuilder();assert.deepEqual(plain(b.filter_context),defaults);assert.equal(b.litigation_track_id,'temp')})
test('reuse adopts destination defaults while preserving selected content and text',async()=>{
 const b=await openBuilder({sourceRelief:{id:'old',filter_context:{order_type:['final'],proceeding:['original'],custom:['a']},issue_option_ids:['issue'],selected_option_ids:['choice'],option_text_by_option_id:{choice:'Keep'},option_snapshot:[{id:'issue'},{id:'choice',is_relief_option:true}]}})
 assert.deepEqual(plain(b.filter_context),{custom:['a'],...defaults});assert.deepEqual(plain(b.selected_option_ids),['choice']);assert.equal(b.option_text_by_option_id.choice,'Keep')
})
test('saved explicit All/None overrides remain unchanged on reopen',async()=>{
 for(const filter_context of [{},{order_type:[]}]){const b=await openBuilder({relief:{id:'saved',matter_id:'m',litigation_track_id:'temp',filter_context,issue_option_ids:['issue'],selected_option_ids:['choice']}});assert.deepEqual(plain(b.filter_context),filter_context)}
})
test('changing new relief track updates inherited context and preserves explicit override',async()=>{
 const fn=await load('patchRequestedReliefBuilderContext',{requestedReliefDefaultContext:(matter,id)=>({proceeding:['modification'],order_type:[id==='final'?'final':'temporary']})})
 const b={matter_id:'m',litigation_track_id:'temp',filter_context:defaults,selected_option_ids:['keep']}
 assert.deepEqual(plain(fn(b,{litigation_track_id:'final'}).filter_context),{proceeding:['modification'],order_type:['final']})
 assert.deepEqual(plain(fn({...b,filter_context_custom:true},{litigation_track_id:'final'}).filter_context),defaults)
 assert.deepEqual(plain(fn({...b,id:'saved'},{litigation_track_id:'final'}).filter_context),defaults)
 assert.deepEqual(plain(fn(b,{litigation_track_id:'final'}).selected_option_ids),['keep'])
})
test('Add Track offers shared active choices excluding Final and Discovery workspace',async()=>{
 const Modal=()=>null,LabeledField=()=>null
 const fn=await load('renderLitigationTrackModal',{litigationTrackModal:{mode:'new',matter_id:'m',type:'general'},Modal,LabeledField,matterName:()=> 'Matter',saveLitigationTrackModal(){},setLitigationTrackModal(){},events:[],pendingLitigationTrackAssignmentRef:{},requestedReliefFilterGroups:[...defaultReliefFilterGroups.slice(0,1),{...defaultReliefFilterGroups[1],options:[...defaultReliefFilterGroups[1].options,{id:'habeas',name:'Habeas corpus'}]}]})
 const nodes=tree(fn()),select=nodes.find(n=>n.type==='select'&&n.props['aria-label']==='Track type / order type');assert.ok(select)
 const values=tree(select).filter(n=>n.type==='option').map(n=>n.props.value)
 assert.ok(values.includes('temporary'));assert.ok(values.includes('tro'));assert.ok(values.includes('other'));assert.ok(values.includes('habeas'));assert.ok(!values.includes('final'));assert.ok(!values.includes('discovery'))
})
test('default context reads the selected matter extras and rejects a track belonging to a different matter',async()=>{
 const fn=await load('requestedReliefDefaultContext',{matterExtraFor:()=>({proceeding_id:'modification'}),litigationTrackForId:()=>track})
 assert.deepEqual(plain(fn('m','temp')),defaults);assert.deepEqual(plain(fn('different','temp')),{proceeding:['modification']})
})
test('creating a track in an open builder resolves the new track before React state catches up',async()=>{
 const context=await load('requestedReliefDefaultContext',{matterExtraFor:()=>({proceeding_id:'modification'}),litigationTrackForId:()=>null})
 const patch=await load('patchRequestedReliefBuilderContext',{requestedReliefDefaultContext:context})
 const b=patch({matter_id:'m',filter_context:{}},{litigation_track_id:'temp'},track)
 assert.deepEqual(plain(b.filter_context),defaults)
})
