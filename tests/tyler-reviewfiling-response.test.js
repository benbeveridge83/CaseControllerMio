import test from 'node:test'
import assert from 'node:assert/strict'
import {parseTylerReviewFilingResponse} from '../lib/efiling/tylerReviewFilingResponse.js'
const namespaces='xmlns:w="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/wrappers" xmlns:c="http://release.niem.gov/niem/domains/cbrn/4.1/" xmlns:e="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf" xmlns:n="http://release.niem.gov/niem/niem-core/4.0/"'
const id=(k,v)=>`<n:DocumentIdentification><n:IdentificationID>${v}</n:IdentificationID><n:IdentificationCategoryDescriptionText>${k}</n:IdentificationCategoryDescriptionText></n:DocumentIdentification>`
const success=`<w:ReviewFilingResponse ${namespaces}><c:MessageStatus><c:MessageStatusCode>Success</c:MessageStatusCode><e:MessageStatusAugmentation>${id('envelopeID','env-1')}${id('filingID','f-1')}${id('filingID','f-2')}${id('caseID','c-3')}</e:MessageStatusAugmentation></c:MessageStatus></w:ReviewFilingResponse>`
test('Tyler ECF5 ReviewFiling response returns all filing IDs not only lead',()=>{
 const r=parseTylerReviewFilingResponse(success)
 assert.equal(r.envelopeId,'env-1')
 assert.deepEqual(r.filingIds,['f-1','f-2'])
 assert.equal(r.caseId,'c-3')
 assert.equal(r.cryptographicallyVerified,false)
})
test('rejects vendor failure and duplicate IDs',()=>{
 assert.throws(()=>parseTylerReviewFilingResponse(success.replace('Success','Error')),/did not report/)
 assert.throws(()=>parseTylerReviewFilingResponse(success.replace("filingID','f-2","filingID','f-1")),/valid filing/)
})
test('rejects untrusted namespaces and DTD declarations',()=>{
 assert.throws(()=>parseTylerReviewFilingResponse('<ReviewFilingResponse/>'),/Unexpected/)
 assert.throws(()=>parseTylerReviewFilingResponse('<!DOCTYPE x><x/>'),/Invalid/)
})
