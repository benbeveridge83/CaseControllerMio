import crypto from 'node:crypto'
import {adDraft,normalizeAdDraft,requireId,prepareNegatives,aggregateMetrics,aggregateReportingMetrics,reportingMetrics,text} from './model.js'
import {effectiveDays,groupTermsByKeyword,normalizeDateRange,withPerDayMetrics} from './keyword-lab.js'
export const AD_FIELDS=`campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name, ad_group.status,
 ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.resource_name, ad_group_ad.ad.name, ad_group_ad.ad.type,
 ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
 ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2, ad_group_ad.ad_strength,
 ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status,
 ad_group_ad.policy_summary.policy_topic_entries, ad_group_ad.primary_status, ad_group_ad.primary_status_reasons`
export const SEARCH_FIELDS=`campaign.id, campaign.name, ad_group.id, ad_group.name, search_term_view.search_term,
 segments.search_term_match_type, segments.keyword.ad_group_criterion, segments.keyword.info.text, segments.keyword.info.match_type, segments.device`
export const KEYWORD_FIELDS=`campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.criterion_id,
 ad_group_criterion.resource_name, ad_group_criterion.status, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type`
export const KEYWORD_OPTIONAL_METRICS=`metrics.search_impression_share, metrics.search_rank_lost_impression_share,
 metrics.search_budget_lost_impression_share, metrics.top_impression_percentage, metrics.absolute_top_impression_percentage`
