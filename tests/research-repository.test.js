import test from 'node:test'
import assert from 'node:assert/strict'
import {listResearchPublications,saveResearchPublication,replaceResearchStudies,setResearchEditorialStatus} from '../lib/research/repository.js'

function fakeClient(result={data:[],error:null}){
  const calls=[]
  const client={from(table){const call={table,ops:[]};calls.push(call);const q={select(cols){call.ops.push(['select',cols]);return q},order(k,o){call.ops.push(['order',k,o]);return Promise.resolve(result)},upsert(payload,opts){call.ops.push(['upsert',payload,opts]);return q},update(payload){call.ops.push(['update',payload]);return q},delete(){call.ops.push(['delete']);return q},insert(payload){call.ops.push(['insert',payload]);return q},eq(k,v){call.ops.push(['eq',k,v]);return q},single(){call.ops.push(['single']);return Promise.resolve(result)}};return q}}
  return {client,calls}
}

test('list reads publications and orders newest first',async()=>{
  const {client,calls}=fakeClient({data:[],error:null});await listResearchPublications(client)
  assert.equal(calls[0].table,'research_publications')
  assert.ok(calls[0].ops.some(x=>x[0]==='order'&&x[1]==='publication_year'&&x[2].ascending===false))
})

test('save strips nested UI fields before upsert',async()=>{
  const {client,calls}=fakeClient({data:{id:'p1'},error:null})
  await saveResearchPublication(client,{title:'T',studies:[{id:'s'}],accessLinks:[{url:'u'}],metrics:[{}],reviewMemberships:[{}]})
  const payload=calls[0].ops.find(x=>x[0]==='upsert')[1]
  assert.equal('studies' in payload,false);assert.equal('accessLinks' in payload,false);assert.equal('metrics' in payload,false)
})

test('replace children always binds the requested publication id',async()=>{
  const {client,calls}=fakeClient({data:[],error:null})
  await replaceResearchStudies(client,'safe',[{study_label:'One',publication_id:'evil'}])
  const insert=calls.find(x=>x.table==='research_studies'&&x.ops.some(o=>o[0]==='insert'))
  assert.equal(insert.ops.find(x=>x[0]==='insert')[1][0].publication_id,'safe')
})

test('publishing sets published_at and actor',async()=>{
  const {client,calls}=fakeClient({data:{id:'p1'},error:null})
  await setResearchEditorialStatus(client,'p1','published','actor')
  const patch=calls[0].ops.find(x=>x[0]==='update')[1]
  assert.equal(patch.editorial_status,'published');assert.equal(patch.updated_by,'actor');assert.ok(patch.published_at)
})
