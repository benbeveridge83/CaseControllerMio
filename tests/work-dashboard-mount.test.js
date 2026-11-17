import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {applyWorkDashboardMount} from '../mio-work-dashboard-mount.js'
const source=fs.readFileSync('src/App.jsx','utf8')
const code=applyWorkDashboardMount(source)
const nativeFunction=name=>{const start=code.indexOf(`  function ${name}(`);assert.ok(start>=0,name);const end=code.indexOf('\n  function ',start+10);return code.slice(start,end)}
test('dashboard billing identity follows the form and cannot leak into daily or generic entries',()=>{
 const context={page:'dashboard',mioDeskActiveRowRef:{current:{key:'settings:e1',matterId:'m1'}},mioDeskBillingOriginRef:{current:null},currentBillingUserId:()=> 'u1',billingMatterStatus:()=> 'Open',rateForBilling:()=>300,setShowBillingWindow:()=>{},setDailyBillingDate:()=>{},setShowDailyBillingWindow:()=>{},firmDate:()=> '2026-11-15'}
 context.setBillingForm=value=>{context.form=typeof value==='function'?value(context.form):value}
 vm.runInNewContext(nativeFunction('openBillingWindow')+'\n'+nativeFunction('openDailyBillingWindow')+'\nthis.open=openBillingWindow;this.daily=openDailyBillingWindow',context)
 context.open({matter_id:'m1'})
 assert.equal(context.form.dashboard_task_key,'settings:e1')
 context.daily('2026-11-15');assert.equal(context.form.dashboard_task_key,undefined)
 context.mioDeskActiveRowRef.current=null;context.open({matter_id:'m1'});assert.ok(!context.form.dashboard_task_key)
})
test('dashboard mount remains staff only and native order selection is by exact id',()=>{
 assert.ok(code.includes("canOpenPage('dashboard') && isFirmStaffMember()"))
 assert.ok(code.includes('String(row.id)===String(focusedOrderId)'))
 assert.throws(()=>applyWorkDashboardMount(code),/already mounted/)
})

test('dashboard evaluates saved withdrawal workflows with its actual imported bindings',async()=>{
 const bindings={}
 for(const match of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.\/mio(?:WorkflowBlocks|WithdrawalWorkflow)\.js)['"]/g)){
  const module=await import(new URL('../src/'+match[2].slice(2),import.meta.url))
  for(const specifier of match[1].split(',')){const [name,alias]=specifier.trim().split(/\s+as\s+/);bindings[alias||name]=module[name]}
 }
 const state={status:'active',definition:{steps:[{id:'drafting',name:'Prepare withdrawal motion',input_slots:[]}]},steps:{drafting:{status:'needs_action',attention_since:'2026-11-16T10:00:00Z'}}}
 const context={...bindings,mioDeskClientName:()=> 'Withdrawal client',clients:[],canOpenPage:()=>true,withdrawalMatters:[{id:'m1'},{id:'closed'}],mioWithdrawalSnapshot:{rows:{m1:{state},archived:{state}}},matters:[{id:'m1',name:'Saved withdrawal matter'},{id:'closed',name:'Closed withdrawal',case_status:'Closed',is_active:true},{id:'archived',name:'Archived withdrawal',is_active:false}]}
 vm.runInNewContext(nativeFunction('checklistMatterOpenClosedValue')+'\n'+nativeFunction('mioDeskWithdrawals')+'\nthis.getWithdrawals=mioDeskWithdrawals',context)
 let result=context.getWithdrawals()
 assert.equal(result.length,1,'closed and archived matters must not be revived by withdrawal records')
 assert.equal(result[0].status,'Needs action')
 assert.equal(result[0].next,'Prepare withdrawal motion')
 state.steps.drafting={status:'waiting',waiting_on:'Client signature'}
 result=context.getWithdrawals();assert.equal(result[0].status,'Waiting');assert.equal(result[0].next,'Client signature')
 state.status='complete';assert.equal(context.getWithdrawals()[0].status,'Complete')
 state.status='active';state.paused=true;assert.equal(context.getWithdrawals()[0].status,'Paused')
})

