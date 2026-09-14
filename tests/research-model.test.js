import test from 'node:test'
import assert from 'node:assert/strict'
import {slugifyResearchTitle,normalizePublicationDraft,validatePublicationForPublish,matchesResearchFilters,sortResearchRows} from '../lib/research/model.js'

test('slug generation is stable and URL safe',()=>{
  assert.equal(slugifyResearchTitle('Bergström 2015 — Fifty moves a year'),'bergstrom-2015-fifty-moves-a-year')
})

test('zero is not substituted for an unknown score',()=>{
  const row=normalizePublicationDraft({title:'Test',source_type:'original_empirical',impact_score:''})
  assert.equal(row.impact_score,null)
})

test('direction does not alter scores',()=>{
  const base={title:'Test',source_type:'original_empirical',impact_score:88,evidence_strength_score:76}
  const a=normalizePublicationDraft({...base,finding_direction:'favors_shared'})
  const b=normalizePublicationDraft({...base,finding_direction:'disfavors_shared'})
  assert.equal(a.impact_score,b.impact_score)
  assert.equal(a.evidence_strength_score,b.evidence_strength_score)
})

test('publish validation requires public source and causal strength for empirical analyses',()=>{
  const publication=normalizePublicationDraft({title:'Test',authors_text:'A',publication_year:2026,source_type:'original_empirical',finding_direction:'mixed'})
  const errors=validatePublicationForPublish(publication,{studies:[{causal_claim_strength:'not_applicable'}],accessLinks:[]})
  assert.ok(errors.some(x=>x.toLowerCase().includes('access')))
  assert.ok(errors.some(x=>x.toLowerCase().includes('causal')))
})

test('50/50 filter never infers equality from a JPC label',()=>{
  assert.equal(matchesResearchFilters({title:'X',studies:[{parenting_time_definition:'JPC',exact_or_near_50_50:null}]},{exact50:true}),false)
  assert.equal(matchesResearchFilters({title:'X',studies:[{exact_or_near_50_50:true}]},{exact50:true}),true)
})

test('sorting handles null impact after real scores',()=>{
  const rows=sortResearchRows([{id:'a',impact_score:null},{id:'b',impact_score:50}],{key:'impact_score',direction:'desc'})
  assert.deepEqual(rows.map(x=>x.id),['b','a'])
})
