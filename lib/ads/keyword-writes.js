import crypto from 'node:crypto'
import {normalizeKeywordItems,coveringNegative,text,requireId} from './model.js'

const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const uuid=value=>{const h=digest(value);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}
const validUuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value||'')
const isNegative=item=>item.kind.endsWith('_negative')
const isStatus=item=>['pause_keyword','enable_keyword'].includes(item.kind)
const targetStatus=item=>item.kind==='pause_keyword'?'PAUSED':'ENABLED'
const createdStatus=item=>item.kind==='change_match_type'?item.original.status:'ENABLED'
const fields='campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.resource_name, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type'
const fromRow=r=>({campaignId:String(r.campaign?.id||''),campaignName:r.campaign?.name||'',adGroupId:String(r.adGroup?.id||''),adGroupName:r.adGroup?.name||'',criterionId:String(r.adGroupCriterion?.criterionId||r.adGroupCriterion?.resourceName?.split('~')[1]||''),criterionResourceName:r.adGroupCriterion?.resourceName||'',keyword:r.adGroupCriterion?.keyword?.text||'',matchType:r.adGroupCriterion?.keyword?.matchType||'',status:r.adGroupCriterion?.status||'',negative:r.adGroupCriterion?.negative===true})
export const keywordRevisionOf=row=>digest([String(row.campaignId),String(row.adGroupId),row.criterionResourceName,row.criterionId,row.keyword,row.matchType,row.status])
const summary=results=>results.some(r=>r.state==='unverified')?'unverified':results.some(r=>r.state==='failed')?'failed':results.every(r=>r.state==='verified')?'verified':'unverified'

