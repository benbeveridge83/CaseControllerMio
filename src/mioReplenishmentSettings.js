// Standalone preference adapter for the trust replenishment review.
// Does not create invoices, transmit emails, move funds, or call weekly billing.
export const REPLENISHMENT_SETTINGS_TABLE = 'mio_replenishment_matter_settings';
const persistedKeys = ['replenishment_enabled','primary_replenishment_matter','covered_matter_ids','minimum_trust','target_trust','withdrawal_flagged'];
const clean = input => Object.fromEntries(persistedKeys.filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]]));
export async function loadReplenishmentSettings(supabase,userId) {
  if(!userId) throw new Error('Sign in before loading replenishment settings.');
  const {data,error}=await supabase.from(REPLENISHMENT_SETTINGS_TABLE).select('matter_id,replenishment_enabled,primary_replenishment_matter,covered_matter_ids,minimum_trust,target_trust,withdrawal_flagged,withdrawal_flagged_at').eq('user_id',userId);
  if(error)throw error;
  return Object.fromEntries((data||[]).map(row=>[row.matter_id,row]));
}
export async function saveReplenishmentSettings(supabase,userId,matterId,updates) {
  if(!userId||!matterId)throw new Error('A signed-in user and matter are required.');
  const changes=clean(updates);
  if(!Object.keys(changes).length)throw new Error('No valid preference changes supplied.');
  if(changes.minimum_trust!=null && (!Number.isFinite(Number(changes.minimum_trust))||Number(changes.minimum_trust)<0))throw new Error('Invalid minimum trust amount.');
  if(changes.target_trust!=null && (!Number.isFinite(Number(changes.target_trust))||Number(changes.target_trust)<0))throw new Error('Invalid target trust amount.');
  if(changes.covered_matter_ids && !Array.isArray(changes.covered_matter_ids))throw new Error('Covered matters must be an array.');
  // A partial update must not overwrite saved preferences with defaults.
  const {data:current,error:readError}=await supabase.from(REPLENISHMENT_SETTINGS_TABLE).select('replenishment_enabled,primary_replenishment_matter,covered_matter_ids,minimum_trust,target_trust,withdrawal_flagged').eq('user_id',userId).eq('matter_id',matterId).maybeSingle();
  if(readError)throw readError;
  const patch={...current,...changes};
  if(patch.minimum_trust!=null&&patch.target_trust!=null&&Number(patch.target_trust)<Number(patch.minimum_trust))throw new Error('Target trust cannot be below minimum trust.');
  const {data,error}=await supabase.from(REPLENISHMENT_SETTINGS_TABLE).upsert({user_id:userId,matter_id:matterId,...patch,updated_at:new Date().toISOString()},{onConflict:'user_id,matter_id'}).select().single();
  if(error)throw error;
  return data;
}
