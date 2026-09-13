import test from 'node:test'
import assert from 'node:assert/strict'
import {fetchOpenAlexWork} from '../lib/research/enrichment/openalex.js'

const payload={
  id:'https://openalex.org/W123',doi:'https://doi.org/10.1000/test',title:'Test',publication_year:2015,
  cited_by_count:321,fwci:4.2,
  primary_location:{landing_page_url:'https://publisher.example/test',pdf_url:null,is_oa:false},
  open_access:{is_oa:false,oa_status:'closed'},
  authorships:[{author:{display_name:'Jane Doe'}}]
}

test('OpenAlex DOI lookup normalizes bibliometrics and access metadata',async()=>{
  const calls=[]
  const fetchFn=async url=>{calls.push(url);return{ok:true,status:200,json:async()=>payload}}
  const r=await fetchOpenAlexWork(fetchFn,{doi:'10.1000/test',title:'Test',publication_year:2015,authors_text:'Jane Doe'})
  assert.equal(r.provider,'OpenAlex')
  assert.equal(r.citation_count,321)
  assert.equal(r.fwci,4.2)
  assert.equal(r.openalex_id,'W123')
  assert.equal(r.canonical_url,'https://publisher.example/test')
  assert.equal(r.oa_status,'closed')
  assert.match(calls[0],/api\.openalex\.org\/works\/https%3A%2F%2Fdoi\.org%2F10\.1000%2Ftest/)
})

test('OpenAlex title search rejects an ambiguous low-confidence candidate',async()=>{
  const fetchFn=async()=>({ok:true,status:200,json:async()=>({results:[{...payload,doi:null,title:'Different Study',publication_year:2020,authorships:[{author:{display_name:'Other Author'}}]}]})})
  const r=await fetchOpenAlexWork(fetchFn,{title:'Fifty moves a year',publication_year:2015,authors_text:'Malin Bergström'})
  assert.equal(r,null)
})
