import test from 'node:test'
import assert from 'node:assert/strict'
import * as context from '../src/reliefTrackContext.js'
import { defaultReliefFilterGroups, normalizeReliefFilterGroups, visibleReliefIds } from '../src/reliefApplicability.js'
const groups = normalizeReliefFilterGroups(null)
test('existing order definitions gain Other without changing custom names, archives or IDs', () => {
 const old = [{id:'order_type',name:'Order purpose',options:[{id:'final',name:'Final judgment',archived:true},{id:'habeas',name:'Habeas corpus'}]}]
 const result = normalizeReliefFilterGroups(old)
 assert.deepEqual(result[0].options.map(o=>o.id), ['final','habeas','other'])
 assert.equal(result[0].options[0].name,'Final judgment'); assert.equal(result[0].options[0].archived,true)
 assert.deepEqual(normalizeReliefFilterGroups(result), result)
 assert.ok(defaultReliefFilterGroups[1].options.some(o=>o.id==='other'))
})
test('final is classified by system role, never by an editable display name', () => {
 assert.equal(context.litigationOrderType({type:'general',is_default:true,name:'Renamed'}),'final')
 assert.equal(context.litigationOrderType({id:'lit-track-final-m',type:'general'}),'final')
 assert.equal(context.litigationOrderType({type:'discovery',is_default:true}),'')
 assert.equal(context.litigationOrderType({name:'Final Relief'}),'')
 assert.equal(context.litigationOrderType({order_type_id:'habeas'}),'habeas')
})
test('matter proceeding and selected track provide independent defaults', () => {
 assert.deepEqual(context.reliefContextDefaults({proceeding_id:'modification'},{order_type_id:'temporary'},groups), {proceeding:['modification'],order_type:['temporary']})
 assert.deepEqual(context.reliefContextDefaults({}, {is_default:true},groups), {order_type:['final']})
 assert.deepEqual(context.reliefContextDefaults({matter_type:'SAPCR/Modification'}, {},groups), {})
 assert.deepEqual(context.reliefContextDefaults({proceeding_id:'missing'}, {order_type_id:'missing'},groups), {})
})
test('custom order types share stable identifiers with row applicability; Other is not All', () => {
 const custom = groups.map(g=>g.id==='order_type'?{...g,options:[...g.options,{id:'habeas',name:'Habeas corpus'}]}:g)
 const rows=[{id:'common'},{id:'final-only',applicability:{order_type:['final']}},{id:'other-only',applicability:{order_type:['other']}},{id:'habeas-only',applicability:{order_type:['habeas']}}]
 for (const [type,expected] of [['other',['common','other-only']],['habeas',['common','habeas-only']]]) assert.deepEqual([...visibleReliefIds(rows,custom,context.reliefContextDefaults({}, {order_type_id:type},custom))],expected)
})
test('reuse copies custom filters but destination controls proceeding and order type', () => {
 const result=context.initialReliefContext({sourceContext:{proceeding:['original'],order_type:['final'],custom:['x']},defaults:{proceeding:['modification'],order_type:['tro']}})
 assert.deepEqual(result,{custom:['x'],proceeding:['modification'],order_type:['tro']})
 assert.deepEqual(context.initialReliefContext({sourceContext:{proceeding:['original'],order_type:['final']},defaults:{}}),{})
})
test('saved filters survive default changes, including explicit All and None; legacy missing filters inherit', () => {
 for(const filters of [{},{order_type:[]},{proceeding:['original'],order_type:['final']}]) assert.deepEqual(context.initialReliefContext({saved:{filter_context:filters},defaults:{order_type:['temporary']}}),filters)
 assert.deepEqual(context.initialReliefContext({saved:{id:'old'},defaults:{order_type:['final']}}),{order_type:['final']})
})
test('archived choices stay on existing assignments but disappear from new choices', () => {
 const custom=groups.map(g=>g.id==='order_type'?{...g,options:[...g.options,{id:'old',name:'Old purpose',archived:true}]}:g)
 assert.equal(context.reliefTypeChoices(custom,'order_type').some(o=>o.id==='old'),false)
 assert.equal(context.reliefTypeChoices(custom,'order_type','old').some(o=>o.id==='old'),true)
 assert.deepEqual(context.reliefContextDefaults({}, {order_type_id:'old'},custom),{order_type:['old']})
 assert.deepEqual(context.reliefTypeChoices(custom,'order_type','deleted').at(-1),{id:'deleted',name:'Unavailable type (deleted)',archived:true})
})
test('archiving a filter group disables filtering but leaves track metadata choices available',()=>{
 const archived=groups.map(g=>g.id==='order_type'?{...g,archived:true}:g)
 assert.ok(context.reliefTypeChoices(archived,'order_type').some(o=>o.id==='temporary'))
 assert.deepEqual(context.reliefContextDefaults({}, {order_type_id:'temporary'},archived),{})
})
