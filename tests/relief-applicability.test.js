import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultReliefFilterGroups as groups, visibleReliefIds, normalizeApplicability, effectiveApplicability } from '../src/reliefApplicability.js'
const rows=[{id:'root'}, {id:'shared',parent_id:'root'}, {id:'mod',parent_id:'root',applicability:{proceeding:['modification']}}, {id:'temp',parent_id:'mod',applicability:{order_type:['temporary']}}, {id:'conflict',parent_id:'mod',applicability:{proceeding:['original']}}, {id:'none',applicability:{proceeding:[]}}]
const ids=c=>[...visibleReliefIds(rows,groups,c)]
test('legacy rows remain visible; unfiltered Settings includes all rows',()=>assert.deepEqual(ids({}),rows.map(r=>r.id)))
test('OR within groups and AND across groups, including inherited restrictions',()=>assert.deepEqual(ids({proceeding:['original','modification'],order_type:['temporary']}),['root','shared','mod','temp']))
test('original excludes modification descendants',()=>assert.deepEqual(ids({proceeding:['original']}),['root','shared']))
test('explicit None matches no rows, including unrestricted rows',()=>assert.deepEqual(ids({order_type:[]}),[]))
test('intersection is computed before matching; incompatible parent and child never match',()=>assert.deepEqual(effectiveApplicability(rows[4],rows,groups).proceeding,[]))
test('normalizer preserves explicit none and drops malformed values',()=>assert.deepEqual(normalizeApplicability({a:[],b:['x','x',3],c:null}),{a:[],b:['x']}))
test('archived group does not narrow results; archived values retain their identity',()=>{const g=groups.map(x=>x.id==='proceeding'?{...x,archived:true}:x);assert.equal(visibleReliefIds(rows,g,{proceeding:['original']}).size,rows.length);assert.equal(visibleReliefIds(rows,groups.map(x=>({...x,options:x.options.map(o=>({...o,archived:true}))})),{proceeding:['modification']}).has('mod'),true)})
test('cycles terminate and input rows/context stay unchanged',()=>{const r=[{id:'a',parent_id:'b'},{id:'b',parent_id:'a'}];const before=JSON.stringify(r);assert.equal(visibleReliefIds(r,groups,{proceeding:['original']}).size,2);assert.equal(JSON.stringify(r),before)})
test('all six proceeding/order combinations match only their own branch plus shared rows',()=>{
 const r=[{id:'shared'},...['original','modification'].flatMap(p=>['final','temporary','tro'].map(s=>({id:p+s,applicability:{proceeding:[p],order_type:[s]}})))];
 for(const p of ['original','modification'])for(const s of ['final','temporary','tro'])assert.deepEqual([...visibleReliefIds(r,groups,{proceeding:[p],order_type:[s]})],['shared',p+s])
})
test('future custom groups narrow matching without special-case code',()=>{const g=[...groups,{id:'custom',name:'Custom group',options:[{id:'x',name:'X'},{id:'y',name:'Y'}]}];assert.equal(visibleReliefIds([{id:'a',applicability:{custom:['x']}}],g,{custom:['y']}).size,0)})