const METRICS='metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions'
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex')
export const revisionOf=ad=>digest(adDraft(ad))
const scope=r=>({campaignId:String(r.campaign?.id||''),campaignName:r.campaign?.name||'',adGroupId:String(r.adGroup?.id||''),adGroupName:r.adGroup?.name||''})
const metrics=r=>aggregateMetrics([{impressions:Number(r.metrics?.impressions)||0,clicks:Number(r.metrics?.clicks)||0,cost:(Number(r.metrics?.costMicros)||0)/1e6,conversions:Number(r.metrics?.conversions)||0}])
const dateInZone=(date,tz)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(date)
const shift=(day,n)=>new Date(new Date(`${day}T12:00:00Z`).getTime()+n*86400000).toISOString().slice(0,10)
const dateWhere=r=>`segments.date BETWEEN '${r.start||r.startDate}' AND '${r.end||r.endDate}'`
const filterScope=a=>`${a.campaignId?` AND campaign.id = ${requireId(a.campaignId)}`:''}${a.adGroupId?` AND ad_group.id = ${requireId(a.adGroupId)}`:''}`
function normalizedRefs(rows){return rows.map(r=>`${r.campaignId}:${r.adGroupId}`).sort()}
function partialErrors(payload){const out=new Map();for(const d of payload?.partialFailureError?.details||[])for(const e of d.errors||[]){const part=e.location?.fieldPathElements?.find(p=>p.fieldName==='operations');if(part&&part.index!==undefined)out.set(Number(part.index),e.message||'Google rejected this item.')}return out}
const valueOrNull=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null
const criterionIdFromResource=resourceName=>String(resourceName||'').match(/adGroupCriteria\/\d+~(\d+)$/)?.[1]||null
const criterionIdentity=row=>row.criterionResourceName?`resource:${row.criterionResourceName}`:row.criterionId?`criterion:${row.adGroupId}:${row.criterionId}`:null
const zeroReportingMetrics=()=>reportingMetrics({impressions:0,clicks:0,cost:0,conversions:0})
function keywordIdentity(row={}){
 const criterion=row.adGroupCriterion||{},criterionResourceName=criterion.resourceName||null
 return{...scope(row),criterionId:criterion.criterionId===null||criterion.criterionId===undefined?criterionIdFromResource(criterionResourceName):String(criterion.criterionId),criterionResourceName}
}
function optionalKeywordMetrics(row={}){
 const source=row.metrics||{}
 return{searchImpressionShare:valueOrNull(source.searchImpressionShare),searchRankLostImpressionShare:valueOrNull(source.searchRankLostImpressionShare),searchBudgetLostImpressionShare:valueOrNull(source.searchBudgetLostImpressionShare),topImpressionRate:valueOrNull(source.topImpressionPercentage),absoluteTopImpressionRate:valueOrNull(source.absoluteTopImpressionPercentage)}
}
function selectedKeywordRange(args,tz){
 let selection=args.dateRange??args.range??args.preset
 if(!selection&&('startDate'in args||'endDate'in args))selection={startDate:args.startDate,endDate:args.endDate}
 if(!selection&&[7,14,30,90].includes(Number(args.days)))selection=`LAST_${Number(args.days)}_DAYS`
 selection=selection||'LAST_30_DAYS'
 const today=args.today||dateInZone(new Date(),tz),range=normalizeDateRange(selection,today)
 return{...range,days:effectiveDays(range),timeZone:tz}
}
function experimentDate(value,tz){
 if(!value)return null
 if(/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return String(value)
 const date=new Date(value)
 if(Number.isNaN(date.valueOf()))throw new Error('Experiment start date must be a valid date.')
 return dateInZone(date,tz)
}
function normalizeExperiment(row={}){
 return{id:row.id,campaignId:String(row.campaign_id??row.campaignId??''),campaignName:row.campaign_name??row.campaignName??'',adGroupId:String(row.ad_group_id??row.adGroupId??''),adGroupName:row.ad_group_name??row.adGroupName??'',criterionId:row.criterion_id??row.criterionId??null,criterionResourceName:row.criterion_resource_name??row.criterionResourceName??null,keyword:row.keyword??'',matchType:row.match_type??row.matchType??'',source:row.source??'',hypothesis:row.hypothesis??null,experimentStartedAt:row.experiment_started_at??row.experimentStartedAt??null,approvedBy:row.approved_by??row.approvedBy??null,state:row.state??''}
}
const plannerNumber=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null
function plannerList(value){return(Array.isArray(value)?value:String(value||'').split(/[\n,]/)).map(item=>String(item).trim().replace(/\s+/g,' ').toLowerCase()).filter(Boolean)}
function plannerUrl(value){
 if(!value)return''
 let parsed;try{parsed=new URL(String(value).trim())}catch{throw new Error('Landing-page URL must be a valid HTTP or HTTPS URL.')}
 if(!['http:','https:'].includes(parsed.protocol))throw new Error('Landing-page URL must use HTTP or HTTPS.')
 parsed.hash='';return parsed.toString()
}
function plannerContext(args={}){
 const seedType=String(args.seedType||'manual').trim().toLowerCase().replace('-','_')
 if(!['manual','keyword','search_term','url'].includes(seedType))throw new Error('Keyword seed type must be manual, keyword, search_term, or url.')
 const phrases=[...new Set(plannerList(args.phrases??args.keywords??args.seed))].sort(),url=plannerUrl(args.url)
 if(phrases.length>20)throw new Error('Keyword Planner accepts at most 20 seed phrases.')
 if(seedType==='url'&&phrases.length)throw new Error('URL seeds cannot also contain keyword phrases. Use a manual, keyword, or search_term seed for phrase + URL discovery.')
 if(seedType==='url'&&!url)throw new Error('A landing-page URL is required for a URL seed.')
 if(seedType!=='url'&&!phrases.length)throw new Error('At least one keyword phrase is required for this seed type.')
 const locationIds=[...new Set(plannerList(args.locationIds).map(value=>requireId(value,'Location ID')))].sort(),languageId=requireId(args.languageId||'1000','Language ID'),network=String(args.network||'GOOGLE_SEARCH').trim().toUpperCase()
 if(!['GOOGLE_SEARCH','GOOGLE_SEARCH_AND_PARTNERS'].includes(network))throw new Error('Keyword Planner network must be GOOGLE_SEARCH or GOOGLE_SEARCH_AND_PARTNERS.')
 const normalizedSeed=[phrases.length?`keywords:${phrases.join('|')}`:'',url?`url:${url}`:''].filter(Boolean).join('\n')
 return{seedType,normalizedSeed,phrases,url,locationIds,languageId,network}
}
function normalizePlannerCandidate(row={},context){
 const metric=row.keywordIdeaMetrics||{}
 return{phrase:String(row.text||'').trim(),avgMonthlySearches:plannerNumber(metric.avgMonthlySearches),monthlyVolumes:(metric.monthlySearchVolumes||[]).map(value=>({year:plannerNumber(value.year),month:value.month??null,searches:plannerNumber(value.monthlySearches)})),competition:metric.competition??null,competitionIndex:plannerNumber(metric.competitionIndex),lowBid:plannerNumber(metric.lowTopOfPageBidMicros)===null?null:plannerNumber(metric.lowTopOfPageBidMicros)/1e6,highBid:plannerNumber(metric.highTopOfPageBidMicros)===null?null:plannerNumber(metric.highTopOfPageBidMicros)/1e6,source:'planner',context}
}
function normalizeMarketCache(row={}){return{id:row.id,accountId:String(row.account_id??row.accountId??''),seedType:row.seed_type??row.seedType??'',normalizedSeed:row.normalized_seed??row.normalizedSeed??'',locationIds:row.location_ids??row.locationIds??[],languageId:String(row.language_id??row.languageId??''),network:row.network??'',results:Array.isArray(row.results)?row.results:[],retrievedAt:row.retrieved_at??row.retrievedAt??null,expiresAt:row.expires_at??row.expiresAt??null}}
// Dependencies are injected so all regression tests run without live Google writes.
export function createWorkspaceService(d){
 const accountId=requireId(d.accountId,'Account ID'),tz=d.account?.timeZone||'UTC'
 const rangeFor=days=>{days=[7,14,30,90].includes(Number(days))?Number(days):30;const end=dateInZone(new Date(),tz);return{days,start:shift(end,1-days),end,timeZone:tz}}
 async function getAds(){return(await d.query(`SELECT ${AD_FIELDS} FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'`)).map(r=>{const a=r.adGroupAd?.ad||{},content=adDraft(a);return{...scope(r),id:String(a.id||''),name:a.name||'',type:a.type||'',status:r.adGroupAd?.status||'UNKNOWN',campaignStatus:r.campaign?.status||'UNKNOWN',adGroupStatus:r.adGroup?.status||'UNKNOWN',approvalStatus:r.adGroupAd?.policySummary?.approvalStatus||'UNKNOWN',reviewStatus:r.adGroupAd?.policySummary?.reviewStatus||'UNKNOWN',policyTopics:r.adGroupAd?.policySummary?.policyTopicEntries||[],primaryStatus:r.adGroupAd?.primaryStatus||'UNKNOWN',primaryStatusReasons:r.adGroupAd?.primaryStatusReasons||[],adStrength:r.adGroupAd?.adStrength||'UNKNOWN',...content,revision:revisionOf(content)}})}
 async function getTerms(range,args={}){return(await d.query(`SELECT ${SEARCH_FIELDS}, ${METRICS} FROM search_term_view WHERE ${dateWhere(range)}${filterScope(args)} ORDER BY metrics.cost_micros DESC LIMIT 10000`)).map(r=>({...scope(r),searchTerm:r.searchTermView?.searchTerm||'',triggeringKeyword:r.segments?.keyword?.info?.text||'',keywordMatchType:r.segments?.keyword?.info?.matchType||'',matchType:r.segments?.searchTermMatchType||'',device:r.segments?.device||'UNKNOWN',...metrics(r)}))}
 async function getAdMetrics(range){return(await d.query(`SELECT ad_group_ad.ad.id, ad_group.id, ${METRICS} FROM ad_group_ad WHERE ${dateWhere(range)}`)).map(r=>({id:String(r.adGroupAd?.ad?.id||''),adGroupId:String(r.adGroup?.id||''),...metrics(r)}))}
 async function getKeywords(){return(await d.query(`SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.status, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED' AND ad_group_criterion.negative = FALSE`)).map(r=>({...scope(r),keyword:r.adGroupCriterion?.keyword?.text||'',matchType:r.adGroupCriterion?.keyword?.matchType||'',status:r.adGroupCriterion?.status||'UNKNOWN',negative:false}))}
 async function getNegatives(){
  const[campaign,group,links,accountLinks,criteria]=await Promise.all([
   d.query(`SELECT campaign.id, campaign.name, campaign_criterion.status, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.status != 'REMOVED'`),
   d.query(`SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.status, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE ad_group_criterion.negative = TRUE AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'`),
   d.query(`SELECT campaign.id, campaign.name, campaign_shared_set.shared_set, campaign_shared_set.status FROM campaign_shared_set WHERE campaign_shared_set.status = 'ENABLED'`),
   d.query(`SELECT customer_negative_criterion.negative_keyword_list.shared_set FROM customer_negative_criterion WHERE customer_negative_criterion.type = 'NEGATIVE_KEYWORD_LIST'`),
   d.query(`SELECT shared_set.resource_name, shared_set.name, shared_set.type, shared_criterion.keyword.text, shared_criterion.keyword.match_type FROM shared_criterion WHERE shared_set.status = 'ENABLED' AND shared_criterion.type = 'KEYWORD'`)
  ])
  const result=[...campaign.map(r=>({...scope(r),scope:'campaign',status:r.campaignCriterion?.status||'',keyword:r.campaignCriterion?.keyword?.text,matchType:r.campaignCriterion?.keyword?.matchType})),...group.map(r=>({...scope(r),scope:'ad_group',status:r.adGroupCriterion?.status||'',keyword:r.adGroupCriterion?.keyword?.text,matchType:r.adGroupCriterion?.keyword?.matchType}))]
  const accountSets=new Set(accountLinks.map(r=>r.customerNegativeCriterion?.negativeKeywordList?.sharedSet).filter(Boolean));const visible=new Set(criteria.map(r=>r.sharedSet?.resourceName))
  for(const r of criteria){const set=r.sharedSet?.resourceName,k=r.sharedCriterion?.keyword;if(!k?.text)continue;const base={keyword:k.text,matchType:k.matchType,status:'ENABLED',listName:r.sharedSet?.name||''};if(accountSets.has(set))result.push({...base,scope:'account'});for(const l of links.filter(l=>l.campaignSharedSet?.sharedSet===set))result.push({...base,...scope(l),scope:'shared'})}
  for(const set of [...accountSets,...links.map(l=>l.campaignSharedSet?.sharedSet)].filter(Boolean))if(!visible.has(set)&&!set.startsWith(`customers/${accountId}/`))throw new Error('A manager-owned negative list could not be read. Review it in Google Ads before bulk changes.')
  return result.filter(n=>n.keyword)
 }
 async function snapshot(args={}){
  const range=rangeFor(args.days),warnings=[];const safe=async(section,fn)=>{try{return await fn()}catch(e){warnings.push({section,message:e.message});return[]}}
  const[ads,ms,searchTerms,keywords,negativeKeywords]=await Promise.all([safe('ad assets',getAds),safe('ad metrics',()=>getAdMetrics(range)),safe('search terms',()=>getTerms(range)),safe('keywords',getKeywords),safe('negatives',getNegatives)])
  if(searchTerms.length>=10000)warnings.push({section:'search terms',message:'The 10,000-row reporting limit was reached. Narrow the date range.'})
  return{ok:true,account:d.account,range,ads:ads.map(a=>({...a,metrics:ms.find(m=>m.id===a.id&&m.adGroupId===a.adGroupId)||aggregateMetrics([])})),searchTerms,keywords,negativeKeywords,warnings,coverageComplete:!warnings.some(w=>['keywords','negatives'].includes(w.section)),fetchedAt:new Date().toISOString()}
 }
 async function keywordLabSnapshot(args={}){
  const range=selectedKeywordRange(args,tz),extra=filterScope(args),warnings=[]
  const inventoryQuery=`SELECT ${KEYWORD_FIELDS} FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD'${extra} AND ad_group_criterion.status != 'REMOVED' AND ad_group_criterion.negative = FALSE LIMIT 10000`
  const metricsQuery=`SELECT ${KEYWORD_FIELDS}, ${METRICS} FROM keyword_view WHERE ${dateWhere(range)}${extra} AND ad_group_criterion.status != 'REMOVED' AND ad_group_criterion.negative = FALSE ORDER BY metrics.cost_micros DESC LIMIT 10000`
  const optionalQuery=`SELECT ${KEYWORD_FIELDS}, ${KEYWORD_OPTIONAL_METRICS} FROM keyword_view WHERE ${dateWhere(range)}${extra} AND ad_group_criterion.status != 'REMOVED' AND ad_group_criterion.negative = FALSE LIMIT 10000`
  const termsQuery=`SELECT ${SEARCH_FIELDS}, ${METRICS} FROM search_term_view WHERE ${dateWhere(range)}${extra} ORDER BY metrics.cost_micros DESC LIMIT 10000`
  const [inventoryResult,metricsResult,optionalResult,termResult]=await Promise.allSettled([d.query(inventoryQuery),d.query(metricsQuery),d.query(optionalQuery),d.query(termsQuery)])
  const inventoryTruncated=inventoryResult.status==='fulfilled'&&inventoryResult.value.length>=10000
  const metricsTruncated=metricsResult.status==='fulfilled'&&metricsResult.value.length>=10000
  const termsTruncated=termResult.status==='fulfilled'&&termResult.value.length>=10000
  const inventoryComplete=inventoryResult.status==='fulfilled'&&!inventoryTruncated
  if(inventoryResult.status==='rejected')warnings.push({section:'keyword inventory',message:inventoryResult.reason?.message||'Keyword inventory is unavailable.'})
  if(inventoryTruncated)warnings.push({section:'keyword inventory',message:'The 10,000-row keyword inventory limit was reached. Narrow the campaign or ad-group scope before live actions.'})
  if(metricsResult.status==='rejected')warnings.push({section:'keyword metrics',message:metricsResult.reason?.message||'Keyword metrics are unavailable.'})
  if(metricsTruncated)warnings.push({section:'keyword metrics',message:'The 10,000-row keyword metrics limit was reached. Narrow the campaign or ad-group scope.'})
  if(optionalResult.status==='rejected')warnings.push({section:'optional keyword metrics',message:optionalResult.reason?.message||'Optional keyword metrics are unavailable.'})
  if(termResult.status==='rejected')warnings.push({section:'search terms',message:termResult.reason?.message||'Search terms are unavailable.'})
  const metricsByIdentity=new Map()
  for(const row of metricsResult.status==='fulfilled'?metricsResult.value:[]){const identity=keywordIdentity(row),key=criterionIdentity(identity);if(!key)continue;if(!metricsByIdentity.has(key))metricsByIdentity.set(key,[]);metricsByIdentity.get(key).push(row)}
  const optionalByIdentity=new Map()
  for(const row of optionalResult.status==='fulfilled'?optionalResult.value:[]){const identity=keywordIdentity(row),key=criterionIdentity(identity);if(key)optionalByIdentity.set(key,optionalKeywordMetrics(row))}
  const searchTerms=(termResult.status==='fulfilled'?termResult.value:[]).map(row=>{
   const resourceName=row.segments?.keyword?.adGroupCriterion||null
   return{...scope(row),searchTerm:row.searchTermView?.searchTerm||'',triggeringKeyword:row.segments?.keyword?.info?.text||'',triggeringKeywordMatchType:row.segments?.keyword?.info?.matchType||'',triggeringKeywordResourceName:resourceName,triggeringCriterionId:criterionIdFromResource(resourceName),matchType:row.segments?.searchTermMatchType||'',device:row.segments?.device||'UNKNOWN',...withPerDayMetrics(reportingMetrics(row),range.days)}
  })
  const termCounts=new Map()
  for(const row of searchTerms){const identity=row.triggeringKeywordResourceName?`resource:${row.triggeringKeywordResourceName}`:row.triggeringCriterionId?`criterion:${row.adGroupId}:${row.triggeringCriterionId}`:null;if(!identity)continue;if(!termCounts.has(identity))termCounts.set(identity,new Set());termCounts.get(identity).add(row.searchTerm)}
  const keywords=(inventoryResult.status==='fulfilled'?inventoryResult.value:[]).map(row=>{
   const identity=keywordIdentity(row),key=criterionIdentity(identity),criterion=row.adGroupCriterion||{}
   const totals=metricsByIdentity.has(key)?aggregateReportingMetrics(metricsByIdentity.get(key)):metricsResult.status==='fulfilled'&&!metricsTruncated?zeroReportingMetrics():aggregateReportingMetrics([])
   return{...identity,keyword:criterion.keyword?.text||'',matchType:criterion.keyword?.matchType||'',status:criterion.status||'UNKNOWN',...totals,...(optionalByIdentity.get(key)||optionalKeywordMetrics()),...withPerDayMetrics(totals,range.days),searchTermCount:termCounts.get(key)?.size||0}
  })
  if(termsTruncated)warnings.push({section:'search terms',message:'The 10,000-row search-term reporting limit was reached. Narrow the date range or campaign scope.'})
  const coverageComplete=inventoryComplete&&metricsResult.status==='fulfilled'&&!metricsTruncated&&termResult.status==='fulfilled'&&!termsTruncated
  return{ok:true,account:d.account,range,keywords,searchTerms,termGroups:groupTermsByKeyword(searchTerms),warnings,inventoryComplete,coverageComplete,liveActionsEnabled:inventoryComplete&&Boolean(d.canWrite),fetchedAt:new Date().toISOString()}
 }
 async function keywordExperiments(args={}){
  const range=selectedKeywordRange(args,tz),raw=await d.db.keywordExperiments(args),warnings=[]
  const experiments=raw.map(normalizeExperiment).filter(row=>(!args.campaignId||row.campaignId===String(args.campaignId))&&(!args.adGroupId||row.adGroupId===String(args.adGroupId)))
  const measurable=experiments.filter(row=>row.criterionResourceName&&row.experimentStartedAt)
  let daily=[],inventoryComplete=true
  if(measurable.length){
   const query=`SELECT ${KEYWORD_FIELDS}, segments.date, ${METRICS} FROM keyword_view WHERE ${dateWhere(range)}${filterScope(args)} AND ad_group_criterion.status != 'REMOVED' AND ad_group_criterion.negative = FALSE`
   try{daily=await d.query(query)}catch(error){inventoryComplete=false;warnings.push({section:'experiment metrics',message:error.message||'Experiment metrics are unavailable.'})}
  }
  const results=experiments.map(experiment=>{
   const started=experimentDate(experiment.experimentStartedAt,tz)
   if(!experiment.criterionResourceName||!started)return{...experiment,effectiveStartDate:null,days:0,...aggregateReportingMetrics([]),...withPerDayMetrics(aggregateReportingMetrics([]),0)}
   const effectiveStartDate=started>range.startDate?started:range.startDate,days=effectiveDays(range,started)
   const identity=criterionIdentity(experiment)
   const rows=daily.filter(row=>criterionIdentity(keywordIdentity(row))===identity&&String(row.segments?.date||'')>=effectiveStartDate&&String(row.segments?.date||'')<=range.endDate)
   const totals=inventoryComplete?(rows.length?aggregateReportingMetrics(rows):zeroReportingMetrics()):aggregateReportingMetrics([])
   return{...experiment,effectiveStartDate,days,...totals,...withPerDayMetrics(totals,days)}
  })
  return{ok:true,account:d.account,range,experiments:results,warnings,inventoryComplete,liveActionsEnabled:inventoryComplete&&Boolean(d.canWrite),fetchedAt:new Date().toISOString()}
 }
 async function keywordCandidates(args={}){
  const seed=plannerContext(args),context={seedType:seed.seedType,normalizedSeed:seed.normalizedSeed,locationIds:seed.locationIds,languageId:seed.languageId,network:seed.network},now=(d.now?.()||new Date()),nowIso=now.toISOString()
  let cached=null,cacheWarning=''
  try{cached=await d.db.findKeywordMarketCache?.(context)}catch(error){cacheWarning=error.message||'Planner cache could not be read.'}
  if(cached&&new Date(cached.expires_at??cached.expiresAt)>now)return{ok:true,planner:{available:true,label:'estimated market demand'},candidates:Array.isArray(cached.results)?cached.results:[],context,cache:{status:'hit',retrievedAt:cached.retrieved_at??cached.retrievedAt,expiresAt:cached.expires_at??cached.expiresAt},...(cacheWarning?{warnings:[cacheWarning]}:{})}
  try{
   const payload=await d.planner({phrases:seed.phrases,url:seed.url,locationIds:seed.locationIds,languageId:seed.languageId,network:seed.network})
   const candidates=(payload?.results||[]).map(row=>normalizePlannerCandidate(row,context)).filter(row=>row.phrase)
   const expiresAt=new Date(now.getTime()+(Number(d.plannerCacheTtlMs)||86400000)).toISOString(),record={account_id:accountId,seed_type:seed.seedType,normalized_seed:seed.normalizedSeed,location_ids:seed.locationIds,language_id:seed.languageId,network:seed.network,results:candidates,retrieved_at:nowIso,expires_at:expiresAt,created_by:d.actor.id}
   try{await d.db.saveKeywordMarketCache?.(record)}catch(error){cacheWarning=error.message||'Planner cache could not be saved.'}
   return{ok:true,planner:{available:true,label:'estimated market demand'},candidates,context,cache:{status:'refreshed',retrievedAt:nowIso,expiresAt},...(cacheWarning?{warnings:[cacheWarning]}:{})}
  }catch(error){return{ok:true,planner:{available:false,code:'PLANNER_UNAVAILABLE',message:error.message||'Keyword Planner is unavailable.'},candidates:Array.isArray(cached?.results)?cached.results:[],context,cache:{status:cached?'stale':'miss',retrievedAt:cached?.retrieved_at??cached?.retrievedAt??null,expiresAt:cached?.expires_at??cached?.expiresAt??null},...(cacheWarning?{warnings:[cacheWarning]}:{})}}
 }
 async function keywordHistory(args={}){return{ok:true,account:d.account,entries:(await d.db.keywordMarketHistory(args)).map(normalizeMarketCache)}}
 async function verifiedRows(kind,ready,after){
  const current=kind==='rsa_update'?await getAds():await getNegatives()
  return ready.map(i=>kind==='rsa_update'?current.some(a=>a.id===i.adId&&a.revision===revisionOf(after)):current.some(n=>n.scope==='campaign'&&String(n.campaignId)===i.campaignId&&n.matchType===i.matchType&&text(n.keyword)===text(i.keyword)))
 }
 async function apply(body={}){
  if(!d.canWrite)throw new Error('Live writes are locked or you are not an authorized approver.')
  if(body.confirmation!=='APPLY')throw new Error('Explicit APPLY authorization is required.')
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId||''))throw new Error('A unique request ID is required.')
  if(!['rsa_update','campaign_negatives'].includes(body.kind))throw new Error('Unsupported workspace change.')
  const fingerprint=digest({kind:body.kind,adId:body.adId,adGroupId:body.adGroupId,expectedRevision:body.expectedRevision,references:body.references,draft:body.draft,items:body.items})
  const prior=await d.db.byRequest(body.requestId)
  if(prior){if(prior.payload_hash!==fingerprint)throw new Error('This request ID belongs to another approval.');return prior.result||{ok:true,eventId:prior.id,results:[{state:'unverified',message:'This approval is already processing. Check history; do not resubmit.'}]}}
  let before={},after={},ready=[],skipped=[],operations=[],path=''
  if(body.kind==='rsa_update'){
   const id=requireId(body.adId,'Ad ID'),groupId=requireId(body.adGroupId,'Ad group ID'),ads=await getAds(),ad=ads.find(a=>a.id===id&&a.adGroupId===groupId)
   if(!ad||ad.type!=='RESPONSIVE_SEARCH_AD')throw new Error('Select an editable responsive search ad.')
   const refs=ads.filter(a=>a.id===id).map(a=>({campaignId:a.campaignId,adGroupId:a.adGroupId}))
   if(body.expectedRevision!==ad.revision||JSON.stringify(normalizedRefs(body.references||[]))!==JSON.stringify(normalizedRefs(refs)))throw new Error('The ad or its ad-group references changed. Refresh and review again.')
   after=normalizeAdDraft(body.draft);if(revisionOf(after)===ad.revision)throw new Error('No changes to publish.')
   const range=rangeFor(body.days),terms=await getTerms(range,{campaignId:ad.campaignId,adGroupId:ad.adGroupId}),ms=await getAdMetrics(range)
   before={ad:adDraft(ad),adId:id,campaignId:ad.campaignId,adGroupId:groupId,references:refs,range,metrics:ms.find(m=>m.id===id&&m.adGroupId===groupId)||aggregateMetrics([]),searchTerms:terms.slice(0,100)}
   const{finalUrls,...rsa}=after;operations=[{update:{resourceName:`customers/${accountId}/ads/${id}`,finalUrls,responsiveSearchAd:rsa},updateMask:'finalUrls,responsiveSearchAd.headlines,responsiveSearchAd.descriptions,responsiveSearchAd.path1,responsiveSearchAd.path2'}];path=`customers/${accountId}/ads:mutate`;ready=[{adId:id,keyword:'Ad copy revision'}]
  }else{
   const negativeKeywords=await getNegatives();({ready,skipped}=prepareNegatives(body.items,negativeKeywords));before={items:body.items};after={items:ready};path=`customers/${accountId}/campaignCriteria:mutate`;operations=ready.map(i=>({create:{campaign:`customers/${accountId}/campaigns/${i.campaignId}`,negative:true,keyword:{text:i.keyword,matchType:i.matchType}}}))
  }
  const entry={id:crypto.randomUUID(),request_key:body.requestId,payload_hash:fingerprint,account_id:accountId,actor_id:d.actor.id,actor_email:d.actor.email,kind:body.kind,status:'prepared',before_snapshot:before,after_snapshot:after,created_at:new Date().toISOString()}
  const reserved=await d.db.reserve(entry)
  if(!reserved.fresh){if(reserved.entry.payload_hash!==fingerprint)throw new Error('Approval ID conflict.');return reserved.entry.result||{ok:true,eventId:reserved.entry.id,results:[{state:'unverified',message:'Approval already processing. Check history.'}]}}
  const result={ok:true,eventId:entry.id,results:[...skipped]};let sent=false
  try{
   if(operations.length){
    const validation=await d.post(path,{operations,validateOnly:true,partialFailure:false})
    // Re-check immediately before the live write without changing any approved field.
    if(body.kind==='rsa_update'){const current=(await getAds()).filter(a=>a.id===body.adId);if(current.some(a=>a.revision!==body.expectedRevision)||JSON.stringify(normalizedRefs(current))!==JSON.stringify(normalizedRefs(body.references)))throw new Error('The ad changed during validation. Refresh before approving another revision.')}
    sent=true;const applied=await d.post(path,{operations,validateOnly:false,partialFailure:body.kind==='campaign_negatives'}),errors=partialErrors(applied.payload)
    let confirmed=[];try{confirmed=await verifiedRows(body.kind,ready,after)}catch{}
    result.results.push(...ready.map((i,index)=>errors.has(index)?{...i,state:'failed',message:errors.get(index)}:{...i,state:confirmed[index]?'verified':'unverified',resourceName:applied.payload?.results?.[index]?.resourceName||'',message:confirmed[index]?'Confirmed by a fresh Google Ads read.':'Outcome needs verification. Do not submit again.'}));result.requestId=applied.requestId||'';result.validationRequestId=validation.requestId||''
   }
  }catch(e){result.results.push(...ready.map(i=>({...i,state:sent&&!e.googlePayload?'unverified':'failed',message:e.message})))}
  result.status=result.results.some(r=>r.state==='unverified')?'unverified':result.results.some(r=>r.state==='failed')?'failed':operations.length?'verified':'skipped';result.appliedAt=new Date().toISOString()
  try{await d.db.update(entry.id,{status:result.status,result,updated_at:result.appliedAt})}catch{result.historyWarning='Final cloud history update failed. Check current Google state; do not resubmit.'}
  return result
 }
 async function verify(args={}){
  const event=await d.db.get(args.eventId);if(!event||event.actor_id!==d.actor.id)throw new Error('Only the original approver may reconcile this approval.')
  if(!['prepared','unverified'].includes(event.status))return event.result
  const ready=event.kind==='rsa_update'?[{adId:event.before_snapshot.adId,keyword:'Ad copy revision'}]:event.after_snapshot.items
  const matches=await verifiedRows(event.kind,ready,event.after_snapshot)
  const result=event.result||{ok:true,eventId:event.id,results:ready.map(r=>({...r,state:'unverified'}))}
  result.results=result.results.map(r=>{if(r.state!=='unverified')return r;const i=ready.findIndex(x=>event.kind==='rsa_update'?x.adId===r.adId:x.campaignId===r.campaignId&&x.keyword===r.keyword&&x.matchType===r.matchType);return i>=0&&matches[i]?{...r,state:'verified',message:'Expected state confirmed by a fresh Google read.'}:r})
  result.status=result.results.some(r=>r.state==='unverified')?'unverified':result.results.some(r=>r.state==='failed')?'failed':'verified'
  await d.db.update(event.id,{status:result.status,result,updated_at:new Date().toISOString()});return result
 }
 async function audience(args={}){
  const range=rangeFor(args.days),extra=filterScope(args),warnings=[];const get=async(section,q)=>{try{return await d.query(q)}catch(e){warnings.push({section,message:e.message});return[]}}
  const[age,gender,geo]=await Promise.all([
   get('Age',`SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.age_range.type, ${METRICS} FROM age_range_view WHERE ${dateWhere(range)}${extra}`),
   get('Gender',`SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.gender.type, ${METRICS} FROM gender_view WHERE ${dateWhere(range)}${extra}`),
   get('Locations',`SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, geographic_view.country_criterion_id, geographic_view.location_type, segments.geo_target_city, segments.geo_target_region, ${METRICS} FROM geographic_view WHERE ${dateWhere(range)}${extra} ORDER BY metrics.cost_micros DESC LIMIT 500`)
  ])
  if(geo.length>=500)warnings.push({section:'Locations',message:'The top 500 location rows are displayed. Narrow the campaign/date filters.'})
  const refs=[...new Set(geo.flatMap(r=>[r.segments?.geoTargetCity,r.segments?.geoTargetRegion,`geoTargetConstants/${r.geographicView?.countryCriterionId||''}`]).filter(s=>/^geoTargetConstants\/\d+$/.test(s)))];let names={}
  if(refs.length){const rows=await get('Location names',`SELECT geo_target_constant.resource_name, geo_target_constant.canonical_name FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${refs.map(s=>`'${s}'`).join(',')})`);names=Object.fromEntries(rows.map(r=>[r.geoTargetConstant.resourceName,r.geoTargetConstant.canonicalName]))}
  return{ok:true,range,warnings,age:age.map(r=>({...scope(r),label:(r.adGroupCriterion?.ageRange?.type||'UNKNOWN').replace('AGE_RANGE_','').replace('_','-'),...metrics(r)})),gender:gender.map(r=>({...scope(r),label:r.adGroupCriterion?.gender?.type||'UNKNOWN',...metrics(r)})),locations:geo.map(r=>({...scope(r),label:names[r.segments?.geoTargetCity]||names[r.segments?.geoTargetRegion]||names[`geoTargetConstants/${r.geographicView?.countryCriterionId}`]||'Unknown / not available',locationType:r.geographicView?.locationType||'UNKNOWN',...metrics(r)}))}
 }
 async function suggest(args={}){
  const id=requireId(args.adId),group=requireId(args.adGroupId),ad=(await getAds()).find(a=>a.id===id&&a.adGroupId===group);if(!ad||ad.type!=='RESPONSIVE_SEARCH_AD')throw new Error('Select an editable responsive search ad.')
  const range=rangeFor(args.days),terms=await getTerms(range,{campaignId:ad.campaignId,adGroupId:group}),proposal=await d.ai({ad,range,searchTerms:terms.slice(0,60)})
  if(!Array.isArray(proposal.headlines)||!Array.isArray(proposal.descriptions))throw new Error('AI did not return a usable draft. No ad was changed.')
  const draft={...adDraft(ad),headlines:proposal.headlines.map((t,i)=>({text:String(t),...(ad.headlines[i]?.pinnedField?{pinnedField:ad.headlines[i].pinnedField}:{})})),descriptions:proposal.descriptions.map((t,i)=>({text:String(t),...(ad.descriptions[i]?.pinnedField?{pinnedField:ad.descriptions[i].pinnedField}:{})}))}
  const evidence=(proposal.evidence||[]).filter(e=>terms.some(t=>text(t.searchTerm)===text(e.term))),warnings=[...(proposal.warnings||[])];if(evidence.length!==(proposal.evidence||[]).length)warnings.push('AI evidence not present in the supplied search-term report was omitted.')
  let validationError='';try{normalizeAdDraft(draft)}catch(e){validationError=e.message}
  return{ok:true,summary:proposal.summary,draft,evidence,warnings,validationError,generatedAt:new Date().toISOString()}
 }
 async function compare(args={}){
  const event=await d.db.get(args.eventId);if(!event||event.kind!=='rsa_update'||event.status!=='verified')throw new Error('Choose a verified ad revision before comparing performance.')
  const before=event.before_snapshot,day=dateInZone(new Date(event.created_at),tz),today=dateInZone(new Date(),tz),days=Math.min(7,Math.floor((new Date(today)-new Date(day))/86400000)-1)
  if(days<1)return{ok:true,ready:false,message:'No complete days after this edit yet. The edit day and today are excluded.'}
  const periods={before:{start:shift(day,-days),end:shift(day,-1)},after:{start:shift(day,1),end:shift(day,days)}},values={}
  for(const[k,range]of Object.entries(periods)){const[ms,terms]=await Promise.all([getAdMetrics(range),getTerms(range,{campaignId:before.campaignId,adGroupId:before.adGroupId})]);values[k]={range,metrics:ms.find(m=>m.id===before.adId&&m.adGroupId===before.adGroupId)||aggregateMetrics([]),terms}}
  const later=(await d.db.history()).some(e=>e.kind==='rsa_update'&&e.status==='verified'&&e.before_snapshot?.adId===before.adId&&e.created_at>event.created_at)
  return{ok:true,ready:true,days,...values,warning:`Observational comparison, not proof of causation. Keywords, bids, budgets, demand and tracking also affect results.${later?' A newer ad edit overlaps this period.':''}`}
 }
 return{snapshot,keywordLabSnapshot,keywordExperiments,keywordCandidates,keywordHistory,apply,verify,audience,suggest,compare,history:()=>d.db.history(),getAds,getNegatives}
}