// The helper owns only V318 review/execution. Dependencies remain injected and V317 is untouched.
export function createKeywordWriteService(d,{getNegatives}){
 const accountId=requireId(d.accountId),now=()=>new Date(d.now?d.now():Date.now()).toISOString()
 const own=event=>{if(!event||event.kind!=='keyword_lab'||event.account_id!==accountId||event.actor_id!==d.actor.id)throw new Error('Only the original approver may use this Keyword Lab approval.')}
 const appliedKey=requestId=>uuid(['keyword_apply',accountId,requestId])
 function eventFor(requestKey,hash,before,after,result){return{id:crypto.randomUUID(),request_key:requestKey,payload_hash:hash,account_id:accountId,actor_id:d.actor.id,actor_email:d.actor.email,kind:'keyword_lab',status:'prepared',before_snapshot:before,after_snapshot:after,result,created_at:now()}}
 async function inventory(items){
  const scopeIds=[...new Set(items.map(i=>i.campaignId))],keywords=[]
  for(const campaignId of scopeIds){const rows=await d.query(`SELECT ${fields} FROM ad_group_criterion WHERE campaign.id = ${campaignId} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED' LIMIT 10000`);if(rows.length>=10000)throw new Error('Keyword inventory is incomplete. Narrow the scope.');keywords.push(...rows.map(fromRow))}
  const negatives=[];for(const campaignId of scopeIds)negatives.push(...await getNegatives({campaignId}))
  return{keywords,negatives}
 }
 async function destinations(items){
  const found=new Map()
  for(const item of items){const key=`${item.campaignId}:${item.adGroupId}`;if(found.has(key))continue
   const q=item.adGroupId?`SELECT campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name, ad_group.status FROM ad_group WHERE campaign.id = ${item.campaignId} AND ad_group.id = ${item.adGroupId} AND campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED'`:`SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.id = ${item.campaignId} AND campaign.status != 'REMOVED'`
   const rows=await d.query(q),r=rows.find(r=>String(r.campaign?.id)===item.campaignId&&(!item.adGroupId||String(r.adGroup?.id)===item.adGroupId))
   if(!r)throw new Error('The destination campaign/ad group changed or is unavailable.')
   found.set(key,{campaignName:r.campaign.name||item.campaignId,adGroupName:r.adGroup?.name||''})
  }
  return found
 }
 function check(items,{keywords,negatives}){
  const seen=new Set(),sources=new Set()
  const queuedNegatives=items.filter(isNegative).map(i=>({...i,scope:i.kind==='add_campaign_negative'?'campaign':'ad_group',status:'ENABLED'}))
  if(items.some(i=>!isNegative(i)&&i.kind!=='pause_keyword'&&coveringNegative(i,queuedNegatives)))throw new Error('The basket contains conflicting keyword and negative changes that block each other.')
  return items.map(item=>{
   let original=null
   if(item.criterionResourceName){original=keywords.find(k=>k.criterionResourceName===item.criterionResourceName&&k.campaignId===item.campaignId&&k.adGroupId===item.adGroupId)
    if(!original||keywordRevisionOf(original)!==item.expectedRevision||text(original.keyword)!==text(item.keyword))throw new Error('The original keyword changed or is stale. Refresh and review again.')
    if(sources.has(item.criterionResourceName))throw new Error('Conflicting changes to the same original criterion.');sources.add(item.criterionResourceName)
    if(isStatus(item)){if(original.matchType!==item.matchType||original.status===targetStatus(item))throw new Error('The keyword status or match type changed; no change to publish.')}
    else if(original.matchType===item.matchType)throw new Error('This match type already exists on the original keyword.')
    if(item.kind==='change_match_type'&&!['ENABLED','PAUSED'].includes(original.status))throw new Error('Only an enabled or paused keyword can be replaced.')
   }
   if(!isStatus(item)){
    const key=JSON.stringify([isNegative(item),item.campaignId,item.adGroupId,text(item.keyword),item.matchType]);if(seen.has(key))throw new Error('Duplicate keyword in the review basket.');seen.add(key)
    if(!isNegative(item)&&keywords.some(k=>k.campaignId===item.campaignId&&k.adGroupId===item.adGroupId&&text(k.keyword)===text(item.keyword)&&k.matchType===item.matchType))throw new Error('This keyword and match type already exist in the destination ad group.')
    const cover=coveringNegative(item,negatives.filter(n=>!isNegative(item)||item.matchType==='EXACT'||n.matchType!=='EXACT'),item.kind==='add_campaign_negative')
    if(cover)throw new Error(`Keyword is already covered by ${cover.matchType} negative "${cover.keyword}".`)
   }
   return{...item,original}
  })
 }
 async function keywordReview(body={}){
  if(!validUuid(body.requestId))throw new Error('A unique request ID is required.')
  const items=normalizeKeywordItems(body.items,accountId),inputHash=digest(items),prior=await d.db.byRequest(body.requestId)
  if(prior){own(prior);if(prior.before_snapshot?.phase!=='review'||prior.before_snapshot.inputHash!==inputHash)throw new Error('This request ID belongs to another approval.');return prior.result}
  const [current,names]=await Promise.all([inventory(items),destinations(items)]),planned=check(items,current).map(i=>({...i,...names.get(`${i.campaignId}:${i.adGroupId}`)}))
  if(items.some(i=>isStatus(i)||i.kind==='change_match_type')){
   const experiments=await d.db.keywordExperiments({});if(experiments.length>=1000)throw new Error('Experiment inventory is incomplete. Refresh before changing linked keywords.')
   for(const item of planned){if(!isStatus(item)&&item.kind!=='change_match_type')continue
    const linked=experiments.find(e=>e.account_id===accountId&&e.criterion_resource_name===item.criterionResourceName&&['active','paused'].includes(e.state))
    if(item.experimentId&&linked?.id!==item.experimentId)throw new Error('Linked experiment identity changed. Review again.')
    if(linked)item.linkedExperimentId=linked.id
   }
  }
  const fingerprint=digest(planned)
  const event=eventFor(body.requestId,fingerprint,{phase:'review',inputHash},{items:planned},null),result={ok:true,phase:'review',reviewId:event.id,requestId:body.requestId,fingerprint,items:planned,reviewedAt:now()};event.result=result
  const reservation=await d.db.reserve(event);if(!reservation.fresh){own(reservation.entry);if(reservation.entry.before_snapshot?.phase!=='review'||reservation.entry.before_snapshot.inputHash!==inputHash)throw new Error('Approval ID conflict.');return reservation.entry.result}
  return result
 }
 function steps(item){
  const groupPath=`customers/${accountId}/adGroupCriteria:mutate`,campaign=item.kind==='add_campaign_negative'
  if(isStatus(item))return[{name:'status',path:groupPath,operation:{update:{resourceName:item.criterionResourceName,status:targetStatus(item)},updateMask:'status'}}]
  const create={...(campaign?{campaign:`customers/${accountId}/campaigns/${item.campaignId}`}:{adGroup:`customers/${accountId}/adGroups/${item.adGroupId}`,status:createdStatus(item)}),negative:isNegative(item),keyword:{text:item.keyword,matchType:item.matchType}}
  return[{name:'create',path:campaign?`customers/${accountId}/campaignCriteria:mutate`:groupPath,operation:{create}},...(item.kind==='change_match_type'?[{name:'pause',path:groupPath,operation:{update:{resourceName:item.criterionResourceName,status:'PAUSED'},updateMask:'status'}}]:[])]
 }
 function resourceValid(item,resource){return new RegExp(`^customers/${accountId}/${item.kind==='add_campaign_negative'?`campaignCriteria/${item.campaignId}`:`adGroupCriteria/${item.adGroupId}`}~\\d{1,20}$`).test(resource||'')}
 async function readStep(item,name,resource,observeOnly=false){
  if(!resourceValid(item,resource))return null
  if(item.kind==='add_campaign_negative'){
   const rows=await d.query(`SELECT campaign.id, campaign_criterion.resource_name, campaign_criterion.status, campaign_criterion.negative, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type FROM campaign_criterion WHERE campaign_criterion.resource_name = '${resource}'`)
   const r=rows.find(r=>r.campaignCriterion?.resourceName===resource&&String(r.campaign?.id)===item.campaignId),k=r?.campaignCriterion
   return k&&(observeOnly||k.status!=='REMOVED'&&k.negative===true&&k.keyword?.text===item.keyword&&k.keyword?.matchType===item.matchType)?{criterionResourceName:resource,status:k.status,keyword:k.keyword?.text,matchType:k.keyword?.matchType,negative:k.negative}:null
  }
  const rows=await d.query(`SELECT ${fields} FROM ad_group_criterion WHERE ad_group_criterion.resource_name = '${resource}'`),actual=rows.map(fromRow).find(k=>k.criterionResourceName===resource&&k.campaignId===item.campaignId&&k.adGroupId===item.adGroupId)
  const match=name==='pause'?item.original.matchType:item.matchType,status=name==='pause'?'PAUSED':isStatus(item)?targetStatus(item):createdStatus(item)
  return actual&&(observeOnly||actual.keyword===item.keyword&&actual.matchType===match&&actual.status===status&&actual.negative===isNegative(item))?actual:null
 }
 async function persist(eventId,result,required=false){
  result.status=summary(result.results)
  try{const saved=await d.db.update(eventId,{status:result.status,result,updated_at:now()});if(Array.isArray(saved)&&!saved.length)throw new Error('History update returned no row');return true}catch(e){result.historyWarning='Cloud history update failed. Do not resubmit; reconcile this approval.';if(required){result.executionHalted=true;throw e}return false}
 }
 async function prepareExperiment(item,reviewId){
  const id=item.experimentId||uuid(['experiment',reviewId,item.id]);let existing=await d.db.getKeywordExperiment(id)
  if(!existing){existing=await d.db.insertKeywordExperiment({id,account_id:accountId,campaign_id:item.campaignId,campaign_name:item.campaignName,ad_group_id:item.adGroupId,ad_group_name:item.adGroupName,keyword:item.keyword,match_type:item.matchType,source:item.source,hypothesis:item.hypothesis||null,state:'proposed',created_by:d.actor.id})}
  if(existing.account_id!==accountId||existing.campaign_id!==item.campaignId||existing.ad_group_id!==item.adGroupId||existing.keyword!==item.keyword||existing.match_type!==item.matchType||existing.source!==item.source||text(existing.hypothesis)!==text(item.hypothesis)||!['proposed','approved'].includes(existing.state))throw new Error('Experiment metadata changed or is already linked. Review again.')
  if(existing.state==='proposed')existing=await d.db.updateKeywordExperiment(id,{state:'approved'})
  if(!existing||existing.approved_by!==d.actor.id)throw new Error('Experiment approval could not be persisted for this approver.')
  return{id,state:'approved'}
 }
 async function activateExperiment(item,result){
  if(!result.experiment||result.experiment.state==='persisted'||result.create?.state!=='verified')return
  try{
   const patch={state:'active',criterion_id:result.create.resourceName.split('~')[1],criterion_resource_name:result.create.resourceName,experiment_started_at:result.create.verifiedAt}
   const matchesScope=row=>row&&row.account_id===accountId&&row.campaign_id===item.campaignId&&row.ad_group_id===item.adGroupId&&row.keyword===item.keyword&&row.match_type===item.matchType&&row.approved_by===d.actor.id
   const matchesActivation=row=>matchesScope(row)&&['active','paused','promoted_to_core','ended'].includes(row.state)&&row.criterion_id===patch.criterion_id&&row.criterion_resource_name===patch.criterion_resource_name&&new Date(row.experiment_started_at).valueOf()===new Date(patch.experiment_started_at).valueOf()
   const current=await d.db.getKeywordExperiment(result.experiment.id)
   if(!matchesActivation(current)){
    if(!matchesScope(current)||current.state!=='approved'||current.criterion_id||current.criterion_resource_name||current.experiment_started_at)throw new Error('Experiment activation identity or pending state changed. No lifecycle update was made.')
    const saved=await d.db.updateKeywordExperiment(current.id,patch,{state:current.state,updatedAt:current.updated_at})
    // A zero-row conditional update can mean another request activated and advanced the lifecycle.
    if(!matchesActivation(saved)&&!matchesActivation(await d.db.getKeywordExperiment(current.id)))throw new Error('Experiment activation was not confirmed')
   }
   result.experiment={...result.experiment,state:'persisted'}
  }catch(e){result.experiment={...result.experiment,state:'unverified',message:e.message}}
 }
 async function syncExperiment(item,result){
  if(item.kind==='add_experimental_keyword')return activateExperiment(item,result)
  const step=item.kind==='change_match_type'?result.pause:result.status
  const experimentId=item.linkedExperimentId||item.experimentId
  if(!experimentId||!step||step.state!=='verified'||result.experiment?.state==='persisted')return
  try{
   const row=await d.db.getKeywordExperiment(experimentId)
   if(!row||row.account_id!==accountId||row.criterion_resource_name!==item.criterionResourceName||!['active','paused'].includes(row.state))throw new Error('Linked experiment identity/state changed.')
   const state=item.kind==='enable_keyword'?'active':'paused',saved=await d.db.updateKeywordExperiment(row.id,{state},{state:row.state,updatedAt:row.updated_at})
   if(!saved||saved.state!==state)throw new Error('Experiment state update was not confirmed.')
   result.experiment={id:row.id,state:'persisted'}
  }catch(e){result.experiment={id:experimentId,state:'unverified',message:e.message}}
 }
 function itemState(result){const states=Object.values(result).filter(v=>v&&typeof v==='object'&&'state'in v).map(v=>v.state);return states.includes('unverified')||states.includes('pending')||states.includes('approved')?'unverified':states.includes('failed')?'failed':'verified'}
 async function keywordApply(body={}){
  if(!d.canWrite)throw new Error('Live writes are locked or you are not an authorized approver.')
  if(body.confirmation!=='APPLY')throw new Error('Explicit APPLY authorization is required.')
  if(!validUuid(body.requestId)||!validUuid(body.reviewId))throw new Error('A reviewed request ID is required.')
  const review=await d.db.get(body.reviewId);own(review)
  if(review.before_snapshot?.phase!=='review'||review.request_key!==body.requestId||review.payload_hash!==body.fingerprint||digest(normalizeKeywordItems(body.items,accountId))!==review.before_snapshot.inputHash)throw new Error('The reviewed approval changed. Review the edited basket again.')
  if(digest(review.after_snapshot.items)!==review.payload_hash||digest(normalizeKeywordItems(review.after_snapshot.items,accountId))!==review.before_snapshot.inputHash)throw new Error('The stored review no longer matches its approval fingerprint.')
  const key=appliedKey(body.requestId),previous=await d.db.byRequest(key)
  if(previous){own(previous);if(previous.payload_hash!==body.fingerprint)throw new Error('Approval ID conflict.');return previous.result||{ok:true,eventId:previous.id,status:'unverified',results:[],message:'Approval is processing. Verify; do not resubmit.'}}
  const items=review.after_snapshot.items;check(items,await inventory(items));await destinations(items)
  const result={ok:true,phase:'apply',reviewId:review.id,requestId:body.requestId,fingerprint:review.payload_hash,status:'unverified',results:items.map(i=>({id:i.id,item:i,state:'unverified',...Object.fromEntries(steps(i).map(s=>[s.name,{state:'pending',resourceName:s.operation.update?.resourceName||''}]))}))}
  const event=eventFor(key,review.payload_hash,{phase:'apply',reviewId:review.id},{items},result);result.eventId=event.id
  const reserved=await d.db.reserve(event);if(!reserved.fresh){own(reserved.entry);if(reserved.entry.payload_hash!==event.payload_hash)throw new Error('Approval ID conflict.');return reserved.entry.result}
  // Validate the entire basket (including every replacement pause) before any live call.
  try{
   for(let index=0;index<items.length;index++)for(const step of steps(items[index])){const response=await d.post(step.path,{operations:[step.operation],validateOnly:true,partialFailure:false});result.results[index][step.name].validationRequestId=response.requestId||'';if(response.payload?.partialFailureError)throw Object.assign(new Error('Google rejected validation.'),{googlePayload:response.payload,requestId:response.requestId})}
   check(items,await inventory(items));await destinations(items)
   for(let index=0;index<items.length;index++)if(items[index].kind==='add_experimental_keyword')result.results[index].experiment=await prepareExperiment(items[index],review.id)
   await persist(event.id,result,true)
  }catch(e){for(const r of result.results){r.state='failed';r.message=e.message;for(const step of steps(r.item))r[step.name]={...r[step.name],state:'failed',message:e.message,...(e.requestId?{requestId:e.requestId}:{})}}await persist(event.id,result);return result}
  let halt=false
  for(let index=0;index<items.length;index++){
   const item=items[index],r=result.results[index]
   if(halt){r.message='Execution stopped after an uncertain outcome. Review history before a new approval.';continue}
   for(const step of steps(item)){
    const current=r[step.name];let sent=false
    try{
     if(step.name==='pause'){
      if(r.create.state!=='verified')break
      // Fresh identity read of both sides just before pausing; never infer success from keyword text.
      if(!await readStep(item,'create',r.create.resourceName))throw new Error('The verified replacement changed before pause.')
      const rows=await d.query(`SELECT ${fields} FROM ad_group_criterion WHERE ad_group_criterion.resource_name = '${item.criterionResourceName}'`),old=rows.map(fromRow).find(k=>k.criterionResourceName===item.criterionResourceName)
      if(!old||keywordRevisionOf(old)!==item.expectedRevision)throw new Error('The original keyword changed before pause.')
     }else check([item],await inventory([item]))
     current.state='unverified';current.attemptedAt=now();await persist(event.id,result,true)
     sent=true;const response=await d.post(step.path,{operations:[step.operation],validateOnly:false,partialFailure:false});current.requestId=response.requestId||'';current.resourceName=response.payload?.results?.[0]?.resourceName||current.resourceName
     if(response.payload?.partialFailureError)throw Object.assign(new Error('Google rejected this operation.'),{googlePayload:response.payload,requestId:response.requestId})
     // Save Google's returned identity before read-back, so interruption is safely reconcilable.
     await persist(event.id,result,true)
     const actual=await readStep(item,step.name,current.resourceName);current.observed=actual||await readStep(item,step.name,current.resourceName,true);current.state=actual?'verified':'unverified';current.message=actual?'Confirmed by a fresh Google Ads read.':'Outcome needs verification; do not resubmit.';if(actual)current.verifiedAt=now()
    }catch(e){current.state=sent&&!e.googlePayload?'unverified':'failed';current.message=e.message;if(e.requestId)current.requestId=e.requestId}
    if(current.state==='unverified'&&!current.observed&&current.resourceName){try{current.observed=await readStep(item,step.name,current.resourceName,true)}catch(e){current.observationError=e.message}}
    r.state=itemState(r)
    const saved=await persist(event.id,result)
    if(result.executionHalted||!saved||current.state==='unverified'){halt=true;break}
    if(current.state==='failed')break
   }
   await syncExperiment(item,r);r.state=itemState(r);if(!await persist(event.id,result))halt=true
  }
  result.appliedAt=now();await persist(event.id,result);return result
 }
 async function keywordVerify(body={}){
  const event=await d.db.get(body.eventId);own(event);if(event.before_snapshot?.phase!=='apply')throw new Error('Select an applied Keyword Lab approval to reconcile.')
  const result=structuredClone(event.result);if(!result)throw new Error('No recorded operation identity is available. Do not resubmit.')
  if(!result.appliedAt&&new Date(now())-new Date(event.updated_at||event.created_at)<10*60*1000)throw new Error('This approval may still be executing. Reconcile after processing finishes or after ten minutes without a checkpoint.')
  for(const r of result.results){const item=r.item
   for(const step of steps(item)){const state=r[step.name];if(state.state!=='unverified'||!state.attemptedAt||!state.resourceName)continue
    try{const actual=await readStep(item,step.name,state.resourceName);state.observed=actual||await readStep(item,step.name,state.resourceName,true);if(actual){state.state='verified';state.verifiedAt=state.verifiedAt||now();state.message='Expected identity and state confirmed by a fresh Google read.'}}catch(e){state.message=e.message}
   }
   await syncExperiment(item,r);r.state=itemState(r)
  }
  await persist(event.id,result);return result
 }
 async function keywordExperimentUpdate(body={}){
  if(body.action==='propose'){
   const item=normalizeKeywordItems([{...body.item,kind:'add_experimental_keyword'}],accountId)[0],id=crypto.randomUUID()
   const experiment=await d.db.insertKeywordExperiment({id,account_id:accountId,campaign_id:item.campaignId,campaign_name:String(body.item.campaignName||item.campaignId),ad_group_id:item.adGroupId,ad_group_name:String(body.item.adGroupName||item.adGroupId),keyword:item.keyword,match_type:item.matchType,source:item.source,hypothesis:item.hypothesis||null,state:'proposed',created_by:d.actor.id})
   if(!experiment)throw new Error('Experiment proposal was not persisted.')
   return{ok:true,experiment}
  }
  if(!validUuid(body.experimentId))throw new Error('A valid experiment ID is required.')
  const row=await d.db.getKeywordExperiment(body.experimentId)
  if(!row||row.account_id!==accountId)throw new Error('Experiment not found in this account.')
  if(!body.expectedUpdatedAt||body.expectedState!==row.state||body.expectedUpdatedAt!==row.updated_at)throw new Error('Experiment metadata changed. Refresh before updating.')
  const patch={}
  if(body.hypothesis!==undefined){patch.hypothesis=String(body.hypothesis).trim();if(patch.hypothesis.length>2000)throw new Error('Hypothesis must be at most 2000 characters.')}
  switch(body.action){
   case'approve':if(row.state!=='proposed')throw new Error('Only a proposed experiment can be approved.');patch.state='approved';break
   case'promote_to_core':case'end':if(!['active','paused'].includes(row.state))throw new Error('Only an active or paused experiment can be promoted or ended.');patch.state=body.action==='end'?'ended':'promoted_to_core';break
   case'continue':if(row.state!=='active')throw new Error('Continue applies to active experiments. Enable paused keywords through the review basket.');patch.state='active';break
   case'note':if(!Object.hasOwn(patch,'hypothesis'))throw new Error('A hypothesis/note is required.');break
   default:throw new Error('Unsupported experiment metadata action.')
  }
  const experiment=await d.db.updateKeywordExperiment(row.id,patch,{state:row.state,updatedAt:row.updated_at})
  if(!experiment)throw new Error('Experiment metadata changed or update was not persisted.')
  return{ok:true,experiment}
 }
 return{keywordReview,keywordApply,keywordVerify,keywordExperimentUpdate}
}
