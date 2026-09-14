import {supabase} from '../supabaseClient.js'
export async function workspaceApi(action,{method='GET',params={},body=null}={}){
 const{data,error}=await supabase.auth.getSession();if(error)throw error;const token=data.session?.access_token;if(!token)throw new Error('Your Mio session expired. Sign in before continuing.')
 const search=new URLSearchParams({action,...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)]))})
 const r=await fetch(`/api/ads-workspace?${search}`,{method,cache:'no-store',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const result=await r.json().catch(()=>({}));if(!r.ok||result.ok===false)throw new Error(result.error||`Workspace request failed (${r.status}).`);return result
}
export function classifySearchTerm(body,api=workspaceApi){return api('keyword_classify_term',{method:'POST',body})}
export const keywordLabPreferences={
 async load(){const{data,error}=await supabase.auth.getSession();if(error)throw error;const id=data.session?.user?.id;if(!id)throw new Error('Sign in to load Keyword Lab settings.');const r=await supabase.from('mio_ads_preferences').select('keyword_lab').eq('user_id',id).maybeSingle();if(r.error)throw r.error;return r.data?.keyword_lab||{}},
 async save(keyword_lab){const{data,error}=await supabase.auth.getSession();if(error)throw error;const id=data.session?.user?.id;if(!id)throw new Error('Sign in to save Keyword Lab settings.');const r=await supabase.from('mio_ads_preferences').upsert({user_id:id,keyword_lab,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(r.error)throw r.error}
}
export const preferencesStore={
 async load(){const{data,error}=await supabase.auth.getSession();if(error)throw error;const id=data.session?.user?.id;if(!id)throw new Error('Sign in to save column settings.');const r=await supabase.from('mio_ads_preferences').select('columns').eq('user_id',id).maybeSingle();if(r.error)throw r.error;return r.data?.columns||null},
 async save(columns){const{data,error}=await supabase.auth.getSession();if(error)throw error;const id=data.session?.user?.id;if(!id)throw new Error('Sign in to save column settings.');const r=await supabase.from('mio_ads_preferences').upsert({user_id:id,columns,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(r.error)throw r.error}
}
