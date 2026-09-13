const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)))
const rounded=v=>Math.round(v*10)/10

const EVIDENCE_WEIGHTS={design:40,sample:15,controls:20,measurement:10,bias:10,transparency:5}
const DESIGN_POINTS={strong_quasi_experimental:40,longitudinal_preseparation:32,longitudinal:27,cross_sectional_adjusted:20,descriptive:10}

function evidenceSample(n){
 if(!finite(n)||Number(n)<=0)return null
 const v=Number(n)
 if(v>=10000)return 15
 if(v>=2000)return 13
 if(v>=500)return 10
 if(v>=100)return 6
 return 3
}
function evidenceControls(input){
 const entries=[['pre_separation_controls',8],['conflict_controls',6],['ses_controls',6]]
 if(!entries.some(([k])=>typeof input[k]==='boolean'))return null
 return entries.reduce((sum,[k,w])=>sum+(input[k]===true?w:0),0)
}
function ordinal(value,map){const k=String(value||'').toLowerCase();return Object.prototype.hasOwnProperty.call(map,k)?map[k]:null}
function normalizedWeighted(components,weights){
 let knownWeight=0,earned=0
 for(const [key,component] of Object.entries(components)){
  if(component===null)continue
  const max=weights[key]
  knownWeight+=max
  earned+=component.points
 }
 return {score:knownWeight?rounded((earned/knownWeight)*100):null,completeness:rounded((knownWeight/Object.values(weights).reduce((a,b)=>a+b,0))*100)}
}

export function calculateEvidenceStrength(input={}){
 const designPoints=Object.prototype.hasOwnProperty.call(DESIGN_POINTS,input.design)?DESIGN_POINTS[input.design]:null
 const samplePoints=evidenceSample(input.sample_size)
 const controlsPoints=evidenceControls(input)
 const measurementPoints=ordinal(input.measurement_quality,{strong:10,good:8,fair:6,weak:3,poor:1})
 const biasPoints=ordinal(input.bias_handling,{strong:10,good:8,fair:6,weak:3,poor:1})
 const transparencyPoints=ordinal(input.transparency,{strong:5,good:4,fair:3,weak:1,poor:0})
 const components={
  design:designPoints===null?null:{points:designPoints,max:EVIDENCE_WEIGHTS.design},
  sample:samplePoints===null?null:{points:samplePoints,max:EVIDENCE_WEIGHTS.sample},
  controls:controlsPoints===null?null:{points:controlsPoints,max:EVIDENCE_WEIGHTS.controls},
  measurement:measurementPoints===null?null:{points:measurementPoints,max:EVIDENCE_WEIGHTS.measurement},
  bias:biasPoints===null?null:{points:biasPoints,max:EVIDENCE_WEIGHTS.bias},
  transparency:transparencyPoints===null?null:{points:transparencyPoints,max:EVIDENCE_WEIGHTS.transparency}
 }
 const result=normalizedWeighted(components,EVIDENCE_WEIGHTS)
 return {...result,components}
}

export function calculateEqualParentingRelevance(input={}){
 let base,reason
 if(input.exact_or_near_50_50===true){base=97;reason='explicit_exact_or_near_50_50'}
 else if(finite(input.shared_time_min_percent)&&Number(input.shared_time_min_percent)>=40){base=90;reason='shared_time_at_least_40_percent'}
 else if(finite(input.shared_time_min_percent)&&Number(input.shared_time_min_percent)>=30){base=75;reason='shared_time_at_least_30_percent'}
 else if(/\bJPC\b|joint physical|shared residence/i.test(String(input.parenting_time_definition||''))){base=55;reason='broad_shared_or_jpc_definition'}
 else if(/overnight|attachment|infant|toddler/i.test(String(input.parenting_time_definition||input.topic_text||''))){base=35;reason='adjacent_young_child_or_overnight_literature'}
 else if(input.source_type==='policy_legal'){base=18;reason='policy_or_legal_relevance'}
 else{base=8;reason='indirect_contextual_relevance'}
 const directBonus=input.direct_child_outcome===true?3:0
 return {score:clamp(base+directBonus),components:{base,reason,direct_child_outcome_bonus:directBonus}}
}

const IMPACT_WEIGHTS={citation_percentile:35,citations_per_year_percentile:20,fwci_percentile:15,influential_citation_percentile:10,review_inclusion_percentile:15,policy_influence:5}
export function calculateImpactScore(input={}){
 const components={}
 let knownWeight=0,weighted=0
 for(const [key,weight] of Object.entries(IMPACT_WEIGHTS)){
  if(!finite(input[key])){components[key]=null;continue}
  const value=clamp(input[key])
  components[key]={value,weight,weighted_points:(value/100)*weight}
  knownWeight+=weight
  weighted+=(value/100)*weight
 }
 if(!knownWeight)return {score:null,completeness:0,components:Object.fromEntries(Object.keys(IMPACT_WEIGHTS).map(k=>[k,null]))}
 return {score:rounded((weighted/knownWeight)*100),completeness:knownWeight,components}
}

export function calculateHistoricalImportance(input={}){
 if(input.anchor_designation===true&&!String(input.anchor_explanation||'').trim())throw new Error('Historical anchor designation requires an explanation.')
 if(input.methodological_debate===true&&!String(input.methodological_debate_explanation||'').trim())throw new Error('Methodological-debate designation requires an explanation.')
 const components={
  anchor_designation:input.anchor_designation===true?{points:30,max:30,explanation:String(input.anchor_explanation).trim()}:null,
  review_inclusion:finite(input.review_inclusion_percentile)?{points:clamp(input.review_inclusion_percentile)*0.25,max:25}:null,
  durable_citation:finite(input.durable_citation_percentile)?{points:clamp(input.durable_citation_percentile)*0.20,max:20}:null,
  methodological_debate:input.methodological_debate===true?{points:15,max:15,explanation:String(input.methodological_debate_explanation).trim()}:null,
  policy_influence:finite(input.policy_influence)?{points:clamp(input.policy_influence)*0.10,max:10}:null
 }
 const weights={anchor_designation:30,review_inclusion:25,durable_citation:20,methodological_debate:15,policy_influence:10}
 const result=normalizedWeighted(components,weights)
 return {...result,components}
}
