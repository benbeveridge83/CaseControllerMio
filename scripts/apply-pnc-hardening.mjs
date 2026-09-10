// One-time, idempotent release edits. CI commits the edited sources only after tests pass.
import fs from 'node:fs'
function replace(path,from,to){let s=fs.readFileSync(path,'utf8');if(s.includes(to))return;if(s.split(from).length!==2)throw Error('PNC release edit anchor changed: '+path+' / '+from.slice(0,65));fs.writeFileSync(path,s.replace(from,()=>to))}
const client='src/supabaseClient.js',original=fs.readFileSync(client,'utf8')
if(!fs.existsSync('src/mioSupabasePublic.js')){const a=original.indexOf('const supabaseUrl'),b=original.indexOf('// Only sign-in');if(a<0||b<a)throw Error('Public Supabase configuration anchor changed');const constants=original.slice(a,b).replace('const supabaseUrl','export const PUBLIC_SUPABASE_URL').replace('const supabaseAnonKey','export const PUBLIC_SUPABASE_KEY');fs.writeFileSync('src/mioSupabasePublic.js','// Public project configuration only. Never put service-role or provider keys here.\n'+constants);fs.writeFileSync(client,original.slice(0,a)+"import {PUBLIC_SUPABASE_URL as supabaseUrl,PUBLIC_SUPABASE_KEY as supabaseAnonKey} from './mioSupabasePublic.js'\n\n"+original.slice(b))}
replace('src/MioPnc.jsx','<span>{name}</span>{children}</label>',"<span>{name}</span>{React.isValidElement(children)?React.cloneElement(children,{'aria-label':name}):children}</label>")
replace('lib/pnc.js',"import {createClient} from '@supabase/supabase-js'", "import {PUBLIC_SUPABASE_URL,PUBLIC_SUPABASE_KEY} from '../src/mioSupabasePublic.js'\nimport {createClient} from '@supabase/supabase-js'")
replace('lib/pnc.js','e.NEXT_PUBLIC_SUPABASE_URL,key:','e.NEXT_PUBLIC_SUPABASE_URL||PUBLIC_SUPABASE_URL,key:')
replace('lib/pnc.js','e.NEXT_PUBLIC_SUPABASE_ANON_KEY}}','e.NEXT_PUBLIC_SUPABASE_ANON_KEY||PUBLIC_SUPABASE_KEY}}')
replace('lib/pnc.js',"if(!r)continue\n  // Exact", "if(!r){state[kind]={status:'not_paid',paid_cents:0,processing_cents:0,required_cents:0};continue}\n  if(r.account_key!==(kind==='consult'?'operating':'trust')||Number(r.amount_cents)!==amount(w.config[kind==='consult'?'consult_fee':'retainer'])){state[kind]={status:'needs_review'};continue}\n  // Exact")
replace('lib/pnc.js'," if(signature&&state.signature?.id)"," if(!state.signature?.id)state.signature={status:'not_sent'}\n if(signature&&state.signature?.id)")
replace('lib/pnc.js',' const fields=[...new Map'," if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))fail('Fee-agreement fields must be a JSON object.')\n const fields=[...new Map")
replace('src/mioPncModel.js','if(/refund|chargeback|reversal/.test(type))','if(/refund|chargeback|reversal|credit/.test(type))')
replace('scripts/test-withdrawal-release-browser.mjs','/Mio V31[12]/','/Mio V31[123]/')
replace('supabase/migrations/20260910005036_pnc_workflow_v313.sql','revoke all on public.mio_pnc_workflows from public;','revoke all on public.mio_pnc_workflows from public,authenticated;')
console.log('PNC hardening source edits applied (or already present).')
