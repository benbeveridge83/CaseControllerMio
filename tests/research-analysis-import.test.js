import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeAnalysisDocument,analysisInventoryKey,proposedScores} from '../lib/research/analysisImport.js'

const doc={
 inventory_work_id:'WTEST',
 sources:[{url:'https://doi.org/10.1000/test',kind:'doi',verified:true}],
 publication:{doi:'10.1000/test',overall_findings_summary:'Summary',limitations_summary:'Limit',what_it_supports:'Supports',what_it_does_not_establish:'Does not establish'},
 studies:[
  {study_label:'Sample A',sample_size:100,parenting_time_definition:'50/50',exact_or_near_50_50:true,study_design:'cross-sectional adjusted comparison',controls_summary:'SES',causal_claim_strength:'low',extraction_status:'needs_review',source_url:'https://doi.org/10.1000/test'},
  {study_label:'Sample B',sample_size:200,parenting_time_definition:'30/70',exact_or_near_50_50:false,study_design:'longitudinal',controls_summary:'baseline',causal_claim_strength:'moderate',extraction_status:'needs_review',source_url:'https://doi.org/10.1000/test'}
 ]
}

test('analysis normalization requires Work ID and source-backed substantive rows',()=>{
 const out=normalizeAnalysisDocument(doc)
 assert.equal(out.inventory_work_id,'WTEST')
 assert.equal(out.publication.doi,'10.1000/test')
 assert.equal(out.studies.length,2)
 assert.equal(out.studies[0].extraction_source_url,'https://doi.org/10.1000/test')
 assert.match(out.studies[0].inventory_key,/^analysis::WTEST::/)
})

test('two distinct analyses retain stable distinct import keys across reruns',()=>{
 const first=normalizeAnalysisDocument(doc),second=normalizeAnalysisDocument(structuredClone(doc))
 assert.equal(new Set(first.studies.map(x=>x.inventory_key)).size,2)
 assert.deepEqual(first.studies.map(x=>x.inventory_key),second.studies.map(x=>x.inventory_key))
})

test('analysis import rejects substantive row without a source URL',()=>{
 const bad=structuredClone(doc);delete bad.studies[0].source_url
 assert.throws(()=>normalizeAnalysisDocument(bad),/source URL/i)
})

test('analysis import never permits published status in curated JSON',()=>{
 const bad={...structuredClone(doc),publication:{...doc.publication,editorial_status:'published'}}
 assert.throws(()=>normalizeAnalysisDocument(bad),/editorial status/i)
})

test('analysis inventory key is deterministic and safe',()=>{
 assert.equal(analysisInventoryKey('W0025','Main Swedish school-age sample'),'analysis::W0025::main-swedish-school-age-sample')
})

test('review relevance can use a source-backed review-level shared-time definition',()=>{
 const r=proposedScores({source_type:'systematic_review',topics:['mental_health']},[],{relevance:{shared_time_min_percent:30,parenting_time_definition:'shared physical custody 30-70%'}})
 assert.ok(r.equal_parenting_relevance_score>=70)
})
