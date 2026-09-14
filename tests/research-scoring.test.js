import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateEvidenceStrength,calculateEqualParentingRelevance,
  calculateImpactScore,calculateHistoricalImportance
} from '../lib/research/scoring.js'

test('finding direction never changes evidence scoring',()=>{
  const base={design:'longitudinal',sample_size:5000,pre_separation_controls:true,conflict_controls:true,ses_controls:true,measurement_quality:'good'}
  const a=calculateEvidenceStrength({...base,finding_direction:'favors_shared'})
  const b=calculateEvidenceStrength({...base,finding_direction:'disfavors_shared'})
  assert.deepEqual(a,b)
})

test('unknown evidence components are omitted, not scored zero',()=>{
  const r=calculateEvidenceStrength({design:'cross_sectional_adjusted'})
  assert.ok(r.score>0)
  assert.ok(r.completeness<100)
  assert.equal(r.components.design.points,20)
})

test('exact 50/50 is more relevant than broad JPC with unknown threshold',()=>{
  assert.ok(
    calculateEqualParentingRelevance({exact_or_near_50_50:true,direct_child_outcome:true}).score >
    calculateEqualParentingRelevance({parenting_time_definition:'JPC',direct_child_outcome:true}).score
  )
})

test('impact ignores missing components and reports completeness',()=>{
  const r=calculateImpactScore({citation_percentile:90,citations_per_year_percentile:80})
  assert.ok(r.score>=0&&r.score<=100)
  assert.ok(r.completeness<100)
  assert.equal(r.components.fwci_percentile,null)
})

test('impact is null when no importance inputs are known',()=>{
  assert.deepEqual(calculateImpactScore({}),{score:null,completeness:0,components:{citation_percentile:null,citations_per_year_percentile:null,fwci_percentile:null,influential_citation_percentile:null,review_inclusion_percentile:null,policy_influence:null}})
})

test('historical manual signals require explanation',()=>{
  assert.throws(()=>calculateHistoricalImportance({anchor_designation:true}),/explanation/i)
  assert.ok(calculateHistoricalImportance({anchor_designation:true,anchor_explanation:'Explicit anchor source selected for the field map.'}).score>0)
})
