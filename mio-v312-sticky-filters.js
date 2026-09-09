function once(code,from,to,label){if(code.split(from).length!==2)throw new Error('V312 filter anchor changed: '+label);return code.replace(from,()=>to)}
export default function stickyFilters(){return{name:'mio-v312-sticky-filters',enforce:'pre',transform(source,id){
 const path=id.split('?')[0].replaceAll('\\','/');let code=source
 if(path.endsWith('/src/mioCloudStore.js')){
  code="import {STICKY_FILTER_PREFIX,rebaseFilterValue} from './mioStickyFilterValues.js'\n"+code
  code=once(code,'  async function write(s,key) {','  async function write(s,key,retry=0) {','bounded preference retry')
  const anchor="    if(error){s.error=error.message||String(error);if(['PT409','40001'].includes(error.code))s.conflicts.add(key);notify();throw error}"
  code=once(code,anchor,`    if(error && ['PT409','40001'].includes(error.code) && (key.startsWith(STICKY_FILTER_PREFIX)||key==='caseMioWithdrawalViewV305') && !change.deleting && retry<2){
      const {data:remote,error:readError}=await client.from('case_mio_user_state').select('key,raw_value,json_value,updated_at').eq('user_id',s.id).eq('key',key).maybeSingle()
      check(s);if(readError)throw readError
      const pending=s.pending.get(key)
      if(pending&&!pending.deleting){
        const remoteRaw=remote?raw(remote):null,merged=rebaseFilterValue(old?.raw_value,pending.raw,remoteRaw)
        if(remote)s.baseline.set(key,{...remote,raw_value:remoteRaw});else s.baseline.delete(key)
        s.pending.set(key,{...pending,raw:merged});s.values.set(key,merged);s.conflicts.delete(key);notify()
        return write(s,key,retry+1)
      }
    }
`+anchor,'rebase only view preferences')
  return{code,map:null}
 }
 if(path.endsWith('/src/mioWorkflowBlocks.js')){
  code="import {isClosedCaseStatus} from './mioStickyFilterValues.js'\n"+code
  code=once(code,"export function matchesWithdrawalView(row,v){return ['matter_status','case_status','case_type'].every(k=>!v[k]?.length||v[k].includes(row[k]))}","export function matchesWithdrawalView(row,v){return (!v.case_status?.length&&!v.case_status_explicit?!isClosedCaseStatus(row.case_status):true)&&['matter_status','case_status','case_type'].every(k=>!v[k]?.length||v[k].includes(row[k]))}",'withdrawal open default')
  return{code,map:null}
 }
 if(path.endsWith('/src/MioWithdrawalBlocks.jsx')){
  code="import {isClosedCaseStatus} from './mioStickyFilterValues.js'\n"+code
  code=once(code,'value={view[k]} onChange={value=>changeView({[k]:value})}',"value={k==='case_status'&&!view[k].length&&!view.case_status_explicit?((optionLists[k]||[]).filter(o=>!isClosedCaseStatus(o.name)).map(o=>o.name).concat('__default_open__')):view[k]} onChange={value=>changeView({[k]:value.filter(v=>v!=='__default_open__'),...(k==='case_status'?{case_status_explicit:true}:{})})}",'withdrawal checkbox default and explicit selection')
  return{code,map:null}
 }
 if(!path.endsWith('/src/App.jsx'))return null
 code="import {useMioStickyFilter,ignoreLegacyFilterWrite} from './useMioStickyFilter.js'\nimport {caseFilterValues,caseFilterMatches,isClosedCaseStatus} from './mioStickyFilterValues.js'\n"+code
 code=once(code,"  keys.forEach((key) => { next[key] = '' })","  // Retain searches and categorical filters exactly as selected.",'retain search text')
 code=code.replaceAll("...clearTransientSearchFields(saved, ['search']), search: ''","...clearTransientSearchFields(saved, ['search'])").replaceAll("...clearTransientSearchFields(value, ['search']), search: ''","...clearTransientSearchFields(value, ['search'])")
 code=once(code,"  BULK_INVOICE_PERSISTED_FILTER_KEYS.forEach((key) => { next[key] = String(source[key] || '') })","  Object.keys(next).forEach((key) => { next[key] = String(source[key] ?? '') })",'retain invoice column filters')
 for(const target of ['setDiscoveryStatusFilter','setChecklistFilter'])code=once(code,"    if (!Array.isArray(current)) return allValues\n    return current.filter((value) => allValues.includes(value))\n  }\n\n  function "+target,"    if (kind === 'case') return caseFilterValues(current,allValues)\n    if (!Array.isArray(current)) return allValues\n    return current.filter((value) => allValues.includes(value))\n  }\n\n  function "+target,target+' default')
 code=once(code,'const caseStatusMatches = matterPageFilterMatches(matterPageFilterCaseStatus, effectiveMatterCaseStatus(matter))','const caseStatusMatches = caseFilterMatches(matterPageFilterCaseStatus, effectiveMatterCaseStatus(matter))','Matters closed default')
 code=once(code,'  function MatterPageCheckboxFilter({ title, filterKey, value, optionsList }) {',"  function MatterPageCheckboxFilter({ title, filterKey, value, optionsList }) {\n    if(filterKey==='case_status')value=caseFilterValues(value,optionsList)",'Matters checkbox values')
 code=once(code,'onClick={() => updateMatterPageFilter(filterKey, null)}>All','onClick={() => updateMatterPageFilter(filterKey, filterKey===\'case_status\'?optionsList.map(o=>o.value):null)}>All','explicit Matters All')
 code=once(code,"    if (caseSelected && !caseSelected.includes(String(matter?.case_status || ''))) return false","    if (!caseFilterMatches(calendarCaseStatusFilter,String(matter?.case_status || ''))) return false",'Calendar closed default')
 code=once(code,'setCalendarCaseStatusFilter(null)}>All',"setCalendarCaseStatusFilter(['__all__'])}>All",'Calendar All')
 code=once(code,'checked={!Array.isArray(calendarCaseStatusFilter) || calendarCaseStatusFilter.includes(value)}','checked={caseFilterMatches(calendarCaseStatusFilter,value)}','Calendar checkboxes')
 code=once(code,"const all = calendarStatusOptions('case_status'); const selected = Array.isArray(current) ? current : all;","const all = calendarStatusOptions('case_status'); const selected = caseFilterValues(current,all);",'Calendar toggle')
 code=once(code,"Array.isArray(calendarCaseStatusFilter) ? calendarCaseStatusFilter.length : calendarStatusOptions('case_status').length","caseFilterValues(calendarCaseStatusFilter,calendarStatusOptions('case_status')).length",'Calendar count')
 code=code.replaceAll('selectedMatterTimelineFilters(matterTimelineCaseStatusFilters,','caseFilterValues(matterTimelineCaseStatusFilters,')
 code=once(code,"const current = selectedMatterTimelineFilters(kind === 'case' ? matterTimelineCaseStatusFilters : matterTimelineMatterStatusFilters, optionRows)","const current = kind==='case'?caseFilterValues(matterTimelineCaseStatusFilters,optionRows):selectedMatterTimelineFilters(matterTimelineMatterStatusFilters,optionRows)",'Timeline toggle')
 code=once(code,'const selected = normalized[filterKey]',"const selected = filterKey==='case_statuses'?caseFilterValues(normalized[filterKey],matterSettingsFilterOptions(filterKey)):normalized[filterKey]",'linked table closed default')
 code=once(code,"const selected = Array.isArray(filters?.[filterKey]) ? filters[filterKey].map(String) : null","const selected = filterKey==='case_statuses'?caseFilterValues(filters?.[filterKey],options):(Array.isArray(filters?.[filterKey]) ? filters[filterKey].map(String) : null)",'linked table checkbox values')
 code=once(code,'setFilters(normalizeMatterSettingsChecklistFilters({}))',"setFilters({...normalizeMatterSettingsChecklistFilters({}),case_statuses:matterSettingsFilterOptions('case_statuses').map(o=>o.value)})",'linked tables All')
 code=once(code,"const caseMatches = settingsMatterTableFilters.case_status === 'all' || normalizeMatterStatus(matter.case_status) === normalizeMatterStatus(settingsMatterTableFilters.case_status)","const caseMatches = caseFilterMatches(settingsMatterTableFilters.case_status,matter.case_status)",'Settings default')
 code=once(code,"if (bulkBillingFilters.case_status !== 'all' && String(matter.case_status || matter.status || '') !== bulkBillingFilters.case_status) return false","if (!caseFilterMatches(bulkBillingFilters.case_status,String(matter.case_status || matter.status || ''))) return false",'Billing default')
 code=once(code,"if (clioGraphCaseStatusFilter !== 'all' && clioStatus !== clioGraphCaseStatusFilter) return false","if (!caseFilterMatches(clioGraphCaseStatusFilter,clioStatus)) return false",'legacy graph default')
 for(const field of ['bulkBillingFilters.case_status','settingsMatterTableFilters.case_status']){
   const start=code.indexOf('<select value={'+field+'}'),stop=code.indexOf('</select>',start);if(start<0||stop<0)throw new Error('V312 status select missing: '+field)
   const old=code.slice(start,stop);code=code.slice(0,start)+old.replace('<option value="all">','<option value="__open__">Hide closed</option><option value="all">')+code.slice(stop)
 }
 const graphSelect="selected={clioGraphCaseStatusFilters} onToggle={(value) => toggleMultiValue(clioGraphCaseStatusFilters, value, setClioGraphCaseStatusFilters)}"
 code=code.replaceAll(graphSelect,"selected={clioGraphCaseStatusFilters.includes('__open__')?caseFilterValues(null,clioCaseStatusOptions):clioGraphCaseStatusFilters} onToggle={(value) => toggleMultiValue(clioGraphCaseStatusFilters.includes('__open__')?caseFilterValues(null,clioCaseStatusOptions):clioGraphCaseStatusFilters, value, setClioGraphCaseStatusFilters)}")
 code=once(code,"if (selectedCaseStatuses.length && !selectedCaseStatuses.includes(normalizedCaseStatus)) return false","if (selectedCaseStatuses.includes('__open__') ? isClosedCaseStatus(normalizedCaseStatus) : selectedCaseStatuses.length && !selectedCaseStatuses.includes(normalizedCaseStatus)) return false",'graph matching')
 const excluded=new Set(['clioSavedGraphFilters','clioNewGraphFilterName','clioSelectedSavedGraphFilter','litigationTrackFilterOpen','checklistTimelineFilterOpen','checklistFilterSectionOpen','manualRfpDocumentSearch','manualRfpDocumentStatusFilter','tagSearch'])
 const legacyKeys=new Set(),states=[]
 code=code.replace(/^  const \[(\w+), (set\w+)\] = useState\(/gm,(text,name)=>{
   if(!(/filter|search/i.test(name)||name==='discoverySort')||excluded.has(name))return text
   states.push(name);return text.replace('useState(',"useMioStickyFilter('"+name+"', ")
 })
 if(states.length<50)throw new Error('V312 filter coverage changed: '+states.length)
 for(const name of states){
   const start=code.indexOf("useMioStickyFilter('"+name+"', "),end=code.indexOf('\n  const ',start),init=code.slice(start,end<0?start+1000:end)
   for(const m of init.matchAll(/getItem\('([^']+)'\)/g))legacyKeys.add(m[1])
 }
 legacyKeys.add('matterPageSearch');['matterPageFilterCaseStatus','matterPageFilterMatterStatus','matterPageFilterCaseType'].forEach(k=>legacyKeys.add(k))
 code='const mioLegacyFilterKeysV312=new Set('+JSON.stringify([...legacyKeys])+')\n'+code
 code=once(code,'  function applyMioCloudStateRecord(record) {',"  function applyMioCloudStateRecord(record) {\n    if(mioLegacyFilterKeysV312.has(record.key))return",'no rehydration over explicit preferences')
 code=once(code,'  function saveMioStateKey(key, value) {',"  function saveMioStateKey(key, value) {\n    if(mioLegacyFilterKeysV312.has(key))return",'no mount-time preference overwrite')
 for(const key of legacyKeys)for(const fn of ['safeSetLocalStorage','localStorage.setItem','localStorage.removeItem'])code=code.replaceAll(fn+"('"+key+"'","ignoreLegacyFilterWrite('"+key+"'")
 return{code,map:null}
}}}
