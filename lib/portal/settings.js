import {fail} from './security.js'
const data=async q=>{const r=await q;if(r.error)throw r.error;return r.data}
export async function portalSettings(db){const row=await data(db.from('mio_portal_settings').select('intake,discovery,payments,version').eq('id',true).maybeSingle());return row||{intake:true,discovery:true,payments:true,version:0}}
export function requirePortalSection(action,settings){const section=action.startsWith('discovery_')?'discovery':action.startsWith('invoice_')?'payments':action.startsWith('agreement_')||action==='intake_submit'?'intake':null;if(section&&settings[section]===false)fail('This section is not currently available in the client portal.',403)}
export async function savePortalSettings(db,settings,version,user){
 if(!settings||['intake','discovery','payments'].some(k=>typeof settings[k]!=='boolean')||!Number.isInteger(version)||version<1)fail('Refresh the portal settings and choose which sections to display.')
 const updated=await data(db.from('mio_portal_settings').update({intake:settings.intake,discovery:settings.discovery,payments:settings.payments,version:version+1,updated_at:new Date().toISOString(),updated_by:user.id}).eq('id',true).eq('version',version).select('intake,discovery,payments,version').maybeSingle())
 if(!updated)fail('Portal settings changed in another window. Reload settings before saving.',409)
 return updated
}
