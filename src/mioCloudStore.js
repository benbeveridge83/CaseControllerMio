import {readMioCloudRows} from './mioCloudRead.js'
// Supabase is durable storage; values awaiting acknowledgement exist only in RAM.
const otherKeys = new Set(['matterColumnWidths','matterExternalEfileUrl','matterPageFilterCaseStatus','matterPageFilterCaseType','matterPageFilterMatterStatus','matterPageSearch','serviceInboxFilter','serviceInboxFolderFilter','serviceInboxMailboxFilter','serviceInboxPhase','serviceInboxPreviewMode','serviceInboxRowDensity','serviceInboxSortMode','serviceInboxViewMode','showMatterStepsOnMatterPage','showUnpopulatedMatterStatuses','taskSubpartCompletions','visibleMatterColumns'])
export const isNativeKey = key => /^(sb-|msal\.|murski-auth-token$|caseMioSupabaseSessionV1$|caseMioBackgroundLeaseV258:)/i.test(key) || /supabase\.auth\.token|login\.windows\.net|microsoftonline|msal/i.test(key)
export const isAppKey = key => typeof key === 'string' && !isNativeKey(key) && (/^(caseMio|caseController)/.test(key) || otherKeys.has(key) || /^(taskTemplateSubparts|taskMarkReviewWhen|taskPriority):/.test(key))
const raw = row => row.raw_value != null ? String(row.raw_value) : typeof row.json_value === 'string' ? row.json_value : JSON.stringify(row.json_value ?? null)
export function createMioCloudStore({client, nativeStorage, origin='', delay=350}) {
  const listeners=new Set(), accounts=new Map()
  let current=null, generation=0, version=0, notifying=false, loadController=null
  const notify=()=>{version++;if(!notifying){notifying=true;queueMicrotask(()=>{notifying=false;listeners.forEach(fn=>fn())})}}
  const nativeKeys=()=>{const out=[];for(let i=0;i<nativeStorage.length;i++){const key=nativeStorage.key(i);if(key)out.push(key)}return out}
  const check=s=>{if(current!==s)throw new Error('Account changed; this operation was stopped.')}
  const ready=()=>{if(current?.phase!=='ready')throw new Error('Cloud data is not ready. This change has not been saved.');return current}
  const status=()=>({owner:current?.id||'',phase:current?.phase||'signed-out',loadProgress:current?.loadProgress||null,pending:current?.pending.size||0,error:current?.error||'',conflicts:current?.conflicts.size||0,pausedPending:[...accounts.values()].filter(s=>s!==current).reduce((n,s)=>n+s.pending.size,0)})
  async function read(id, options = {}) {
    const rows=await readMioCloudRows(client,id,{isAppKey,...options})
    return rows.map(row=>({...row,raw_value:raw(row)}))
  }
  async function prepare(id) {
    const ticket=++generation
    loadController?.abort()
    const controller=new AbortController();loadController=controller
    if(current){clearTimeout(current.timer);current.phase='paused'}
    current=null;notify()
    if(!id)return
    const s=accounts.get(id)||{id,values:new Map(),baseline:new Map(),pending:new Map(),conflicts:new Set(),tail:Promise.resolve(),error:'',phase:'loading'}
    accounts.set(id,s);current=s;s.phase='loading';s.loadProgress={phase:'listing',loaded:0,total:0};notify()
    try {
      const rows=await read(id,{signal:controller.signal,onProgress:progress=>{
        if(ticket===generation&&current===s){s.loadProgress=progress;notify()}
      }})
      if(ticket!==generation||current!==s)return
      // Only commit a complete read. Timeouts must not enable empty defaults.
      for(const key of s.values.keys())if(!s.pending.has(key)){s.values.delete(key);s.baseline.delete(key)}
      for(const row of rows)if(!s.pending.has(row.key)){s.values.set(row.key,row.raw_value);s.baseline.set(row.key,row)}
      s.phase='prepared';s.loadProgress=null;if(!s.pending.size)s.error='';notify()
    } catch(error) {
      if(ticket!==generation||current!==s)return
      s.phase='error';s.error=error.message||String(error);notify();throw error
    }
  }
  const enqueue=(s,fn)=>{const p=s.tail.catch(()=>{}).then(fn);s.tail=p.catch(()=>{});return p}
  const schedule=s=>{clearTimeout(s.timer);s.timer=setTimeout(()=>{if(current===s&&s.phase==='ready')void flushAll()},delay);s.timer.unref?.()}
  function stage(key,value,deleting=false) {
    const s=current
    if(!s || !['ready','preserving'].includes(s.phase))throw new Error('Cloud data is not ready.')
    key=String(key)
    if(!isAppKey(key))throw new Error('Unregistered application storage key.')
    const text=deleting?null:String(value??'')
    if(deleting)s.values.delete(key);else s.values.set(key,text)
    const previous=s.pending.get(key)
    if(previous?.raw===text&&previous.deleting===deleting)return previous
    if(!previous&&(deleting?!s.baseline.has(key):s.baseline.get(key)?.raw_value===text))return null
    const change={raw:text,deleting};s.pending.set(key,change);notify();schedule(s);return change
  }
  async function write(s,key) {
    check(s)
    if(s.phase!=='ready')throw new Error('Cloud saving is paused.')
    const change=s.pending.get(key)
    if(!change)return
    if(s.conflicts.has(key))throw new Error('Another tab changed this record. Preserve the pending edit before reloading.')
    const old=s.baseline.get(key)
    const {data,error}=await client.rpc('mio_cloud_state_write_v277',{p_user_id:s.id,p_key:key,p_raw:change.raw,p_expected_at:old?.updated_at??null,p_expected_exists:!!old,p_delete:change.deleting,p_origin:origin})
    if(error){s.error=error.message||String(error);if(error.code==='40001')s.conflicts.add(key);notify();throw error}
    if(!data||(change.deleting?!data.deleted:data.raw_value!==change.raw)){
      s.error='Supabase did not acknowledge this value. Keep this tab open.';notify();throw new Error(s.error)
    }
    if(change.deleting)s.baseline.delete(key);else s.baseline.set(key,{...data,json_value:null})
    if(s.pending.get(key)===change)s.pending.delete(key)
    if(!s.pending.size)s.error=''
    notify()
  }
  async function flushAll() {
    if(current?.phase!=='ready')return false
    const s=current;clearTimeout(s.timer)
    await enqueue(s,async()=>{for(const key of [...s.pending.keys()]){if(current!==s||s.phase!=='ready')break;try{await write(s,key)}catch{}}})
    return s.pending.size===0
  }
  async function saveNow(key,value,{throwOnError=false}={}) {
    try {
      const s=ready();const text=String(value??'');stage(key,text)
      await enqueue(s,()=>write(s,key))
      if(s.baseline.get(key)?.raw_value!==text)throw new Error('A newer edit superseded this save. Review the current value before continuing.')
      return true
    }catch(error){if(throwOnError)throw error;return false}
  }
  async function removeNow(key,{throwOnError=false}={}) {
    try{const s=ready();stage(key,null,true);await enqueue(s,()=>write(s,key));if(s.baseline.has(key))throw new Error('Supabase did not confirm deletion.');return true}catch(error){if(throwOnError)throw error;return false}
  }
  async function archive(s,entries,reason) {
    if(!entries.length)return []
    check(s)
    const rows=entries.map(e=>({user_id:s.id,storage_key:e.key,raw_value:e.raw_value,source_origin:origin||location?.origin||'',reason}))
    const {data,error}=await client.from('case_mio_browser_recovery').insert(rows).select('id,storage_key,raw_value')
    if(error)throw error
    if(!data||data.length!==rows.length)throw new Error('Cloud recovery archive was not verified; browser records were left untouched.')
    return data
  }
  async function migrateLegacy() {
    const s=current;check(s);if(!s||!['prepared','ready'].includes(s.phase))throw new Error('Cloud state must load before browser migration.')
    const entries=nativeKeys().filter(isAppKey).map(key=>({key,raw_value:nativeStorage.getItem(key)})).filter(e=>e.raw_value!==null)
    if(!entries.length)return{archived:0,imported:0,conflicts:0,remaining:0}
    const archived=await archive(s,entries,'legacy-browser-migration-v277')
    const ids=archived.map(r=>r.id);const {data:verified,error}=await client.from('case_mio_browser_recovery').select('id,storage_key,raw_value').eq('user_id',s.id).in('id',ids)
    if(error||!verified||verified.length!==archived.length)throw error||new Error('Cloud recovery readback failed; browser records were left untouched.')
    const imported=[],conflicts=[]
    for(const entry of entries){const old=s.baseline.get(entry.key);if(!old)imported.push({user_id:s.id,key:entry.key,raw_value:entry.raw_value,json_value:null,origin:'legacy-browser-migration'});else if(old.raw_value!==entry.raw_value)conflicts.push(entry)}
    if(imported.length){const {error:e}=await client.from('case_mio_user_state').upsert(imported,{onConflict:'user_id,key',ignoreDuplicates:true});if(e)throw e}
    const fresh=await read(s.id);check(s);for(const row of fresh){s.values.set(row.key,row.raw_value);s.baseline.set(row.key,row)}
    for(const entry of entries){const cloud=s.baseline.get(entry.key);if(!cloud)throw new Error('Cloud verification is incomplete; browser records were left untouched.');const found=verified.some(v=>v.storage_key===entry.key&&v.raw_value===entry.raw_value);if(!found)throw new Error('Recovery archive mismatch; browser records were left untouched.')}
    for(const entry of entries)if(nativeStorage.getItem(entry.key)===entry.raw_value)nativeStorage.removeItem(entry.key)
    const remaining=nativeKeys().filter(isAppKey).length;notify();return{archived:entries.length,imported:imported.length,conflicts:conflicts.length,remaining}
  }
  async function preservePending() {
    const s=current;check(s);if(!s||!s.pending.size)return true
    const snapshot=[...s.pending].map(([key,p])=>({key,raw_value:p.deleting?'__MIO_DELETE_PENDING__':p.raw}))
    const expected=new Map(snapshot.map(e=>[e.key,s.pending.get(e.key)]))
    s.phase='preserving';clearTimeout(s.timer);notify()
    try{await archive(s,snapshot,'unsaved-memory-before-reload');check(s);for(const [key,change] of expected)if(s.pending.get(key)===change)s.pending.delete(key);s.phase='ready';notify();return s.pending.size===0}catch(error){s.error=error.message||String(error);s.phase='ready';notify();throw error}
  }
  const storage={
    get length(){return current?.values.size||0},
    key(i){return current?[...current.values.keys()][i]??null:null},
    getItem(key){return current?.values.has(String(key))?current.values.get(String(key)):null},
    setItem(key,value){if(current?.phase==='ready')stage(key,value)},
    removeItem(key){if(current?.phase==='ready')stage(key,null,true)},
    clear(){throw new Error('Mio application storage cannot be cleared from the browser.')},
  }
  return{storage,prepare,activate(){if(current?.phase==='prepared'){current.phase='ready';notify();schedule(current)}},stage,saveNow,removeNow,flushAll,migrateLegacy,preservePending,status,records:()=>current?[...current.values]:[],legacyEntries:()=>nativeKeys().filter(isAppKey).map(key=>({key,raw_value:nativeStorage.getItem(key)})).filter(e=>e.raw_value!==null),subscribe:fn=>(listeners.add(fn),()=>listeners.delete(fn)),getVersion:()=>version}
}
