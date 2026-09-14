import test from 'node:test'
import assert from 'node:assert/strict'
import {slugifyResearchTitle,normalizePublicationDraft,validatePublicationForPublish,matchesResearchFilters,sortResearchRows,classifyExact50,preferredResearchLink,calculateCitationsPerYear,researchCompletion} from '../lib/research/model.js'

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
  assert.ok(errors.some(x=>x.toLowerCase().includes('causal')||x.toLowerCase().includes('analysis')))
})

test('50/50 filter never infers equality from a JPC label',()=>{
  assert.equal(matchesResearchFilters({title:'X',studies:[{parenting_time_definition:'JPC',exact_or_near_50_50:null}]},{exact50:true}),false)
  assert.equal(matchesResearchFilters({title:'X',studies:[{exact_or_near_50_50:true}]},{exact50:true}),true)
})

test('sorting handles null impact after real scores',()=>{
  const rows=sortResearchRows([{id:'a',impact_score:null},{id:'b',impact_score:50}],{key:'impact_score',direction:'desc'})
  assert.deepEqual(rows.map(x=>x.id),['b','a'])
})

test('50/50 is unknown when no analyses exist',()=>assert.equal(classifyExact50([]),'unknown'))
test('50/50 is unknown when analyses exist but classification is uncoded',()=>assert.equal(classifyExact50([{exact_or_near_50_50:null}]),'unknown'))
test('50/50 is no only when coded analyses exist and all are false',()=>assert.equal(classifyExact50([{exact_or_near_50_50:false}]),'no'))
test('50/50 is yes when any coded analysis is true',()=>assert.equal(classifyExact50([{exact_or_near_50_50:false},{exact_or_near_50_50:true}]),'yes'))
test('unverified analysis does not create a definitive 50/50 classification',()=>assert.equal(classifyExact50([{extraction_status:'unverified',exact_or_near_50_50:true}]),'unknown'))

test('source priority prefers lawful hosted copy then OA then canonical DOI',()=>{
  const links=[{link_type:'canonical_doi',url:'https://doi.org/x',is_public:true},{link_type:'open_access_pdf',url:'https://example.org/x.pdf',is_public:true},{link_type:'mio_public_copy',url:'https://site/x.pdf',is_public:true,redistribution_permitted:true}]
  assert.equal(preferredResearchLink(links).link_type,'mio_public_copy')
})
test('source priority never exposes an unlicensed Mio-hosted copy',()=>{
  const links=[{link_type:'mio_public_copy',url:'https://site/private.pdf',is_public:true,redistribution_permitted:false},{link_type:'canonical_doi',url:'https://doi.org/x',is_public:true}]
  assert.equal(preferredResearchLink(links).link_type,'canonical_doi')
})
test('citations per year uses denominator one for current-year works',()=>{
  assert.equal(calculateCitationsPerYear(12,2026,2026),12);assert.equal(calculateCitationsPerYear(null,2020,2026),null)
})

test('empty substantive record is needs enrichment',()=>{
  const r=researchCompletion({title:'X',doi:'10/x',source_type:'original_empirical'},{studies:[],accessLinks:[],metrics:[]})
  assert.equal(r.status,'needs_enrichment')
  assert.ok(r.percent<50)
})

test('direct empirical record cannot publish without substantive analysis and conclusions',()=>{
  const p={title:'X',authors_text:'A',publication_year:2020,source_type:'original_empirical',overall_findings_summary:'Finding',limitations_summary:'Limit',what_it_supports:'Supports',what_it_does_not_establish:'Does not',finding_direction:'mixed',evidence_strength_score:70,equal_parenting_relevance_score:75,historical_field_importance_score:50,citation_verification:'unavailable'}
  const errors=validatePublicationForPublish(p,{studies:[],accessLinks:[{url:'https://doi.org/x',is_public:true}],metrics:[]})
  assert.ok(errors.some(x=>/analysis/i.test(x)))
})

test('reviewed empirical record with required substance can pass publication gate without external impact data when explicitly unavailable',()=>{
  const p={title:'X',authors_text:'A',publication_year:2020,source_type:'original_empirical',overall_findings_summary:'Finding',limitations_summary:'Limit',what_it_supports:'Supports',what_it_does_not_establish:'Does not',finding_direction:'mixed',evidence_strength_score:70,equal_parenting_relevance_score:75,historical_field_importance_score:50,citation_verification:'unavailable'}
  const bundle={studies:[{extraction_status:'needs_review',parenting_time_definition:'30/70 shared residence',sample_size:500,child_age_text:'10-15',study_design:'cross-sectional adjusted comparison',controls_summary:'SES and conflict',causal_claim_strength:'low',exact_or_near_50_50:false}],accessLinks:[{url:'https://doi.org/x',is_public:true}],metrics:[]}
  assert.deepEqual(validatePublicationForPublish(p,bundle),[])
})
