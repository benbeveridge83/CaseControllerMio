export const answerFields=value=>({client_answer:String(value?.client_answer||''),client_comments:String(value?.client_comments||''),rfp_status:String(value?.rfp_status||''),needs_help:!!value?.needs_help})
export const sameAnswer=(a,b)=>JSON.stringify(answerFields(a))===JSON.stringify(answerFields(b))
const unique=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)
export function draftPrefix({owner,matterId,setId,requestId}={}){return owner&&matterId&&setId&&requestId?'mioPortalDiscoveryDraft:v1:'+JSON.stringify([owner.toLowerCase(),matterId,setId,requestId])+':':null}
export function browserDraftStorage(){try{return window.localStorage}catch{return null}}
export function browserDraftWriter(){try{let id=window.sessionStorage.getItem('mioPortalDiscoveryWriter');if(!id){id=unique();window.sessionStorage.setItem('mioPortalDiscoveryWriter',id)}return id}catch{return unique()}}

// One queue per request. Acknowledged server versions, rather than local typing,
// determine whether the UI may say "Saved online".
export function createDiscoveryAutosave({initial={},scope,storage=null,writer=unique(),save,onChange=()=>{},onSaved=()=>{},onPending=()=>{},readOnly=false,debounceMs=650,retryDelays=[1000,3000,10000,30000]}){
 let value=answerFields(initial),version=Number(initial.version)||0,dirty=false,running=false,status=version?'saved':'empty',error=null,timer=null,generation=0,attempt=0,disposed=false,recovered=false,backupWarning='',backupAvailable=false
 let callbacks={onChange,onSaved,onPending}
 const prefix=!readOnly?draftPrefix(scope):null,key=prefix?prefix+writer:null
 function copies(){
  if(!prefix||!storage)return []
  const result=[]
  try{for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k?.startsWith(prefix)){try{const d=JSON.parse(storage.getItem(k));if(d?.schema===1&&Number.isInteger(d.baseVersion)&&d.baseVersion>=0&&d.answer)result.push({key:k,...d})}catch{/* Preserve unreadable recovery data instead of erasing it. */}}}}
  catch{backupWarning='Device backup is unavailable. Keep this page open until your answer is saved online.'}
  return result.sort((a,b)=>b.updatedAt-a.updatedAt)
 }
 function snapshot(){return {value:{...value},version,status,error:error?.message||'',errorStatus:error?.status||0,pending:dirty||running,recovered,backupAvailable,backupWarning}}
 function emit(){if(!disposed){callbacks.onChange(snapshot());callbacks.onPending(dirty||running)}}
 function backup(){
  backupAvailable=false
  if(!key||!storage){backupWarning='Device backup is unavailable. Keep this page open until your answer is saved online.';return}
  try{storage.setItem(key,JSON.stringify({schema:1,baseVersion:version,answer:value,updatedAt:Date.now()}));backupAvailable=true;backupWarning=''}
  catch{backupWarning='Device backup is unavailable. Keep this page open until your answer is saved online.'}
 }
 function removeConfirmed(server){
  // Another tab may own a different unsaved answer: never erase that draft.
  for(const d of copies())if(d.baseVersion<=server.version&&sameAnswer(d.answer,server))try{storage.removeItem(d.key)}catch{}
 }
 if(!readOnly){
  const drafts=copies(),candidate=drafts.find(d=>!sameAnswer(d.answer,initial))
  if(candidate){value=answerFields(candidate.answer);version=candidate.baseVersion;dirty=true;recovered=true;backupAvailable=true
   if(version!==(Number(initial.version)||0)){status='conflict';error=Object.assign(new Error('Recovered text differs from the newer saved answer. Compare both before choosing which to keep.'),{status:409})}else status='pending'
  }
 }
 function schedule(delay){clearTimeout(timer);if(!disposed)timer=setTimeout(()=>void flush(),delay)}
 async function flush(){
  clearTimeout(timer)
  if(readOnly||running||!dirty)return false
  running=true;status='saving';error=null;emit()
  try{
   while(dirty){
    const sent={...value},sentGeneration=generation
    const result=await save({answer:sent,version})
    const acknowledged=result?.answer
    if(!Number.isInteger(acknowledged?.version)||acknowledged.version<version||!sameAnswer(acknowledged,sent))throw new Error('The server did not confirm this answer. Your draft has been kept for retry.')
    version=acknowledged.version;attempt=0;removeConfirmed(acknowledged);if(!disposed)callbacks.onSaved(acknowledged)
    if(generation===sentGeneration){dirty=false;status='saved';error=null;removeConfirmed(acknowledged);backupAvailable=false;recovered=false;backupWarning=''}
    else{backup();status='saving'}
    emit()
   }
   return true
  }catch(e){
   dirty=true;error=e;backup()
   const code=Number(e.status)||0
   status=code===409?'conflict':code===401||code===403?'auth':'error'
   if((!code||code>=500||[408,429].includes(code))&&attempt<retryDelays.length)schedule(retryDelays[attempt++])
   return false
  }finally{running=false;emit()}
 }
 const controller={
  getSnapshot:snapshot,
  setCallbacks(next){callbacks={...callbacks,...next}},
  start(){disposed=false;if(dirty){backup();emit();if(status!=='conflict')schedule(0)}else{removeConfirmed({...initial,version});emit()}},
  update(patch){if(readOnly)return;value={...value,...answerFields({...value,...patch})};generation++;dirty=true;status='pending';error=null;attempt=0;backup();emit();schedule(debounceMs)},
  flush,
  retry(){attempt=0;return flush()},
  online(){if(dirty&&!['conflict','auth'].includes(status)){attempt=0;return flush()}return Promise.resolve(false)},
  acceptServer(server){
   if(dirty||running||!Number.isInteger(server?.version)||server.version<=version)return
   value=answerFields(server);version=server.version;status='saved';removeConfirmed(server);emit()
  },
  keepMine(serverVersion){if(!Number.isInteger(serverVersion))return Promise.resolve(false);version=serverVersion;generation++;dirty=true;backup();return flush()},
  downloadDraft(){return JSON.stringify({request:scope,version,answer:value,other_device_drafts:copies().map(d=>({version:d.baseVersion,answer:d.answer,updatedAt:d.updatedAt}))},null,2)},
  dispose(){clearTimeout(timer);if(dirty)backup();disposed=true}
 }
 return controller
}
