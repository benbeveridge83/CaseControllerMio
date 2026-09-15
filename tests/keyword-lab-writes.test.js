import test from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import {createWorkspaceService} from '../lib/ads/service.js'
import {handleAdsWorkspace} from '../lib/ads/http.js'
import {googleAdsPost} from '../lib/ads/transport.js'

const requestId='11111111-1111-4111-8111-111111111111'
const original={campaignId:'12',campaignName:'Campaign',adGroupId:'4',adGroupName:'Group',criterionId:'7',criterionResourceName:'customers/123/adGroupCriteria/4~7',keyword:'custody lawyer',matchType:'BROAD',status:'ENABLED'}
const add={id:'one',kind:'add_keyword',campaignId:'12',adGroupId:'4',keyword:'family lawyer',matchType:'EXACT'}
function fixture(options={}){
 const calls=[],entries=new Map(),experiments=new Map(),keywords=[{...original}],negatives=[],groupNegatives=[]
 const row=k=>({campaign:{id:k.campaignId,name:k.campaignName,status:'ENABLED'},adGroup:{id:k.adGroupId,name:k.adGroupName,status:'ENABLED'},adGroupCriterion:{criterionId:k.criterionId,resourceName:k.criterionResourceName,status:k.status,negative:false,keyword:{text:k.keyword,matchType:k.matchType}}})
 const db={byRequest:async id=>entries.get(id),get:async id=>[...entries.values()].find(e=>e.id===id),reserve:async e=>{calls.push({type:'reserve'});if(options.reserveFail)throw new Error('Cloud unavailable');if(entries.has(e.request_key))return{fresh:false,entry:structuredClone(entries.get(e.request_key))};entries.set(e.request_key,structuredClone(e));return{fresh:true,entry:structuredClone(e)}},update:async(id,patch)=>{if(options.historyFail)throw new Error('History unavailable');Object.assign([...entries.values()].find(e=>e.id===id),structuredClone(patch));return[{}]},history:async()=>[...entries.values()],keywordExperiments:async()=>[...experiments.values()],getKeywordExperiment:async id=>structuredClone(experiments.get(id)),insertKeywordExperiment:async e=>{assert.equal(e.state,'proposed');experiments.set(e.id,structuredClone(e));return e},updateKeywordExperiment:async(id,patch)=>{assert.equal(Object.hasOwn(patch,'approved_by'),false);if(options.metadataFail&&patch.state==='active')throw new Error('Metadata unavailable');const e=experiments.get(id);if(e.state==='proposed'&&['approved','active'].includes(patch.state))e.approved_by='user';Object.assign(e,patch);return structuredClone(e)}}
 const deps={accountId:'123',account:{id:'123',timeZone:'UTC'},actor:{id:'user',email:'user@beveridgelawfirm.com'},canWrite:options.canWrite!==false,db,now:()=>new Date('2026-09-13T12:00:00Z'),query:async q=>{
  calls.push({type:'query',q});if(options.inventoryFail&&q.includes('FROM ad_group_criterion'))throw new Error('Inventory unavailable')
  if(options.negativeFail&&q.includes('FROM shared_criterion'))throw new Error('Negative inventory unavailable')
  if(q.includes('FROM ad_group WHERE'))return[{campaign:{id:'12',name:'Campaign',status:'ENABLED'},adGroup:{id:'4',name:'Group',status:'ENABLED'}}]
  if(q.includes('FROM campaign WHERE'))return[{campaign:{id:'12',name:'Campaign',status:'ENABLED'}}]
  if(q.includes('FROM campaign_criterion'))return negatives
  if(q.includes('FROM ad_group_criterion')){
   if(q.includes('negative = TRUE'))return groupNegatives
   const resource=q.match(/resource_name = '([^']+)'/)?.[1]
   return [...keywords.filter(k=>!resource||k.criterionResourceName===resource).map(row),...groupNegatives.filter(r=>r.adGroupCriterion.resourceName===resource)]
  }
  return[]
 },post:async(path,body)=>{
  const op=body.operations[0];calls.push({type:'post',path,body:structuredClone(body)})
  if(body.validateOnly){if(options.validationFail===true||options.validationFail==='pause'&&op.update)throw Object.assign(new Error('Invalid operation'),{googlePayload:{},requestId:'validate-error'});if(options.staleDuringValidation)keywords[0].status='PAUSED';return{payload:{},requestId:'validation'}}
  if(op.create){if(options.createFail)throw Object.assign(new Error('Create rejected'),{googlePayload:{},requestId:'create-error'});if(options.createUnknown)throw new Error('Create timed out')
   const c=op.create,resource=options.wrongResource?'customers/999/adGroupCriteria/4~8':`customers/123/${c.campaign?'campaignCriteria/12':'adGroupCriteria/4'}~8`
   if(c.negative){if(c.campaign)negatives.push({campaign:{id:'12'},campaignCriterion:{resourceName:resource,status:'ENABLED',negative:true,keyword:c.keyword}});else groupNegatives.push({campaign:{id:'12'},adGroup:{id:'4'},adGroupCriterion:{resourceName:resource,status:'ENABLED',negative:true,keyword:c.keyword}})}
   else if(!options.missingCreated)keywords.push({...original,criterionId:'8',criterionResourceName:resource,keyword:c.keyword.text,matchType:c.keyword.matchType,status:c.status})
   return{payload:{results:[{resourceName:resource}]},requestId:'create'}
  }
  if(options.pauseUnknown)throw Object.assign(new Error('Pause timed out'),{requestId:'pause-unknown'})
  const found=keywords.find(k=>k.criterionResourceName===op.update.resourceName);if(found)found.status=op.update.status
  return{payload:{results:[{resourceName:op.update.resourceName}]},requestId:'status'}
 }}
 const service=createWorkspaceService(deps)
 return{service,deps,calls,entries,keywords,experiments,options,live:()=>calls.filter(c=>c.type==='post'&&!c.body.validateOnly),review:items=>service.keywordReview({requestId,items}),async apply(items){const r=await this.review(items);return service.keywordApply({requestId,reviewId:r.reviewId,fingerprint:r.fingerprint,items:r.items,confirmation:'APPLY'})},async change(){const s=await service.keywordLabSnapshot({});return{id:'one',kind:'change_match_type',campaignId:'12',adGroupId:'4',criterionResourceName:original.criterionResourceName,expectedRevision:s.keywords[0].revision,keyword:'custody lawyer',matchType:'EXACT'}}}
}

