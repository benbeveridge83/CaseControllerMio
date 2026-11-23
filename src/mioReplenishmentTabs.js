// Pure categorization for the three replenishment review tabs.
// Withdrawal status is informational and never changes eligibility.
export const REPLENISHMENT_TABS=[
  {id:'eligible',label:'Below Minimum — Replenishing'},
  {id:'excluded',label:'Below Minimum — Not Replenished'},
  {id:'above',label:'At / Above Minimum'}
];
export function classifyReplenishmentMatter({balance,minimum,eligibility,financialVerified=true,draftBlocked=false}){
  if(!financialVerified||!Number.isFinite(Number(balance))||!Number.isFinite(Number(minimum))||balance===null||minimum===null)
    return {tab:null,reason:'Trust balance or minimum has not been verified'};
  if(Number(balance)>=Number(minimum))return {tab:'above',reason:'Trust is at or above the minimum'};
  if(!eligibility?.eligible)return {tab:'excluded',reason:eligibility?.reason||'Not eligible for automatic replenishment'};
  if(draftBlocked)return {tab:'excluded',reason:'An unsent trust invoice draft must be reconciled'};
  return {tab:'eligible',reason:''};
}
export function overrideAllowed({matter,weeklyOverride={},eligibility}={}){
  if(!matter)return false;
  const explicit=matter.appointed??matter.is_appointed??matter.court_appointed;
  const appointed=weeklyOverride.appointed??(explicit!=null?Boolean(explicit):/^dfps\b/i.test(String(matter.matter_type||matter.case_type||'')));
  return !appointed && matter.is_active!==false && !/closed|dismissed/i.test(String(matter.case_status||matter.matter_status||'')) &&
    !String(eligibility?.reason||'').includes('Court appointed');
}
export function calculateReplenishmentCents(balance,target,priorDue){
  const values=[balance,target,priorDue];
  if(values.some(v=>v===null||v===undefined||!Number.isFinite(Number(v))))return null;
  return Math.max(0,Math.round(Number(target)*100)-Math.round(Number(balance)*100)-Math.round(Number(priorDue)*100));
}
