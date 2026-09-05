import { supabase } from './supabaseClient'
import { createMioCloudStore } from './mioCloudStore.js'
export const mioCloudStore=createMioCloudStore({client:supabase,nativeStorage:window.localStorage,origin:window.location.origin})
export const mioStorage=mioCloudStore.storage
window.addEventListener('beforeunload',event=>{const s=mioCloudStore.status();if(s.pending||s.pausedPending){event.preventDefault();event.returnValue=''}})
window.addEventListener('online',()=>void mioCloudStore.flushAll())
setInterval(()=>void mioCloudStore.flushAll(),30000)