test('dashboard memo skips timeline and finance rebuilds while time-entry drafts change',async()=>{
 const React=await import('react')
 // Exercise the actual mount's memo hooks in a mounted React tree (not a duplicate selector).
 const bridge=fs.readFileSync('src/dashboard/appBridge.inc','utf8')
 const start=bridge.indexOf('  const mioDeskTimeline=useMemo('),end=bridge.indexOf('  function mioDeskRows()',start)
 const memoSource=bridge.slice(start,end)
 const dependencies=[...memoSource.matchAll(/\},\[([^\]]+)\]\)/g)].flatMap(m=>m[1].split(','))
 const context={useMemo:React.useMemo}
 for(const name of dependencies){if(name.includes('.'))continue;assert.ok(code.includes(name),`native dependency ${name}`);context[name]=null}
 Object.assign(context,{page:'dashboard',session:{user:{id:'u1'}},isFirmStaffMember:()=>true,canOpenPage:()=>true,mioWithdrawalSnapshot:{rows:{},loading:false,error:''},allMatterTimelineData:()=>[],mioDeskBuildData:()=>({})})
 assert.ok(!dependencies.includes('billingForm'))
 assert.ok(!dependencies.includes('showBillingWindow'))
 // The hook cache must retain business data across billing-only renders.
 let timelineBuilds=0,dataBuilds=0
 context.allMatterTimelineData=()=>{timelineBuilds++;return []}
 context.mioDeskBuildData=()=>{dataBuilds++;return {}}
 const withdrawalSource=fs.readFileSync('src/MioWithdrawalDashboard.jsx','utf8')
 const withdrawalHook=withdrawalSource.slice(withdrawalSource.indexOf('export function useMioWithdrawals('),withdrawalSource.indexOf('\nconst when=')).replace('export function','function')
 const snapshot={rows:{one:{owner_id:'u1'},other:{owner_id:'u2'}},loading:false,error:''}
 Object.assign(context,{useEffect:()=>{},useSyncExternalStore:()=>snapshot,store:{subscribe:()=>()=>{},getSnapshot:()=>snapshot},EMPTY:{rows:{}}})
 vm.createContext(context)
 vm.runInContext(withdrawalHook+';this.readWithdrawals=useMioWithdrawals;this.read=function(){'+memoSource+';return mioDeskData}',context)
 const {JSDOM}=await import('jsdom'),{createRoot}=await import('react-dom/client')
 const dom=new JSDOM('<div id="memo-root"></div>');const previousWindow=globalThis.window,previousDocument=globalThis.document
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const root=createRoot(document.getElementById('memo-root'))
 function Harness({draft}){context.billingForm={description:draft};context.mioWithdrawalSnapshot=context.readWithdrawals('u1',true);context.read();return React.createElement('input',{value:draft,readOnly:true})}
 try{
  for(const draft of ['','Review','Review orders'])await React.act(async()=>root.render(React.createElement(Harness,{draft})))
  assert.equal(dataBuilds,1);assert.equal(timelineBuilds,1)
  assert.deepEqual(Object.keys(context.mioWithdrawalSnapshot.rows),['one'])
  context.billingEntries=[]
  await React.act(async()=>root.render(React.createElement(Harness,{draft:'Saved'})))
  assert.equal(dataBuilds,2);assert.equal(timelineBuilds,1)
  context.events=[]
  await React.act(async()=>root.render(React.createElement(Harness,{draft:'Saved'})))
  assert.equal(dataBuilds,3);assert.equal(timelineBuilds,2)
  snapshot.rows={...snapshot.rows,two:{owner_id:'u1'}}
  await React.act(async()=>root.render(React.createElement(Harness,{draft:'Saved'})))
  assert.equal(dataBuilds,4);assert.equal(timelineBuilds,2)
  assert.deepEqual(Object.keys(context.mioWithdrawalSnapshot.rows),['one','two'])
 }finally{await React.act(async()=>root.unmount());dom.window.close();globalThis.window=previousWindow;globalThis.document=previousDocument}
})

