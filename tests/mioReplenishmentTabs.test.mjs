import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {classifyReplenishmentMatter,overrideAllowed,calculateReplenishmentCents} from '../src/mioReplenishmentTabs.js';
const matter={id:'m1',client_id:'c1',is_active:true,case_status:'Open',matter_type:'Divorce'};
test('low-trust eligible appears in default selected tab',()=>{
 assert.equal(classifyReplenishmentMatter({balance:400,minimum:2000,eligibility:{eligible:true}}).tab,'eligible');
});
test('low-trust secondary matter remains visible with exclusion reason',()=>{
 const result=classifyReplenishmentMatter({balance:200,minimum:2000,eligibility:{eligible:false,reason:'Secondary matter'}});
 assert.deepEqual(result,{tab:'excluded',reason:'Secondary matter'});
 assert.equal(overrideAllowed({matter,eligibility:{eligible:false,reason:'Secondary matter'}}),true);
});
test('at and above minimum are grouped independently',()=>{
 assert.equal(classifyReplenishmentMatter({balance:2000,minimum:2000,eligibility:{eligible:false,reason:'Secondary matter'}}).tab,'above');
 assert.equal(classifyReplenishmentMatter({balance:3100,minimum:2000,eligibility:{eligible:true}}).tab,'above');
});
test('appointment and closure never permit one-off override',()=>{
 assert.equal(overrideAllowed({matter:{...matter,appointed:true}}),false);
 assert.equal(overrideAllowed({matter:{...matter,is_active:false}}),false);
 assert.equal(overrideAllowed({matter,weeklyOverride:{appointed:true}}),false);
});
test('manual amount fills only remaining target, respecting previous unpaid trust invoices',()=>{
 assert.equal(calculateReplenishmentCents(2500,5000,1000),150000);
 assert.equal(calculateReplenishmentCents(5500,5000,0),0);
 assert.equal(calculateReplenishmentCents(800,3000,2200),0);
 assert.equal(calculateReplenishmentCents(null,5000,0),null);
});
test('unverified financial data never gets a review category',()=>{
 assert.equal(classifyReplenishmentMatter({balance:0,minimum:2000,eligibility:{eligible:true},financialVerified:false}).tab,null);
});
