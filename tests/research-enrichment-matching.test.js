import test from 'node:test'
import assert from 'node:assert/strict'
import {matchConfidence,normalizeDoi} from '../lib/research/enrichment/matching.js'

test('matching accepts exact DOI regardless of title punctuation',()=>{
  const r=matchConfidence({doi:'10.1234/ABC'},{doi:'https://doi.org/10.1234/abc',title:'Different punctuation'})
  assert.equal(r.accepted,true)
  assert.equal(r.score,100)
  assert.equal(normalizeDoi('https://doi.org/10.1234/ABC'),'10.1234/abc')
})

test('title fallback requires year and author support',()=>{
  assert.equal(matchConfidence(
    {title:'Fifty moves a year',publication_year:2015,authors_text:'Malin Bergström'},
    {title:'Fifty moves a year',publication_year:2015,authors:['Malin Bergström']}
  ).accepted,true)
  assert.equal(matchConfidence(
    {title:'Fifty moves a year',publication_year:2015,authors_text:'Malin Bergström'},
    {title:'Fifty moves a year',publication_year:2021,authors:['Other']}
  ).accepted,false)
})

test('near title match is not enough without corroborating metadata',()=>{
  const r=matchConfidence(
    {title:'Shared Physical Custody Summary of 40 Studies on Outcomes for Children',publication_year:2014,authors_text:'Linda Nielsen'},
    {title:'Shared Physical Custody: Summary of Forty Studies on Outcomes for Children',publication_year:2022,authors:['Other Author']}
  )
  assert.equal(r.accepted,false)
})