test('each native task queue carries the linked client name separately from the cause number',async()=>{
 const {clientNameForMatter}=await import('../src/dashboard/model.js')
 const matter={id:'m1',name:'SAPCR/Modification 12345',client_id:'c1',matter_status:'Drafted - need to serve'}
 const context={matters:[matter],clients:[{id:'c1',first_name:'Jane',last_name:'Adams'}],mioDeskClientName:clientNameForMatter,checklistMatterOpenClosedValue:()=> 'open',canOpenPage:()=>true,checklistDisplayRows:()=>[{event:{id:'e1'}}],checklistMatterForEvent:()=>matter,checklistWorkspaceContextForEvent:()=>({}),checklistEventCategoryLabel:()=> 'Hearing',currentNeedToSetStatus:()=>({stepName:'Acquire dates'}),orderRows:[{id:'o1',matter_id:'m1',title:'Final order'}],orderWorkspaceContext:()=>({}),orderCurrentHolder:()=> 'counsel',orderHolderLabel:()=> 'Opposing counsel'}
 vm.runInNewContext(nativeFunction('mioDeskRows')+';this.read=mioDeskRows',context)
 const rows=context.read()
 assert.deepEqual(Array.from(rows,r=>r.kind),['settings','orders','service'])
 for(const row of rows){assert.equal(row.clientName,'Jane Adams');assert.equal(row.matterName,'SAPCR/Modification 12345')}
})

test('global clock summary reuses coverage while typing, and refreshes after a saved entry',async()=>{
 const React=await import('react'),{JSDOM}=await import('jsdom'),{createRoot}=await import('react-dom/client')
 const plugin=fs.readFileSync('mio-v313-pnc-daily-trust.js','utf8')
 const memo=plugin.match(/  const mioDailyCoverageValue=useMemo[^\n]+/)[0]
 assert.match(plugin,/const coverage = mioDailyCoverageValue/)
 assert.match(plugin,/bulkFinanceByMatterId.get/)
 const context={useMemo:React.useMemo}
 for(const name of memo.match(/,\[([^\]]+)\]/)[1].split(','))context[name]=null
 let calculations=0
 Object.assign(context,{showDailyBillingWindow:true,mioDailyCoverage:()=>{calculations++;return {total:123}}})
 vm.createContext(context);vm.runInContext('this.read=function(){'+memo+';return mioDailyCoverageValue}',context)
 const dom=new JSDOM('<div id="clock-root"></div>'),previousWindow=globalThis.window,previousDocument=globalThis.document
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const root=createRoot(document.getElementById('clock-root'))
 function Harness({draft}){context.billingForm={description:draft};return React.createElement('span',null,context.read()?.total)}
 try{
  for(const draft of ['','Review','Review hearing order'])await React.act(async()=>root.render(React.createElement(Harness,{draft})))
  assert.equal(calculations,1)
  context.billingEntries=[];await React.act(async()=>root.render(React.createElement(Harness,{draft:'saved'})))
  assert.equal(calculations,2)
  context.dailyBillingDate='2026-11-17';await React.act(async()=>root.render(React.createElement(Harness,{draft:'saved'})))
  assert.equal(calculations,3)
 }finally{await React.act(async()=>root.unmount());dom.window.close();globalThis.window=previousWindow;globalThis.document=previousDocument}
})

