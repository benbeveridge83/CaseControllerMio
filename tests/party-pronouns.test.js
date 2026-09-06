import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizePronounSet,partyPronounSet,resolveLinkedPronoun,suggestGrammar,suggestPriorParty,preparePronounBinding} from '../src/mioPartyPronouns.js'

test('sex normalization never confuses female with male and respects explicit pronoun preference',()=>{
  assert.equal(normalizePronounSet('female'),'female')
  assert.equal(normalizePronounSet('male'),'male')
  assert.equal(normalizePronounSet('she/her'),'female')
  assert.equal(partyPronounSet({sex:'Female'}),'female')
  assert.equal(partyPronounSet({sex:'Female',pronoun_set:'they/them'}),'neutral')
})

test('linked pronoun resolves from the selected party, not the client globally',()=>{
  const data={_pronoun_parties:[
    {id:'client',source:'client',role:'Petitioner',name:'Client A',sex:'female'},
    {id:'other',source:'opposing',role:'Respondent',name:'Party B',sex:'male'}
  ]}
  assert.equal(resolveLinkedPronoun({kind:'pronoun',linked_party:'petitioner',grammar_role:'subject',source_text:'She'},data).value,'She')
  assert.equal(resolveLinkedPronoun({kind:'pronoun',linked_party:'respondent',grammar_role:'object',source_text:'him'},data).value,'him')
  assert.match(resolveLinkedPronoun({kind:'pronoun',linked_party:'respondent',grammar_role:'subject',source_text:'he'},{_pronoun_parties:[{source:'opposing',role:'Respondent',name:'Party B'}]}).error,/Record sex or a pronoun preference/)
})

test('her and his are marked grammatically ambiguous and default by following noun',()=>{
  assert.deepEqual(suggestGrammar('her',' address'),{role:'possessive_adjective',ambiguous:true})
  assert.deepEqual(suggestGrammar('her','.'),{role:'object',ambiguous:true})
  assert.deepEqual(suggestGrammar('his',' car'),{role:'possessive_adjective',ambiguous:true})
  assert.deepEqual(suggestGrammar('his','.'),{role:'possessive_pronoun',ambiguous:true})
})

test('new pronoun defaults to the last preceding party identifier but remains a suggestion',()=>{
  const template={bindings:[
    {id:'client-name',kind:'field',data_source:'matter.client_name',source_text:'ALICE',paragraph_start:1,paragraph_end:1,start_offset:0,end_offset:5,is_active:true},
    {id:'respondent-name',kind:'field',data_source:'matter.respondent_name',source_text:'BOB',paragraph_start:3,paragraph_end:3,start_offset:0,end_offset:3,is_active:true}
  ]}
  const file={id:'f'},document={paragraphs:[{index:1,text:'ALICE'},{index:2,text:'text'},{index:3,text:'BOB'},{index:4,text:'He shall appear.'}]}
  const raw={kind:'pronoun',source_text:'He',paragraph_start:4,paragraph_end:4,start_offset:0,end_offset:2}
  const guess=suggestPriorParty(raw,template,file,document)
  assert.equal(guess.party,'respondent')
  const prepared=preparePronounBinding(raw,template,file,document)
  assert.equal(prepared.linked_party,'respondent')
  assert.equal(prepared.party_link_mode,'suggested')
  assert.equal(prepared.grammar_role,'subject')
})
