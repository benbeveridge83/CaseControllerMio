import {fail} from './security.js'
const data=async q=>{const r=await q;if(r.error)throw r.error;return r.data}
export async function portalSettings(db){const row=await data(db.from('mio_portal_settings').select('intake,discovery,payments,documents,version').eq('id',true).maybeSingle());return row||{intake:true,discovery:true,payments:true,documents:false,version:0}}
export async function matterPortalSettings(db,matterId){const [defaults,override]=await Promise.all([portalSettings(db),data(db.from('mio_portal_matter_settings').select('intake,discovery,payments,documents,property_inventory,version').eq('matter_id',matterId).maybeSingle())]);return override?{...override,property_inventory:override.property_inventory===true}:{...defaults,documents:false,property_inventory:false,version:0}}
export function requirePortalSection(action,settings){const section=action.startsWith('discovery_')?'discovery':action.startsWith('document_')?'documents':action.startsWith('inventory_')?'property_inventory':action.startsWith('invoice_')?'payments':action.startsWith('agreement_')||action==='intake_submit'?'intake':null;if(section==='property_inventory'&&settings.property_inventory!==true)fail('This section is not currently available in the client portal.',403);if(section&&settings[section]===false)fail('This section is not currently available in the client portal.',403)}
export async function saveMatterPortalSettings(db,matterId,settings,version,user){
 const keys=['intake','discovery','payments','documents','property_inventory'];if(!settings||keys.some(k=>typeof settings[k]!=='boolean')||!Number.isInteger(version)||version<0)fail('Refresh this matter’s portal settings before saving.')
 const values=Object.fromEntries(keys.map(k=>[k,settings[k]]));let updated
 if(version===0){const r=await db.from('mio_portal_matter_settings').insert({matter_id:matterId,...values,version:1,updated_by:user.id}).select('*').maybeSingle();if(r.error){if(r.error.code==='23505')fail('These settings changed in another window. Reload before saving.',409);throw r.error}updated=r.data}
 else updated=await data(db.from('mio_portal_matter_settings').update({...values,version:version+1,updated_at:new Date().toISOString(),updated_by:user.id}).eq('matter_id',matterId).eq('version',version).select('*').maybeSingle())
 if(!updated)fail('These settings changed in another window. Reload before saving.',409)
 return updated
}
export async function savePortalSettings(db,settings,version,user){
 if(!settings||['intake','discovery','payments','documents'].some(k=>typeof settings[k]!=='boolean')||!Number.isInteger(version)||version<1)fail('Refresh the portal settings and choose which sections to display.')
 const updated=await data(db.from('mio_portal_settings').update({intake:settings.intake,discovery:settings.discovery,payments:settings.payments,documents:settings.documents,version:version+1,updated_at:new Date().toISOString(),updated_by:user.id}).eq('id',true).eq('version',version).select('intake,discovery,payments,documents,version').maybeSingle())
 if(!updated)fail('Portal settings changed in another window. Reload settings before saving.',409)
 return updated
}
