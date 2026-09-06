// Supabase is durable storage; values awaiting acknowledgement exist only in RAM.
const otherKeys = new Set(['matterColumnWidths','matterExternalEfileUrl','matterPageFilterCaseStatus','matterPageFilterCaseType','matterPageFilterMatterStatus','matterPageSearch','serviceInboxFilter','serviceInboxFolderFilter','serviceInboxMailboxFilter','serviceInboxPhase','serviceInboxPreviewMode','serviceInboxRowDensity','serviceInboxSortMode','serviceInboxViewMode','showMatterStepsOnMatterPage','showUnpopulatedMatterStatuses','taskSubpartCompletions','visibleMatterColumns'])
export const isNativeKey = key => /^(sb-|msal\.|murski-auth-token$|caseMioSupabaseSessionV1$|caseMioBackgroundLeaseV258:)/i.test(key) || /supabase\.auth\.token|login\.windows\.net|microsoftonline|msal/i.test(key)
export const isAppKey = key => typeof key === 'string' && !isNativeKey(key) && (/^(caseMio|caseController)/.test(key) || otherKeys.has(key) || /^(taskTemplateSubparts|taskMarkReviewWhen|taskPriority):/.test(key))
const raw = row => row.raw_value != null ? String(row.raw_value) : typeof row.json_value === 'string' ? row.json_value : JSON.stringify(row.json_value ?? null)
export function createMioCloudStore({client, nativeStorage, origin='', delay=350}) {
  const listeners=new Set(), accounts=new Map()
  let current=null, generation=0, version=0, notifying=false
  const notify=()=>{version++;if(!notifying){notifying=true;queueMicrotask(()=>{notifying=false;listeners.forEach(fn=>fn())})}}
  const nativeKeys=()=>{const out=[];for(let i=0;i<nativeStorage.length;i++){const key=nativeStorage.key(i);if(key)out.push(key)}return out}
  const check=s=>{if(current!==s)throw new Error('Account changed; this operation was stopped.')}
  const ready=()=>{if(current?.phase!=='ready')throw new Error('Cloud data is not ready. This change has not been saved.');return current}
  const status=()=>({owner:current?.id||'',phase:current?.phase||'signed-out',pending:current?.pending.size||0,error:current?.error||'',conflicts:current?.conflicts.size||0,pausedPending:[...accounts.values()].filter(s=>s!==current).reduce((n,s)=>n+s.pending.size,0)})
  async function read(id) {
    const rows=[]
    for(let start=0;;start+=250){
      const {data,error}=await client.from('case_mio_user_state').select('key,raw_value,updated_at').eq('user_id',id).neq('key','__mio_live_state_snapshot__').order('key').range(start,start+249)
      if(error)throw error
      rows.push(...(data||[]).filter(r=>isAppKey(r.key)).map(r=>({...r,raw_value:raw(r)})))
      if(!data||data.length<250)return rows
    }
  }
  async function prepare(id) {
    const ticket=++generation
    if(current){clearTimeout(current.timer);current.phase='paused'}
    current=null;notify()
    if(!id)return
    const s=accounts.get(id)||{id,values:new Map(),baseline:new Map(),pending:new Map(),conflicts:new Set(),tail:Promise.resolve(),error:'',phase:'loading'}
    accounts.set(id,s);current=s;s.phase='loading'
    const rows=await read(id)
    if(ticket!==generation||current!==s)return
    for(const key of s.values.keys())if(!s.pending.has(key)){s.values.delete(key);s.baseline.delete(key)}
    for(const row of rows)if(!s.pending.has(row.key)){s.values.set(row.key,row.raw_value);s.baseline.set(row.key,row)}
    s.phase='prepared';notify()
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
  const legacyEntries=()=>nativeKeys().filter(isAppKey).map(key=>({key,raw_value:nativeStorage.getItem(key)})).filter(r=>r.raw_value!=null)
  async function archive(rows,reason='legacy-browser') {
    const s=current;if(!s)throw new Error('Sign in before preserving browser data.');check(s)
    const payload=rows.filter(r=>isAppKey(r.key)).map(r=>({user_id:s.id,key:r.key,raw_value:String(r.raw_value),origin,reason}))
    if(!payload.length)return
    const {data,error}=await client.from('case_mio_browser_recovery').insert(payload).select('id,key')
    if(error)throw error
    if(data?.length!==payload.length)throw new Error('Recovery copy was incomplete. Browser records were retained.')
    const {data:verified,error:readError}=await client.from('case_mio_browser_recovery').select('id,user_id,key,raw_value').eq('user_id',s.id).in('id',data.map(r=>r.id))
    if(readError)throw readError
    for(const row of payload)if(!verified?.some(r=>r.user_id===s.id&&r.key===row.key&&r.raw_value===row.raw_value))throw new Error('Recovery read-back failed. Browser records were retained.')
    check(s)
  }
  async function migrateLegacy() {
    const s=current;if(s?.phase!=='prepared')throw new Error('Migration must finish before the workspace opens.')
    const rows=legacyEntries();let removed=0,conflicts=0
    for(let i=0;i<rows.length;i+=8){
      const batch=rows.slice(i,i+8);await archive(batch);check(s)
      const missing=batch.filter(r=>!s.baseline.has(r.key))
      conflicts+=batch.filter(r=>s.baseline.has(r.key)&&s.baseline.get(r.key).raw_value!==r.raw_value).length
      if(missing.length){const {error}=await client.from('case_mio_user_state').upsert(missing.map(r=>({user_id:s.id,...r,json_value:null,origin,updated_at:new Date().toISOString()})),{onConflict:'user_id,key',ignoreDuplicates:true});if(error)throw error}
      check(s)
      for(const row of batch)if(nativeStorage.getItem(row.key)===row.raw_value){nativeStorage.removeItem(row.key);removed++}
    }
    const fresh=await read(s.id);check(s)
    for(const row of fresh)if(!s.pending.has(row.key)){s.values.set(row.key,row.raw_value);s.baseline.set(row.key,row)}
    notify();return{archived:rows.length,removed,conflicts,remaining:legacyEntries().length}
  }
  async function preservePending() {
    const s=ready();clearTimeout(s.timer);s.phase='preserving';notify()
    try {
      await s.tail;check(s)
      const entries=[...s.pending]
      for(let i=0;i<entries.length;i+=8)await archive(entries.slice(i,i+8).map(([key,change])=>({key,raw_value:change.deleting?JSON.stringify({mio_recovery_operation:'delete'}):change.raw})),'pending-edit')
      for(const [key,change] of entries)if(s.pending.get(key)===change){s.pending.delete(key);s.conflicts.delete(key)}
      notify();return !s.pending.size
    }finally{if(current===s){s.phase='ready';notify();if(s.pending.size)schedule(s)}}
  }
  const storage={
    getItem(key){key=String(key);return isAppKey(key)?current?.values.get(key)??null:nativeStorage.getItem(key)},
    setItem(key,value){key=String(key);if(isAppKey(key)){if(['ready','preserving'].includes(current?.phase))stage(key,value);return}if(!isNativeKey(key))throw new Error('Application data cannot be written to browser storage.');nativeStorage.setItem(key,String(value))},
    removeItem(key){key=String(key);if(isAppKey(key)){if(['ready','preserving'].includes(current?.phase))stage(key,null,true);return}if(isNativeKey(key))nativeStorage.removeItem(key)},
    clear(){throw new Error('Bulk browser clearing is disabled. Preserve records in Supabase first.')},
    key(index){return [...new Set([...nativeKeys().filter(isNativeKey),...(current?.values.keys()||[])])][index]??null},
    get length(){return new Set([...nativeKeys().filter(isNativeKey),...(current?.values.keys()||[])]).size},
  }
  return {storage:new Proxy(storage,{ownKeys:()=>Array.from({length:storage.length},(_,i)=>storage.key(i)),getOwnPropertyDescriptor(target,key){if(storage.getItem(key)!=null)return{enumerable:true,configurable:true,value:storage.getItem(key)};return Object.getOwnPropertyDescriptor(target,key)}}),
    prepare,activate(){if(current?.phase==='prepared'){current.phase='ready';notify();if(current.pending.size)schedule(current)}},
    stage,saveNow,flushAll,archive,migrateLegacy,legacyEntries,preservePending,status,
    records:()=>current?[...current.values].map(([key,raw_value])=>({...current.baseline.get(key),key,raw_value,json_value:null})):[],
    snapshot:()=>Object.fromEntries(current?.values||[]),
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},getVersion:()=>version,
  }
}