test('dashboard add setting uses the native undated event form without leaving the page',()=>{
 const context={emptyEventForm:{matter_id:'',title:'',start_date:'today'},setEditingEventId:v=>context.editing=v,setEventForm:v=>context.form=v,setShowEventWindow:v=>context.open=v}
 vm.runInNewContext(nativeFunction('openAddEventWindow')+'\n'+nativeFunction('openAddUndatedEventWindow')+';this.add=openAddUndatedEventWindow',context)
 context.add()
 assert.equal(context.form.start_date,'');assert.equal(context.form.end_date,'');assert.equal(context.open,true)
 assert.ok(code.includes("onAddNeedToSet={canOpenPage('need_to_set')?openAddUndatedEventWindow:null}"))
 assert.ok(code.includes("<SmartMatterSelect activeOnly={page==='dashboard'}"))
})
test('embedded planning is restricted to open cases while full-page filters keep their defaults',()=>{
 assert.ok(code.includes('function renderMatterTimelinesPage(openOnly = false)'))
 assert.ok(code.includes("(!openOnly || checklistMatterOpenClosedValue(row.matter)==='open')"))
 assert.ok(code.includes('function renderChecklistTimelineView(openOnly = false)'))
 assert.ok(code.includes("(!openOnly || checklistMatterOpenClosedValue(checklistMatterForEvent(event)||{is_active:false})==='open')"))
 assert.ok(code.includes('renderMatterTimelinesPage(true)'))
 assert.ok(code.includes('renderChecklistTimelineView(true)'))
})

test('dashboard calendar omits points from closed and inactive matters',()=>{
 const bridge=fs.readFileSync('src/dashboard/appBridge.inc','utf8')
 const start=bridge.indexOf('  const mioDeskTimeline=useMemo('),end=bridge.indexOf('  const mioDeskData=useMemo(',start),memo=bridge.slice(start,end)
 const context={}
 for(const name of memo.match(/,\[([^\]]+)\]/)[1].split(','))context[name]=null
 Object.assign(context,{page:'dashboard',session:{user:{id:'u1'}},isFirmStaffMember:()=>true,canOpenPage:()=>true,useMemo:calculate=>calculate(),allMatterTimelineData:()=>[
  {matter:{id:'open',case_status:'Client'},points:[{sourceId:'e1',type:'hearing',sourceType:'event',date:'2026-11-18',label:'Open hearing'}]},
  {matter:{id:'closed',case_status:'Closed'},points:[{sourceId:'e2',type:'hearing',sourceType:'event',date:'2026-11-18',label:'Closed hearing'}]},
  {matter:{id:'inactive',is_active:false},points:[{sourceId:'e3',type:'hearing',sourceType:'event',date:'2026-11-18',label:'Inactive hearing'}]}
 ]})
 vm.runInNewContext(nativeFunction('checklistMatterOpenClosedValue')+'\n'+memo+';this.timeline=mioDeskTimeline',context)
 assert.deepEqual(Array.from(context.timeline,r=>r.matterId),['open'])
})

test('task and withdrawal rows share the same matter trust without recomputing balances per task',async()=>{
 const {sortedTrust}=await import('../src/dashboard/model.js')
 let calculations=0
 const context={mioDeskToday:'2026-11-17',mioDeskFinanceState:{ready:true},matters:[{id:'m1',name:'Matter one'},{id:'m2',name:'Matter two'}],clients:[],billingEntries:[],mioInvoices:[],documents:[],canOpenPage:()=>true,checklistMatterOpenClosedValue:()=> 'open',currentBillingUserId:()=> 'u1',pendingLawPayAmountForMatter:()=>0,mioDeskWeekStart:d=>d,mioDeskPeriodSummary:()=>({}),mioDeskSortedTrust:sortedTrust,mioDeskClientName:()=> 'Example client',mioDeskRecentBillSends:()=>[],mioDeskRows:()=>[{matterId:'m1',kind:'settings'},{matterId:'m1',kind:'orders'},{matterId:'m2',kind:'service'}],mioDeskWithdrawals:()=>[{id:'m1'}],mioDeskFinanceFor:m=>{calculations++;return {trust:250,financialSnapshotResolved:m.id!=='m2'}}}
 vm.runInNewContext(nativeFunction('mioDeskBuildData')+';this.build=mioDeskBuildData',context)
 const data=context.build()
 assert.deepEqual(Array.from(data.rows,r=>r.trust),[250,250,null])
 assert.equal(data.withdrawals[0].trust,250)
 assert.equal(calculations,2)
 context.canOpenPage=page=>page!=='billing'
 const restricted=context.build()
 assert.ok(restricted.rows.every(r=>r.financeVisible===false&&r.trust===null))
 assert.equal(restricted.withdrawals[0].financeVisible,false)
 assert.equal(calculations,2)
})
