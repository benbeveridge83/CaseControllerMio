import {emailKey,fail} from './security.js'
const data=async q=>{const r=await q;if(r.error){if(r.error.code==='PT409')r.error.status=409;throw r.error}return r.data}
const blank=()=>({assets:[],securedDebts:[],unsecuredDebts:[],documentChecklist:{}})
function validateInventory(value){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Invalid property inventory.')
 for(const key of ['assets','securedDebts','unsecuredDebts'])if(!Array.isArray(value[key])||value[key].length>400)fail('The inventory contains too many entries.')
 if(value.documentChecklist!==undefined&&(!value.documentChecklist||typeof value.documentChecklist!=='object'||Array.isArray(value.documentChecklist)))fail('Invalid document checklist.')
 const json=JSON.stringify({assets:value.assets,securedDebts:value.securedDebts,unsecuredDebts:value.unsecuredDebts,documentChecklist:value.documentChecklist||{}})
 if(Buffer.byteLength(json,'utf8')>450000)fail('The inventory is too large to save.')
 for(const key of ['assets','securedDebts','unsecuredDebts']){const seen=new Set();for(const item of value[key]){if(!item||typeof item!=='object'||typeof item.id!=='string'||item.id.length>80||seen.has(item.id))fail('An inventory row is invalid.');seen.add(item.id);for(const v of Object.values(item))if(typeof v==='string'&&v.length>12000)fail('One of the inventory fields is too long.')}}
 return JSON.parse(json)
}
export async function propertyInventoryAction(db,m,b,{staff=false}={}){
 const email=emailKey(m.clients?.email)
 if(b.action==='inventory_get'){const row=await data(db.from('mio_portal_property_inventory').select('client_id,recipient_email,inventory,version').eq('matter_id',m.id).maybeSingle());if(row&&(row.client_id!==m.client_id||row.recipient_email!==email))fail('The inventory belongs to a different client. Contact the firm before changing it.',409);return {inventory:row?.inventory||blank(),version:row?.version||0}}
 if(b.action==='inventory_save'){if(staff)fail('This client view is read-only.',403);if(!Number.isInteger(b.version)||b.version<0)fail('Refresh the inventory before saving.');const inventory=validateInventory(b.inventory);const result=await data(db.rpc('mio_portal_property_inventory_save',{p_matter:m.id,p_client:m.client_id,p_email:email,p_version:b.version,p_inventory:inventory}));return {inventory:result.inventory,version:result.version}}
 fail('Unsupported property inventory action.')
}
export {blank as emptyPropertyInventory,validateInventory}
