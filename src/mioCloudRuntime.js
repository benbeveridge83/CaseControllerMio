import { supabase } from './supabaseClient'
import { createMioCloudStore } from './mioCloudStore.js'
import { createCloudPeer } from './mioCloudPeer.js'
let peer
export const mioCloudStore=createMioCloudStore({client:supabase,nativeStorage:window.localStorage,origin:window.location.origin,getCachedRows:(id,options)=>peer.request(id,options)})
peer=createCloudPeer({getSnapshot:()=>({owner:mioCloudStore.status().owner,ready:['ready','prepared'].includes(mioCloudStore.status().phase),rows:mioCloudStore.confirmedRecords})})
export const mioStorage=mioCloudStore.storage
window.addEventListener('beforeunload',event=>{const s=mioCloudStore.status();if(s.pending||s.pausedPending){event.preventDefault();event.returnValue=''}})
window.addEventListener('online',()=>void mioCloudStore.flushAll())
setInterval(()=>void mioCloudStore.flushAll(),30000)
