import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {sectionAReplenishmentEligibility} from '../src/mioReplenishmentHandoff.js';
const one={id:'a',client_id:'client',case_status:'Open',is_active:true,matter_type:'Divorce'};
test('court-appointed matters excluded by Section A',()=>{
 assert.equal(sectionAReplenishmentEligibility(one,[one],{a:{appointed:true,included:true}},{}).eligible,false);
 assert.equal(sectionAReplenishmentEligibility({...one,matter_type:'DFPS'},[{...one,matter_type:'DFPS'}],{},{}).eligible,false);
});
test('weekly billing opt-out and replenishment opt-out are respected',()=>{
 assert.equal(sectionAReplenishmentEligibility(one,[one],{a:{included:false}},{}).eligible,false);
 assert.equal(sectionAReplenishmentEligibility(one,[one],{}, {a:{replenishment_enabled:false}}).eligible,false);
});
test('two open matters require exactly one explicitly selected primary',()=>{
 const b={...one,id:'b'};
 assert.equal(sectionAReplenishmentEligibility(one,[one,b],{},{}).eligible,false);
 const prefs={a:{primary_replenishment_matter:true},b:{primary_replenishment_matter:false}};
 assert.equal(sectionAReplenishmentEligibility(one,[one,b],{},prefs).eligible,true);
 assert.equal(sectionAReplenishmentEligibility(b,[one,b],{},prefs).eligible,false);
 assert.equal(sectionAReplenishmentEligibility(one,[one,b],{}, {a:{primary_replenishment_matter:true},b:{primary_replenishment_matter:true}}).eligible,false);
});
test('closed related matters do not require primary selection',()=>{
 const closed={...one,id:'b',case_status:'Closed',is_active:false};
 assert.equal(sectionAReplenishmentEligibility(one,[one,closed],{},{}).eligible,true);
});