test('keyword handlers exist and snapshot provides revision',async()=>{const f=fixture();assert.equal(typeof f.service.keywordReview,'function');assert.equal(typeof f.service.keywordApply,'function');assert.equal(typeof f.service.keywordVerify,'function');assert.match((await f.service.keywordLabSnapshot()).keywords[0].revision,/^[a-f0-9]{64}$/)})
test('payload validation rejects unsupported kinds, missing match, foreign identity, and duplicate item IDs',async()=>{for(const items of[[{...add,kind:'remove'}],[{...add,matchType:''}],[{...add,kind:'pause_keyword',criterionResourceName:'customers/999/adGroupCriteria/4~7',expectedRevision:'a'.repeat(64)}],[add,{...add,keyword:'second'}]]){const f=fixture();await assert.rejects(f.review(items));assert.equal(f.live().length,0)}})
test('duplicate and covered additions cannot be approved',async()=>{for(const items of[[add,{...add,id:'two'}],[{...add,keyword:'custody lawyer',matchType:'BROAD'}]]){const f=fixture();await assert.rejects(f.review(items),/duplicate|already/i);assert.equal(f.live().length,0)}})
test('incomplete positive or negative inventory blocks review and live writes',async()=>{for(const options of[{inventoryFail:true},{negativeFail:true}]){const f=fixture(options);await assert.rejects(f.review([add]),/inventory/i);assert.equal(f.live().length,0)}})
test('review persists canonical payload but never calls Google mutate',async()=>{const f=fixture(),r=await f.review([add]);assert.equal(r.items[0].campaignName,'Campaign');assert.match(r.fingerprint,/^[a-f0-9]{64}$/);assert.equal(f.calls.filter(c=>c.type==='post').length,0);assert.equal([...f.entries.values()][0].kind,'keyword_lab')})
test('authorization, review edits, stale originals and reused IDs cannot mutate',async()=>{
 const f=fixture(),item=await f.change(),r=await f.review([item]),body={requestId,reviewId:r.reviewId,fingerprint:r.fingerprint,items:r.items,confirmation:'APPLY'}
 await assert.rejects(f.service.keywordApply({...body,confirmation:''}),/APPLY/)
 await assert.rejects(f.service.keywordApply({...body,items:[{...r.items[0],matchType:'PHRASE'}]}),/review|approval/i)
 await assert.rejects(f.review([{...item,matchType:'PHRASE'}]),/request|approval/i)
 f.keywords[0].status='PAUSED';await assert.rejects(f.service.keywordApply(body),/changed|stale/i);assert.equal(f.live().length,0)
 const locked=createWorkspaceService({...f.deps,canWrite:false});await assert.rejects(locked.keywordApply(body),/locked/i)
})
test('all operations validate before create, replacement verifies by resource before pause',async()=>{const f=fixture(),r=await f.apply([await f.change()]),posts=f.calls.filter(c=>c.type==='post');assert.equal(r.status,'verified');assert.deepEqual(posts.map(c=>c.body.validateOnly),[true,true,false,false]);const createAt=f.calls.indexOf(posts[2]),pauseAt=f.calls.indexOf(posts[3]);assert.ok(f.calls.slice(createAt+1,pauseAt).some(c=>c.q?.includes("resource_name = 'customers/123/adGroupCriteria/4~8'")));assert.equal(f.keywords[0].status,'PAUSED');assert.equal(r.results[0].create.requestId,'create');assert.equal(r.results[0].pause.requestId,'status')})
test('failed creation, missing or foreign read-back never pauses original',async()=>{for(const options of[{createFail:true},{missingCreated:true},{wrongResource:true},{validationFail:'pause'}]){const f=fixture(options),r=await f.apply([await f.change()]);assert.notEqual(r.status,'verified');assert.equal(f.keywords[0].status,'ENABLED');assert.equal(f.live().filter(c=>c.body.operations[0].update).length,0)}})
test('uncertain pause retains confirmed create and never retries either write',async()=>{const f=fixture({pauseUnknown:true}),item=await f.change(),r=await f.apply([item]);assert.equal(r.status,'unverified');assert.equal(r.results[0].create.state,'verified');assert.equal(r.results[0].pause.state,'unverified');assert.equal(r.results[0].pause.requestId,'pause-unknown');const before=f.live().length;await f.apply([item]);await f.service.keywordVerify({eventId:r.eventId});assert.equal(f.live().length,before)})
test('uncertain create and concurrent apply are reserved once and never resent',async()=>{const f=fixture({createUnknown:true}),r=await f.review([add]),body={requestId,reviewId:r.reviewId,fingerprint:r.fingerprint,items:r.items,confirmation:'APPLY'};const results=await Promise.all([f.service.keywordApply(body),f.service.keywordApply(body)]);assert.equal(f.live().length,1);assert.ok(results.some(r=>r.status==='unverified'));await f.service.keywordApply(body);assert.equal(f.live().length,1)})
test('cloud reservation and last-minute stale changes prevent live mutation',async()=>{const blocked=fixture({reserveFail:true});await assert.rejects(blocked.apply([add]),/Cloud/);assert.equal(blocked.live().length,0);const stale=fixture({staleDuringValidation:true}),r=await stale.apply([await stale.change()]);assert.notEqual(r.status,'verified');assert.equal(stale.live().length,0)})
test('verified experimental creation records lifecycle, real identity, start and approver',async()=>{const f=fixture(),r=await f.apply([{...add,kind:'add_experimental_keyword',source:'planner',hypothesis:'Try specific intent'}]),e=[...f.experiments.values()][0];assert.equal(r.status,'verified');assert.equal(e.state,'active');assert.equal(e.approved_by,'user');assert.equal(e.criterion_resource_name,'customers/123/adGroupCriteria/4~8');assert.equal(e.experiment_started_at,'2026-09-13T12:00:00.000Z');assert.equal(r.results[0].experiment.state,'persisted')})
test('metadata failure keeps verified Google result and read-only reconciliation repairs metadata',async()=>{const f=fixture({metadataFail:true}),r=await f.apply([{...add,kind:'add_experimental_keyword',source:'manual'}]);assert.equal(r.results[0].create.state,'verified');assert.equal(r.status,'unverified');assert.equal(r.results[0].experiment.state,'unverified');f.options.metadataFail=false;const count=f.live().length,v=await f.service.keywordVerify({eventId:r.eventId});assert.equal(f.live().length,count);assert.equal(v.status,'verified');assert.equal([...f.experiments.values()][0].state,'active')})
test('HTTP independently denies locked keyword_apply and requires POST',async()=>{await assert.rejects(handleAdsWorkspace({method:'POST',query:{action:'keyword_apply'},headers:{}},{},{writeModeForUser:()=>({ready:false})}),/locked/);await assert.rejects(handleAdsWorkspace({method:'GET',query:{action:'keyword_review'},headers:{}},{},{writeModeForUser:()=>({ready:true})}),/method/)})
test('add-match, pause, enable and both negative scopes verify the exact requested state',async()=>{
 for(const kind of ['add_match_type','pause_keyword','enable_keyword','add_campaign_negative','add_ad_group_negative']){
  const f=fixture();if(kind==='enable_keyword')f.keywords[0].status='PAUSED'
  const changed=await f.change(),item=kind.endsWith('_negative')?{...add,kind}:{...changed,kind,matchType:kind==='add_match_type'?'EXACT':'BROAD'},r=await f.apply([item]);assert.equal(r.status,'verified',kind);assert.equal(f.live().length,1)
  if(kind==='add_match_type')assert.equal(f.keywords[0].status,'ENABLED')
  if(kind==='add_campaign_negative')assert.match(f.live()[0].path,/campaignCriteria:mutate$/)
  if(kind==='add_ad_group_negative')assert.match(f.live()[0].path,/adGroupCriteria:mutate$/)
 }
})
test('basket conflicts cannot add a keyword and a negative that blocks it',async()=>{const f=fixture();await assert.rejects(f.review([add,{...add,id:'negative',kind:'add_campaign_negative'}]),/conflict|block/i);assert.equal(f.live().length,0)})
test('wrong destination campaign/ad-group relationship cannot enter review',async()=>{const f=fixture();await assert.rejects(f.review([{...add,adGroupId:'9'}]),/destination/i)})
test('another actor cannot apply or verify a reviewed approval',async()=>{const f=fixture(),review=await f.review([add]),other=createWorkspaceService({...f.deps,actor:{id:'other',email:'other@beveridgelawfirm.com'}});await assert.rejects(other.keywordApply({requestId,reviewId:review.reviewId,fingerprint:review.fingerprint,items:review.items,confirmation:'APPLY'}),/original approver/);const applied=await f.apply([add]);await assert.rejects(other.keywordVerify({eventId:applied.eventId}),/original approver/);assert.equal(f.live().length,1)})
test('metadata-only proposal, approval, continue and promotion need no Google calls',async()=>{const f=fixture(),proposal=await f.service.keywordExperimentUpdate({action:'propose',item:{...add,kind:'add_experimental_keyword',campaignName:'Campaign',adGroupName:'Group'}});assert.equal(proposal.experiment.state,'proposed');const id=proposal.experiment.id;let e=f.experiments.get(id);e.updated_at='2026-09-13T12:00:00Z';await f.service.keywordExperimentUpdate({action:'approve',experimentId:id,expectedState:'proposed',expectedUpdatedAt:e.updated_at});assert.equal(e.state,'approved');Object.assign(e,{state:'active',criterion_resource_name:'customers/123/adGroupCriteria/4~8',criterion_id:'8',experiment_started_at:'2026-09-13T12:00:00Z'});await f.service.keywordExperimentUpdate({action:'continue',experimentId:id,expectedState:'active',expectedUpdatedAt:e.updated_at,hypothesis:'Continue to collect evidence'});assert.equal(e.hypothesis,'Continue to collect evidence');await f.service.keywordExperimentUpdate({action:'promote_to_core',experimentId:id,expectedState:'active',expectedUpdatedAt:e.updated_at});assert.equal(e.state,'promoted_to_core');assert.equal(f.calls.length,0)})
test('stale metadata and trying to continue a paused experiment cannot bypass live review',async()=>{const f=fixture(),id='22222222-2222-4222-8222-222222222222';f.experiments.set(id,{id,account_id:'123',state:'paused',updated_at:'2026-09-13T12:00:00Z'});await assert.rejects(f.service.keywordExperimentUpdate({action:'continue',experimentId:id,expectedState:'paused',expectedUpdatedAt:'2026-09-13T12:00:00Z'}),/review|paused/i);await assert.rejects(f.service.keywordExperimentUpdate({action:'promote_to_core',experimentId:id,expectedState:'active',expectedUpdatedAt:'2026-09-13T12:00:00Z'}),/changed|stale/i)})
test('verified pause/enable also persist linked experiment state',async()=>{const f=fixture(),id='22222222-2222-4222-8222-222222222222';f.experiments.set(id,{id,account_id:'123',state:'active',approved_by:'user',criterion_resource_name:original.criterionResourceName,criterion_id:'7',campaign_id:'12',ad_group_id:'4'});const item={...await f.change(),kind:'pause_keyword',matchType:'BROAD',experimentId:id},result=await f.apply([item]);assert.equal(result.status,'verified');assert.equal(f.experiments.get(id).state,'paused')})
test('HTTP metadata lifecycle uses only granted cloud columns and no Google access',async()=>{
 const oldFetch=globalThis.fetch,oldAccount=process.env.GOOGLE_ADS_CUSTOMER_ID,calls=[];process.env.GOOGLE_ADS_CUSTOMER_ID='123';let stored
 globalThis.fetch=async(url,options)=>{const body=options.body?JSON.parse(options.body):null;calls.push({url,options,body});if(options.method==='POST')stored={...body,updated_at:'2026-09-13T12:00:00Z'};if(options.method==='PATCH'){assert.ok(url.includes('state=eq.proposed'));assert.ok(url.includes('updated_at=eq.'));assert.deepEqual(body,{state:'approved'});stored={...stored,...body,approved_by:'user'}}return{ok:true,json:async()=>[stored]}}
 try{const base={writeModeForUser:()=>({ready:false}),googleAccessToken:async()=>{throw new Error('Must not access Google')}},user={id:'user',email:'user@beveridgelawfirm.com'},req={method:'POST',query:{action:'keyword_experiment_update'},headers:{authorization:'Bearer test'},body:{action:'propose',item:{...add,kind:'add_experimental_keyword'}}};const p=await handleAdsWorkspace(req,user,base);assert.equal(p.experiment.state,'proposed');req.body={action:'approve',experimentId:p.experiment.id,expectedState:'proposed',expectedUpdatedAt:'2026-09-13T12:00:00Z'};const a=await handleAdsWorkspace(req,user,base);assert.equal(a.experiment.state,'approved');assert.equal(calls.length,3)}finally{globalThis.fetch=oldFetch;if(oldAccount===undefined)delete process.env.GOOGLE_ADS_CUSTOMER_ID;else process.env.GOOGLE_ADS_CUSTOMER_ID=oldAccount}
})
test('corrupted stored plan cannot change the reviewed destination or operation',async()=>{const f=fixture(),r=await f.review([add]);[...f.entries.values()][0].after_snapshot.items[0].keyword='unreviewed keyword';await assert.rejects(f.service.keywordApply({requestId,reviewId:r.reviewId,fingerprint:r.fingerprint,items:r.items,confirmation:'APPLY'}),/review|approval/i);assert.equal(f.live().length,0)})
test('an experiment snapshot exposes its cloud version for stale lifecycle protection',async()=>{const f=fixture();f.experiments.set('e',{id:'e',state:'proposed',updated_at:'2026-09-13T12:00:00Z'});const r=await f.service.keywordExperiments({});assert.equal(r.experiments[0].updatedAt,'2026-09-13T12:00:00Z')})
test('pause from Current Keywords synchronizes an existing experiment without a caller-supplied experiment ID',async()=>{const f=fixture(),id='22222222-2222-4222-8222-222222222222';f.experiments.set(id,{id,account_id:'123',state:'active',approved_by:'user',criterion_resource_name:original.criterionResourceName,criterion_id:'7',campaign_id:'12',ad_group_id:'4'});const item={...await f.change(),kind:'pause_keyword',matchType:'BROAD'},r=await f.apply([item]);assert.equal(r.status,'verified');assert.equal(f.experiments.get(id).state,'paused')})
test('verified metadata is never reset by later reconciliation after promotion',async()=>{const f=fixture(),r=await f.apply([{...add,kind:'add_experimental_keyword'}]),e=[...f.experiments.values()][0];e.state='promoted_to_core';const v=await f.service.keywordVerify({eventId:r.eventId});assert.equal(v.status,'verified');assert.equal(e.state,'promoted_to_core')})
test('uncertain replacement reports both freshly observed criterion states',async()=>{const f=fixture({pauseUnknown:true}),r=await f.apply([await f.change()]);assert.equal(r.results[0].create.observed.status,'ENABLED');assert.equal(r.results[0].pause.observed.status,'ENABLED');const v=await f.service.keywordVerify({eventId:r.eventId});assert.equal(v.results[0].pause.observed.status,'ENABLED');assert.equal(v.status,'unverified')})
test('unreadable Google response retains its request ID for uncertain write reconciliation',async()=>{await assert.rejects(googleAdsPost('offline','customers/123/adGroupCriteria:mutate',{},async()=>({headers:{get:()=> 'unreadable-request-id'},text:async()=>'{broken'})),error=>error.requestId==='unreadable-request-id'&&!error.googlePayload)})
test('a cloud checkpoint failure preserves confirmed create and prevents replacement pause',async()=>{const f=fixture(),save=f.deps.db.update;let rejected=false;f.deps.db.update=async(id,patch)=>{if(!rejected&&patch.result?.results[0]?.create?.state==='verified'){rejected=true;throw new Error('Cloud checkpoint failed')}return save(id,patch)};const r=await f.apply([await f.change()]);assert.equal(r.results[0].create.state,'verified');assert.equal(r.results[0].create.requestId,'create');assert.equal(f.live().length,1);assert.equal(f.keywords[0].status,'ENABLED');assert.match(r.historyWarning,/Cloud history/);assert.equal(r.status,'unverified')})
test('reconciliation cannot overwrite an approval that may still be executing',async()=>{const f=fixture(),r=await f.apply([add]),event=[...f.entries.values()].find(e=>e.id===r.eventId);delete event.result.appliedAt;await assert.rejects(f.service.keywordVerify({eventId:r.eventId}),/processing|executing/i)})
test('lost activation response reconciliation preserves newer experiment lifecycle states',async()=>{
 for(const laterState of ['paused','promoted_to_core','ended']){
  const f=fixture(),save=f.deps.db.updateKeywordExperiment;let lost=false,activationWrites=0
  f.deps.db.updateKeywordExperiment=async(...args)=>{const saved=await save(...args);if(args[1].state==='active'){activationWrites++;if(!lost){lost=true;throw new Error('Activation committed but response was lost')}}return saved}
  const applied=await f.apply([{...add,kind:'add_experimental_keyword'}]),experiment=[...f.experiments.values()][0]
  assert.equal(applied.results[0].experiment.state,'unverified');assert.equal(experiment.state,'active')
  experiment.state=laterState
  const verified=await f.service.keywordVerify({eventId:applied.eventId})
  assert.equal(experiment.state,laterState);assert.equal(activationWrites,1);assert.equal(verified.results[0].experiment.state,'persisted');assert.equal(verified.status,'verified');assert.equal(f.live().length,1)
 }
})
test('activation recovery uses a conditional pending-state update and respects a newer concurrent state',async()=>{
 const f=fixture({metadataFail:true}),applied=await f.apply([{...add,kind:'add_experimental_keyword'}]),experiment=[...f.experiments.values()][0]
 f.options.metadataFail=false;experiment.updated_at='2026-09-13T12:00:01Z'
 const save=f.deps.db.updateKeywordExperiment
 f.deps.db.updateKeywordExperiment=async(id,patch,expected)=>{
  if(patch.state==='active'){
   assert.deepEqual(expected,{state:'approved',updatedAt:'2026-09-13T12:00:01Z'})
   Object.assign(experiment,{...patch,state:'paused',updated_at:'2026-09-13T12:00:02Z'})
   return null // the guarded UPDATE lost to the other activation + pause
  }
  return save(id,patch,expected)
 }
 const verified=await f.service.keywordVerify({eventId:applied.eventId})
 assert.equal(experiment.state,'paused');assert.equal(verified.results[0].experiment.state,'persisted');assert.equal(verified.status,'verified')
})
test('a failed required pre-send checkpoint halts all later items even when cloud writes recover',async()=>{
 const f=fixture(),save=f.deps.db.update;let rejected=false
 f.deps.db.update=async(id,patch)=>{if(!rejected&&patch.result.results[0].create.attemptedAt&&!patch.result.results[0].create.requestId){rejected=true;throw new Error('Required pre-send checkpoint unavailable')}return save(id,patch)}
 const result=await f.apply([add,{...add,id:'two',keyword:'second keyword'}])
 assert.equal(rejected,true);assert.equal(f.live().length,0);assert.equal(result.results[0].create.state,'failed');assert.equal(result.results[1].create.state,'pending');assert.match(result.historyWarning,/Cloud history/)
})
test('change-match on a paused original creates and verifies a paused replacement without enabling either criterion',async()=>{
 const f=fixture();f.keywords[0].status='PAUSED'
 const result=await f.apply([await f.change()]),posts=f.calls.filter(c=>c.type==='post')
 assert.equal(result.status,'verified');assert.deepEqual(posts.map(c=>c.body.validateOnly),[true,true,false,false]);assert.equal(posts[0].body.operations[0].create.status,'PAUSED');assert.equal(posts[2].body.operations[0].create.status,'PAUSED')
 assert.equal(result.results[0].create.observed.status,'PAUSED');assert.equal(result.results[0].pause.observed.status,'PAUSED');assert.deepEqual(f.keywords.map(k=>k.status),['PAUSED','PAUSED'])
 const createAt=f.calls.indexOf(posts[2]),pauseAt=f.calls.indexOf(posts[3]);assert.ok(f.calls.slice(createAt+1,pauseAt).some(c=>c.q?.includes("resource_name = 'customers/123/adGroupCriteria/4~8'")))
})
