import fs from 'node:fs'
import assert from 'node:assert/strict'
import {nativeMatterReference,legacyLinkChanged} from '../src/mioNativeMatterIdentity.js'
import {caseFilterValues,caseFilterMatches,initialFilterValue,rebaseFilterValue} from '../src/mioStickyFilterValues.js'
const config=fs.readFileSync('vite.config.js','utf8'),order=config.split('plugins: [')[1].split('react()')[0]
const specs=[...config.matchAll(/import (\w+) from '\.\/(mio-[^']+)'/g)].filter(([,name])=>order.includes(name+'()')).sort((a,b)=>order.indexOf(a[1]+'()')-order.indexOf(b[1]+'()'))
const plugins=await Promise.all(specs.map(async([,,f])=>(await import('../'+f)).default()))
export async function composed(file){let code=fs.readFileSync(file,'utf8');for(const p of plugins){const o=await p.transform?.(code,'/repo/'+file);code=typeof o==='string'?o:o?.code??code}return code}
const app=await composed('src/App.jsx')
const names=[...app.matchAll(/useMioStickyFilter\('([^']+)'/g)].map(x=>x[1]);assert.ok(names.length>=50)
for(const name of ['documentFilters','discoveryCaseStatusFilter','matterPageSearch','matterPageFilterCaseStatus','calendarCaseStatusFilter','checklistCaseStatusFilter','bulkBillingFilters','billingFilters','orderFilters','discoverySort'])assert.ok(names.includes(name),name)
assert.ok(!app.includes('Enter the Clio Matter Number too'));assert.ok(app.includes('clioLinkChanged && duplicateNumberLink'))
assert.ok(app.includes("if (matter.id) return 'mio:' + String(matter.id)"))
assert.equal((app.match(/Legacy Clio reference \(optional\)/g)||[]).length,2)
assert.ok(app.includes('className="mio-discovery-compact"'))
assert.ok(app.includes('className="mio-doc-link" disabled={!row.document} onClick={() => openDocumentEditWindow(row.document)}'))
const save=app.slice(app.indexOf('  async function saveMatter(e) {'),app.indexOf('  async function saveSettingOption(e) {'))
async function savingFixture(previous,draft,existing=true,others={}){
 const calls=[],alerts=[],saved=[]
 const query={select(){return query},single:async()=>({data:{id:'mio-1'},error:null}),eq(){return query}}
 const values={nativeMatterReference,legacyLinkChanged,matterForm:{client_id:'client-1',name:'Mio Case',matter_status:'Open'},matterClioLinkDraft:draft,normalizeClioMatterNumber:x=>String(x||'').trim(),editingMatterId:existing?'mio-1':null,clioMioRosetta:{'mio-1':previous,...others},usedClioMatterIdsInRosetta:()=>new Set(['999']),clioMatters:[],matters:existing?[{id:'mio-1',matter_status:'Open'}]:[],supabase:{from(table){assert.equal(table,'matters');return{update(data){calls.push(['update',data]);return query},insert(data){calls.push(['insert',data]);return query}}}},alert:x=>alerts.push(x),saveMatterExtraForId:()=>{},matterExtraDraft:{},setClioMioRosetta:v=>saved.push(v),saveMioStateKeyNow:async(...args)=>{calls.push(args);return true},clioMatterDisplay:()=>'',closeMatterWindow:()=>calls.push(['close']),fetchMatters:()=>calls.push(['refresh'])}
 await new Function(...Object.keys(values),'return ('+save.trim()+')')(...Object.values(values))({preventDefault(){}})
 return{calls,alerts,saved}
}
for(const previous of [{clio_matter_id:'999'},{clioMatterId:'999'},{clio_matter_id:'old-not-a-number'},{}]){
 const f=await savingFixture(previous,{clio_matter_id:previous.clio_matter_id||previous.clioMatterId||'',clio_display_number:''})
 assert.deepEqual(f.alerts,[]);assert.ok(f.calls.some(c=>c[0]==='update'));assert.equal(f.saved.length,0)
 assert.ok(!f.calls.some(c=>c[0]==='caseMioClioMioRosetta'))
}
const created=await savingFixture({}, {clio_matter_id:'',clio_display_number:''},false)
assert.deepEqual(created.alerts,[]);assert.ok(created.calls.some(c=>c[0]==='insert'));assert.equal(created.saved.length,0)
const explicit=await savingFixture({}, {clio_matter_id:'12345',clio_display_number:''})
assert.deepEqual(explicit.alerts,[]);assert.equal(explicit.saved.length,1)
assert.equal(nativeMatterReference({id:'uuid',name:'New case',cause_number:'2026-XYZ',clio_display_number:'old'}),'2026-XYZ')
assert.equal(nativeMatterReference({id:'uuid',name:'New case',clio_display_number:'old'}),'New case')
console.log('PASS native matter save/create with no Clio number, unchanged legacy links, optional legacy editing, native invoice references')
const sortFn=app.slice(app.indexOf('  function sortedDiscoveryRows(rows) {'),app.indexOf('  function setDiscoverySortColumn('))
const rows=[{id:'empty',response_due:''},{id:'new',response_due:'2026-09-30'},{id:'invalid',response_due:'N/A'},{id:'old',response_due:'2026-08-01'},{id:'null',response_due:null}]
for(const direction of ['asc','desc']){
 const sort=new Function('discoverySort','discoverySortValue','return ('+sortFn.trim()+')')({key:'response_due',direction},r=>Date.parse(r.response_due)||99999999999999)
 const actual=sort(rows).map(r=>r.id)
 assert.deepEqual(actual.slice(0,2),direction==='desc'?['new','old']:['old','new']);assert.deepEqual(new Set(actual.slice(2)),new Set(['empty','invalid','null']))
}
const options=['Open','Closed','Pending','','Closed - archived']
assert.deepEqual(caseFilterValues(null,options),['Open','Pending',''])
assert.deepEqual(caseFilterValues([],options),[]);assert.deepEqual(caseFilterValues(['Closed'],options),['Closed'])
assert.deepEqual(caseFilterValues(['__all__'],options),options)
assert.equal(caseFilterMatches(null,'Closed'),false);assert.equal(caseFilterMatches(['Closed'],'Closed'),true)
assert.deepEqual(initialFilterValue('bulkBillingFilters',{case_status:'all',search:'text'}),{case_status:'__open__',search:'text'})
const wrap=value=>JSON.stringify({schema:1,value})
assert.deepEqual(JSON.parse(rebaseFilterValue(wrap({case:'Open',text:''}),wrap({case:'Open',text:'Ellis'}),wrap({case:'Closed',text:''}))).value,{case:'Closed',text:'Ellis'})
assert.deepEqual(JSON.parse(rebaseFilterValue(wrap(['Open']),wrap([]),wrap(['Closed']))).value,[])
console.log('PASS undated rows last both directions, closed defaults, explicit All/None and preference merge; '+names.length+' filters wired')
