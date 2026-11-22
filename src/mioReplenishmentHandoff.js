// Shared Section A -> trust replenishment eligibility.
// Do not combine ledger funds across matters; this only determines a review owner.
export function sectionAReplenishmentEligibility(matter,matters=[],weeklyOverrides={},preferences={}) {
  const id=String(matter?.id||'');
  if(!id)return {eligible:false,reason:'Missing matter identifier'};
  const override=weeklyOverrides[id]||{};
  const explicit=matter.appointed??matter.is_appointed??matter.court_appointed;
  const appointed=override.appointed??(explicit!=null?Boolean(explicit):/^dfps\b/i.test(String(matter.matter_type||matter.case_type||'')));
  if(appointed)return {eligible:false,appointed:true,reason:'Court appointed'};
  if(override.included===false)return {eligible:false,appointed:false,reason:'Section A billing excluded'};
  if(matter.is_active===false||/closed|dismissed/i.test(String(matter.case_status||matter.matter_status||'')))
    return {eligible:false,appointed:false,reason:'Closed matter'};
  if(preferences[id]?.replenishment_enabled===false)return {eligible:false,appointed:false,reason:'Replenishment disabled'};
  if(preferences[id]?.primary_replenishment_matter===false)return {eligible:false,appointed:false,reason:'Secondary matter'};
  const clientId=String(matter.client_id||'');
  const activeSameClient=(matters||[]).filter(m=>
    clientId&&String(m.client_id||'')===clientId&&m.is_active!==false&&!/closed|dismissed/i.test(String(m.case_status||m.matter_status||'')));
  if(activeSameClient.length>1){
    const primaries=activeSameClient.filter(m=>preferences[String(m.id)]?.primary_replenishment_matter===true);
    if(primaries.length!==1||String(primaries[0].id)!==id)
      return {eligible:false,appointed:false,reason:'Select one primary replenishment matter for this client'};
  }
  return {eligible:true,appointed:false,reason:''};
}
