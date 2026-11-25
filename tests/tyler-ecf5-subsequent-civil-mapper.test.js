import test from 'node:test'
import assert from 'node:assert/strict'
import {planTylerSubsequentCivilFiling} from '../lib/efiling/tylerSubsequentCivilMapper.js'
const doc = {fileName:'motion.pdf',pageCount:4,byteLength:2564,
 sha256:'a'.repeat(64),documentTypeCode:'677',filingComponentCode:'332',
 sourceObjectId:'matter-doc-10',description:'Motion to Enter'}
const sample = {
 environment:'stage',mode:'efile_only',isNewCase:false,messageId:'message-123',
 sendingMdeLocationId:'https://example.test/efsp',courtLocationId:'harris:dc',
 caseTrackingId:'31C33A70-C72F-41EE-AC90-6345E84C25FA',
 caseCategoryCode:'7',caseTypeCode:'545',filingCodeId:'670',
 filingPartyParticipantId:'11C33A70-C72F-41EE-AC90-6345E84C25FA',
 filingAttorneyParticipantId:'51C33A70-C72F-41EE-AC90-6345E84C25FA',
 leadDocument:doc,attachments:[],paymentAccountId:'E74ADB9F-F3FD-4A18-AD2B-662001AE97FA',
 maxFeeAmountCents:10000,
}
test('maps Tyler source sample identifiers and lead attachment metadata',()=>{
 const p=planTylerSubsequentCivilFiling(sample)
 assert.equal(p.courtLocationId,'harris:dc')
 assert.equal(p.caseTrackingId,sample.caseTrackingId)
 assert.equal(p.lead.documentTypeCode,'677')
 assert.equal(p.lead.filingComponentCode,'332')
 assert.equal(p.filingAction,'EFile')
 assert.equal(p.transportReady,false)
 assert.equal(p.signed,false)
 assert.equal(p.schemaValidated,false)
 assert.equal(p.fingerprint,planTylerSubsequentCivilFiling(sample).fingerprint)
 assert.equal(Object.hasOwn(p,'fileBytes'),false)
})
test('never guesses Tyler IDs from cause number, emails, or internal doc IDs',()=>{
 for(const key of ['caseTrackingId','filingAttorneyParticipantId','filingPartyParticipantId','filingCodeId','paymentAccountId','courtLocationId']){
  assert.throws(()=>planTylerSubsequentCivilFiling({...sample,[key]:''}),/identifier|required|nonempty|code|court|Tyler|CaseTrackingID|participant|PaymentID/i)
 }
})
test('rejects production, initial case and malformed document metadata',()=>{
 assert.throws(()=>planTylerSubsequentCivilFiling({...sample,environment:'production'}),/Stage only/)
 assert.throws(()=>planTylerSubsequentCivilFiling({...sample,isNewCase:true}),/existing/)
 assert.throws(()=>planTylerSubsequentCivilFiling({...sample,leadDocument:{...doc,fileName:'motion.docx'}}),/PDF/)
 assert.throws(()=>planTylerSubsequentCivilFiling({...sample,leadDocument:{...doc,sha256:'abc'}}),/SHA-256/)
})
test('maps connected attachments to lead document parent reference',()=>{
 const p=planTylerSubsequentCivilFiling({...sample,attachments:[{...doc,fileName:'exhibit.pdf',sourceObjectId:'doc-exhibit'}]})
 assert.equal(p.attachments[0].parentRef,'Filing1')
 assert.equal(p.attachments[0].sourceObjectId,'doc-exhibit')
})
test('electronic service needs EFM recipient identifiers and party references',()=>{
 const serviceContacts=[{selected:true,tylerServiceContactId:'SC-1',serviceTypeCode:'-580',representedPartyRef:'Party1'}]
 const p=planTylerSubsequentCivilFiling({...sample,mode:'efile_and_serve',serviceContacts})
 assert.equal(p.filingAction,'EFileAndServe')
 assert.equal(p.serviceContacts[0].contactId,'SC-1')
 assert.throws(()=>planTylerSubsequentCivilFiling({...sample,mode:'efile_and_serve',serviceContacts:[{selected:true,email:'oc@example.test'}]}),/ServiceContactID/)
 assert.throws(()=>planTylerSubsequentCivilFiling({...sample,serviceContacts}),/E-File Only/)
})
test('does not authorize payment without an explicit max-fee limit',()=>{
 assert.throws(()=>planTylerSubsequentCivilFiling({...sample,maxFeeAmountCents:0}),/Maximum filing fee/)
 assert.throws(()=>planTylerSubsequentCivilFiling({...sample,maxFeeAmountCents:-1}),/nonnegative/)
})
