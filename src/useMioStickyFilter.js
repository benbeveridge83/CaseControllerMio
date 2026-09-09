import {useCallback,useRef,useSyncExternalStore} from 'react'
import {mioCloudStore,mioStorage} from './mioCloudRuntime.js'
import {initialFilterValue,STICKY_FILTER_PREFIX} from './mioStickyFilterValues.js'
export function useMioStickyFilter(name, fallback) {
  useSyncExternalStore(mioCloudStore.subscribe,mioCloudStore.getVersion,mioCloudStore.getVersion)
  const key=STICKY_FILTER_PREFIX+name,initial=useRef(null),cache=useRef(null)
  if (!initial.current) initial.current={value:initialFilterValue(name,typeof fallback==='function'?fallback():fallback)}
  const read=()=>{
    const raw=mioStorage.getItem(key)
    if(cache.current?.raw===raw)return cache.current.value
    let value=initial.current.value
    if(raw!==null){try{const saved=JSON.parse(raw);if(saved?.schema===1&&Object.hasOwn(saved,'value'))value=saved.value}catch{throw new Error('Saved '+name+' filter is unreadable. It was not reset.')}}
    cache.current={raw,value};return value
  }
  const value=read(),latest=useRef(read);latest.current=read
  const set=useCallback(next=>{
    const previous=latest.current(),value=typeof next==='function'?next(previous):next
    if(JSON.stringify(previous)===JSON.stringify(value))return
    // Stage the actual change, not a mount-time default. Errors remain in the cloud-save panel.
    mioCloudStore.stage(key,JSON.stringify({schema:1,value}))
  },[key])
  return [value,set]
}
export function ignoreLegacyFilterWrite() {}
