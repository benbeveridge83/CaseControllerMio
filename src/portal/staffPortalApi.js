export async function staffPortalApi(action,body={}){
 const {supabase}=await import('../supabaseClient.js')
 const {data}=await supabase.auth.getSession()
 if(!data?.session?.access_token)throw new Error('Sign in to Mio as firm staff, then open Interact as Client again.')
 const response=await fetch('/api/client-portal',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({...body,action})})
 const result=await response.json()
 if(!response.ok)throw new Error(result.error||'Could not open the client view.')
 return result
}
