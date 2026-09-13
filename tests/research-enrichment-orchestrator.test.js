import test from 'node:test'
import assert from 'node:assert/strict'
import {enrichPublication} from '../lib/research/enrichment/orchestrator.js'

function memoryClient(){
 const tables={
  research_publications:[{id:'p1',inventory_work_id:'W1',publication_year:2015,citation_count_current:null,major_review_count:0}],
  research_metrics:[],research_access_links:[],
  research_review_memberships:[
   {included_publication_id:'p1',review_publication_id:'r1',membership_status:'included'},
   {included_publication_id:'p1',review_publication_id:'r1',membership_status:'included'},
   {included_publication_id:'p1',review_publication_id:'r2',membership_status:'included'}
  ]
 }
 const from=table=>{const state={filters:[],payload:null,action:'select',columns:'*'};const q={
  select(cols='*'){state.columns=cols;return q},eq(k,v){state.filters.push([k,v]);return q},
  insert(payload){state.action='insert';state.payload=Array.isArray(payload)?payload:[payload];return q},
  upsert(payload){state.action='upsert';state.payload=Array.isArray(payload)?payload:[payload];return q},
  update(payload){state.action='update';state.payload=payload;return q},single(){state.single=true;return execute()},
  then(resolve,reject){return execute().then(resolve,reject)}
 };async function execute(){let rows=tables[table]||[];for(const [k,v] of state.filters)rows=rows.filter(r=>String(r[k]??'')===String(v));if(state.action==='insert'){tables[table].push(...state.payload);rows=state.payload}else if(state.action==='upsert'){for(const row of state.payload){const existing=tables[table].find(x=>x.publication_id===row.publication_id&&x.link_type===row.link_type&&x.url===row.url);if(existing)Object.assign(existing,row);else tables[table].push(row)}rows=state.payload}else if(state.action==='update'){for(const row of rows)Object.assign(row,state.payload)}return{data:state.single?(rows[0]||null):rows,error:null}}return q};return{from,tables}}

const openAlexPayload={id:'https://openalex.org/W123',doi:'https://doi.org/10.1000/test',title:'Test Study',publication_year:2015,cited_by_count:0,fwci:2.5,primary_location:{landing_page_url:'https://publisher.test/study',pdf_url:'https://oa.test/study.pdf',is_oa:true},open_access:{is_oa:true,oa_status:'gold'},authorships:[{author:{display_name:'Jane Doe'}}]}

test('one provider failure does not abort successful OpenAlex enrichment and zero remains real',async()=>{
 const client=memoryClient();const fetchFn=async url=>url.includes('openalex')?{ok:true,status:200,json:async()=>openAlexPayload}:{ok:false,status:429,json:async()=>({})}
 const publication={id:'p1',inventory_work_id:'W1',doi:'10.1000/test',title:'Test Study',publication_year:2015,authors_text:'Jane Doe'}
 const r=await enrichPublication({client,publication,fetchFn,currentYear:2026,semanticScholarApiKey:'x'})
 assert.equal(r.status,'partial')
 assert.equal(client.tables.research_publications[0].citation_count_current,0)
 assert.equal(client.tables.research_publications[0].major_review_count,2)
 assert.ok(client.tables.research_metrics.some(x=>x.metric_type==='citation_count'&&x.metric_value===0))
 assert.ok(client.tables.research_access_links.some(x=>x.link_type==='open_access_pdf'))
})

test('unmatched candidate returns needs_review and writes no metrics',async()=>{
 const client=memoryClient();const fetchFn=async()=>({ok:true,status:200,json:async()=>({results:[{...openAlexPayload,doi:null,title:'Other',publication_year:2020,authorships:[{author:{display_name:'Other'}}]}]})})
 const r=await enrichPublication({client,publication:{id:'p1',title:'Unmatched',publication_year:2015,authors_text:'Jane Doe'},fetchFn,currentYear:2026})
 assert.equal(r.status,'needs_review')
 assert.equal(client.tables.research_metrics.length,0)
})
