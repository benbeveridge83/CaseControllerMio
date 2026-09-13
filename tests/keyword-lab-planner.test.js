import test from 'node:test'
import assert from 'node:assert/strict'
import * as transport from '../lib/ads/transport.js'
import {createWorkspaceService} from '../lib/ads/service.js'
import {handleAdsWorkspace} from '../lib/ads/http.js'

const NOW='2026-09-13T18:00:00.000Z'
const ACCOUNT={id:'123',timeZone:'America/Chicago',currencyCode:'USD'}
const ACTOR={id:'user-1',email:'ben@beveridgelawfirm.com'}
const rawIdea={
 text:'Custody Attorney',
 keywordIdeaMetrics:{
  avgMonthlySearches:'480',competition:'HIGH',competitionIndex:'82',
  lowTopOfPageBidMicros:'1750000',highTopOfPageBidMicros:'6200000',
  monthlySearchVolumes:[{year:'2026',month:'AUGUST',monthlySearches:'510'}]
 }
}

function fixture({cached=[],planner=async()=>({results:[rawIdea]}),history=cached}={}){
 const saved=[],lookups=[]
 const db={
  keywordExperiments:async()=>[],
  findKeywordMarketCache:async context=>{lookups.push(context);return cached[0]||null},
  saveKeywordMarketCache:async row=>{saved.push(row);return row},
  keywordMarketHistory:async()=>history,
 }
 const service=createWorkspaceService({accountId:'123',account:ACCOUNT,actor:ACTOR,canWrite:false,query:async()=>[],post:async()=>({}),planner,db,now:()=>new Date(NOW),plannerCacheTtlMs:86400000})
 return{service,saved,lookups,db}
}

test('transport sends keyword, URL, and combined seed shapes through the existing Google Ads headers',async()=>{
 assert.equal(typeof transport.googleKeywordIdeas,'function')
 const previous={customer:process.env.GOOGLE_ADS_CUSTOMER_ID,developer:process.env.GOOGLE_ADS_DEVELOPER_TOKEN,login:process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID}
 process.env.GOOGLE_ADS_CUSTOMER_ID='123-456-7890';process.env.GOOGLE_ADS_DEVELOPER_TOKEN='developer';process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID='999-888-7777'
 const calls=[]
 const fetchImpl=async(url,options)=>{calls.push({url,options});return{ok:true,status:200,headers:new Headers({'request-id':'planner-request'}),text:async()=>JSON.stringify({results:[rawIdea]})}}
 try{
  await transport.googleKeywordIdeas('oauth',{phrases:['custody lawyer'],locationIds:['2840'],languageId:'1000',network:'GOOGLE_SEARCH'},fetchImpl)
  await transport.googleKeywordIdeas('oauth',{url:'https://example.com/family'},fetchImpl)
  await transport.googleKeywordIdeas('oauth',{phrases:['custody lawyer'],url:'https://example.com/family'},fetchImpl)
  assert.equal(calls.length,3)
  assert.equal(calls[0].url,'https://googleads.googleapis.com/v25/customers/1234567890:generateKeywordIdeas')
  assert.equal(calls[0].options.headers.Authorization,'Bearer oauth')
  assert.equal(calls[0].options.headers['developer-token'],'developer')
  assert.equal(calls[0].options.headers['login-customer-id'],'9998887777')
  assert.deepEqual(JSON.parse(calls[0].options.body),{language:'languageConstants/1000',geoTargetConstants:['geoTargetConstants/2840'],keywordPlanNetwork:'GOOGLE_SEARCH',includeAdultKeywords:false,pageSize:10000,keywordSeed:{keywords:['custody lawyer']}})
  assert.deepEqual(JSON.parse(calls[1].options.body).urlSeed,{url:'https://example.com/family'})
  assert.deepEqual(JSON.parse(calls[2].options.body).keywordAndUrlSeed,{keywords:['custody lawyer'],url:'https://example.com/family'})
 }finally{
  for(const[key,value]of Object.entries(previous)){const env=key==='customer'?'GOOGLE_ADS_CUSTOMER_ID':key==='developer'?'GOOGLE_ADS_DEVELOPER_TOKEN':'GOOGLE_ADS_LOGIN_CUSTOMER_ID';if(value===undefined)delete process.env[env];else process.env[env]=value}
 }
})

