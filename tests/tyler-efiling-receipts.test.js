import test from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from '@xmldom/xmldom'
import { buildTylerNfrcSoapAcknowledgment } from '../lib/efiling/tylerNfrcResponse.js'
import { processVerifiedTylerNotification } from '../lib/efiling/tylerNfrcProcessor.js'
const id=(value,kind)=>`<n:DocumentIdentification><n:IdentificationID>${value}</n:IdentificationID><n:IdentificationCategoryDescriptionText>${kind}</n:IdentificationCategoryDescriptionText></n:DocumentIdentification>`
const xml=`<w:NotifyFilingReviewCompleteRequest xmlns:w="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/wrappers" xmlns:r="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/reviewfilingcallback" xmlns:e="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf" xmlns:n="http://release.niem.gov/niem/niem-core/4.0/" xmlns:t="urn:tyler:ecf:v5.0:extensions:common"><r:NotifyFilingReviewCompleteMessage>${id('M-1','messageID')}${id('E-1','envelopeID')}<e:FilingStatus/><e:LeadDocumentReview><e:ReviewedDocument>${id('F-1','filingID')}</e:ReviewedDocument></e:LeadDocumentReview></r:NotifyFilingReviewCompleteMessage></w:NotifyFilingReviewCompleteRequest>`
const verified={signatureVerified:true,trustedIssuer:true,timestampVerified:true,replayChecked:true}
test('produces a schema-shaped SOAP 1.1 success acknowledgment with escaped ID',()=>{
 const soap=buildTylerNfrcSoapAcknowledgment({messageId:'a<&b',timestamp:'2026-11-22T20:00:00Z'})
 const doc=new DOMParser().parseFromString(soap,'application/xml')
 assert.equal(doc.documentElement.localName,'Envelope')
 assert.equal(doc.getElementsByTagNameNS('http://release.niem.gov/niem/domains/cbrn/4.1/','MessageStatusCode')[0].textContent,'Success')
 assert.equal(doc.getElementsByTagNameNS('http://release.niem.gov/niem/niem-core/4.0/','IdentificationID')[0].textContent,'a<&b')
})
test('refuses to acknowledge unverified notifications',async()=>{
 let writes=0
 await assert.rejects(()=>processVerifiedTylerNotification({rawXml:xml,environment:'stage',security:{signatureVerified:false},resolveStatus:async()=> 'accepted',recordReceipt:async()=>{writes++}}),/security verification/)
 assert.equal(writes,0)
})
test('persists before an acknowledgment is returned',async()=>{
 let saved=false
 const r=await processVerifiedTylerNotification({rawXml:xml,environment:'stage',security:verified,resolveStatus:async()=> 'unknown',recordReceipt:async(meta)=>{saved=true;assert.equal(meta.filingId,'F-1');return{submission_id:'known-submission',duplicate:false}}})
 assert.equal(saved,true)
 assert.match(r.acknowledgment,/NotifyFilingReviewCompleteResponse/)
 assert.match(r.result.submission_id,/known/)
})
test('does not acknowledge a database failure',async()=>{
 await assert.rejects(()=>processVerifiedTylerNotification({rawXml:xml,environment:'stage',security:verified,resolveStatus:async()=> 'unknown',recordReceipt:async()=>{throw Error('database unavailable')}}),/database unavailable/)
})
test('does not guess a filing decision',async()=>{
 let writes=0
 await assert.rejects(()=>processVerifiedTylerNotification({rawXml:xml,environment:'stage',security:verified,resolveStatus:async()=>null,recordReceipt:async()=>{writes++}}),/recognized state/)
 assert.equal(writes,0)
})
