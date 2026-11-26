import {requestPortal} from './portalRequest.js'
export async function staffPortalApi(action,body={}){
 const {supabase}=await import('../supabaseClient.js')
 const {data}=await supabase.auth.getSession()
 if(!data?.session?.access_token)throw Object.assign(new Error('Sign in to Mio as firm staff, then open Interact as Client again.'),{status:401})
 return requestPortal(action,body,{Authorization:'Bearer '+data.session.access_token})
}