test('normalizes Planner metrics and uses the full seed context as cache identity',async()=>{
 const seen=[]
 const{service,saved}=fixture({planner:async request=>{seen.push(request);return{results:[rawIdea]}}})
 const result=await service.keywordCandidates({seedType:'manual',phrases:['  Custody   Lawyer ','divorce attorney','custody lawyer'],url:'HTTPS://Example.COM/family#intro',locationIds:['2840','1026339','2840'],languageId:'1000',network:'GOOGLE_SEARCH'})
 assert.equal(seen.length,1)
 assert.deepEqual(seen[0],{phrases:['custody lawyer','divorce attorney'],url:'https://example.com/family',locationIds:['1026339','2840'],languageId:'1000',network:'GOOGLE_SEARCH'})
 assert.deepEqual(result.candidates,[{
  phrase:'Custody Attorney',avgMonthlySearches:480,monthlyVolumes:[{year:2026,month:'AUGUST',searches:510}],competition:'HIGH',competitionIndex:82,lowBid:1.75,highBid:6.2,source:'planner',
  context:{seedType:'manual',normalizedSeed:'keywords:custody lawyer|divorce attorney\nurl:https://example.com/family',locationIds:['1026339','2840'],languageId:'1000',network:'GOOGLE_SEARCH'}
 }])
 assert.equal(result.cache.status,'refreshed')
 assert.equal(saved.length,1)
 assert.deepEqual(saved[0].results,result.candidates)
 assert.equal(saved[0].retrieved_at,NOW)
 assert.equal(saved[0].expires_at,'2026-09-14T18:00:00.000Z')
 assert.equal(saved[0].created_by,'user-1')
})

test('returns a fresh contextual cache hit without calling Planner',async()=>{
 const candidate={phrase:'cached phrase',avgMonthlySearches:25,monthlyVolumes:[],competition:'LOW',competitionIndex:4,lowBid:null,highBid:null,source:'planner',context:{seedType:'keyword',normalizedSeed:'keywords:cached seed',locationIds:['2840'],languageId:'1000',network:'GOOGLE_SEARCH'}}
 const cached=[{id:'cache-1',account_id:'123',seed_type:'keyword',normalized_seed:'keywords:cached seed',location_ids:['2840'],language_id:'1000',network:'GOOGLE_SEARCH',results:[candidate],retrieved_at:'2026-09-13T12:00:00.000Z',expires_at:'2026-09-14T12:00:00.000Z'}]
 let plannerCalls=0
 const{service,saved,lookups}=fixture({cached,planner:async()=>{plannerCalls++;return{results:[]}}})
 const result=await service.keywordCandidates({seedType:'keyword',phrases:['Cached Seed'],locationIds:['2840']})
 assert.equal(plannerCalls,0);assert.equal(saved.length,0);assert.deepEqual(lookups,[{seedType:'keyword',normalizedSeed:'keywords:cached seed',locationIds:['2840'],languageId:'1000',network:'GOOGLE_SEARCH'}]);assert.deepEqual(result.candidates,[candidate]);assert.equal(result.cache.status,'hit')
})

test('refreshes stale cache and preserves omitted low-volume metrics as unavailable',async()=>{
 const stale=[{id:'old',account_id:'123',seed_type:'search_term',normalized_seed:'keywords:low volume query',location_ids:[],language_id:'1000',network:'GOOGLE_SEARCH',results:[{phrase:'old'}],retrieved_at:'2026-09-10T12:00:00.000Z',expires_at:'2026-09-11T12:00:00.000Z'}]
 const{service,saved}=fixture({cached:stale,planner:async()=>({results:[{text:'Low Volume Query',keywordIdeaMetrics:{competition:'UNKNOWN',monthlySearchVolumes:[{year:'2026',month:'AUGUST'}]}}]})})
 const result=await service.keywordCandidates({seedType:'search_term',phrases:['low volume query']})
 assert.equal(result.cache.status,'refreshed');assert.equal(saved.length,1)
 assert.deepEqual(result.candidates[0],{phrase:'Low Volume Query',avgMonthlySearches:null,monthlyVolumes:[{year:2026,month:'AUGUST',searches:null}],competition:'UNKNOWN',competitionIndex:null,lowBid:null,highBid:null,source:'planner',context:{seedType:'search_term',normalizedSeed:'keywords:low volume query',locationIds:[],languageId:'1000',network:'GOOGLE_SEARCH'}})
})

test('returns typed Planner-unavailable data and stale candidates without inventing metrics',async()=>{
 const staleCandidate={phrase:'last known phrase',avgMonthlySearches:null,monthlyVolumes:[],competition:null,competitionIndex:null,lowBid:null,highBid:null,source:'planner',context:{seedType:'url',normalizedSeed:'url:https://example.com/',locationIds:[],languageId:'1000',network:'GOOGLE_SEARCH'}}
 const cached=[{id:'old',account_id:'123',seed_type:'url',normalized_seed:'url:https://example.com/',location_ids:[],language_id:'1000',network:'GOOGLE_SEARCH',results:[staleCandidate],retrieved_at:'2026-09-10T12:00:00.000Z',expires_at:'2026-09-11T12:00:00.000Z'}]
 const{service}=fixture({cached,planner:async()=>{throw new Error('Planner permission denied')}})
 const result=await service.keywordCandidates({seedType:'url',url:'https://example.com'})
 assert.equal(result.ok,true);assert.equal(result.planner.available,false);assert.equal(result.planner.code,'PLANNER_UNAVAILABLE');assert.match(result.planner.message,/permission denied/);assert.equal(result.cache.status,'stale');assert.deepEqual(result.candidates,[staleCandidate])
})

test('normalizes contextual Planner cache history and HTTP exposes both read actions',async()=>{
 const previousCustomer=process.env.GOOGLE_ADS_CUSTOMER_ID;process.env.GOOGLE_ADS_CUSTOMER_ID='123'
 const row={id:'cache-7',account_id:'123',seed_type:'manual',normalized_seed:'keywords:family lawyer',location_ids:['2840'],language_id:'1000',network:'GOOGLE_SEARCH',results:[{phrase:'family attorney'}],retrieved_at:'2026-09-12T18:00:00.000Z',expires_at:'2026-09-13T18:00:00.000Z'}
 const marketCacheDb={findKeywordMarketCache:async()=>null,saveKeywordMarketCache:async value=>value,keywordMarketHistory:async()=>[row]}
 const base={writeModeForUser:()=>({ready:false}),googleAccessToken:async()=> 'token',accountInfo:async()=>ACCOUNT,googleAdsSearch:async()=>[],googleAdsPost:async()=>({payload:{}}),googleKeywordIdeas:async()=>({results:[]}),marketCacheDb,now:()=>new Date(NOW)}
 try{
  const history=await handleAdsWorkspace({method:'GET',query:{action:'keyword_history'},headers:{}},ACTOR,base)
  assert.deepEqual(history.entries,[{id:'cache-7',accountId:'123',seedType:'manual',normalizedSeed:'keywords:family lawyer',locationIds:['2840'],languageId:'1000',network:'GOOGLE_SEARCH',results:[{phrase:'family attorney'}],retrievedAt:'2026-09-12T18:00:00.000Z',expiresAt:'2026-09-13T18:00:00.000Z'}])
  const candidates=await handleAdsWorkspace({method:'GET',query:{action:'keyword_candidates',seedType:'manual',phrases:'family lawyer',locationIds:'2840',languageId:'1000',network:'GOOGLE_SEARCH'},headers:{}},ACTOR,base)
  assert.equal(candidates.ok,true);assert.equal(candidates.cache.status,'refreshed')
 }finally{if(previousCustomer===undefined)delete process.env.GOOGLE_ADS_CUSTOMER_ID;else process.env.GOOGLE_ADS_CUSTOMER_ID=previousCustomer}
})
