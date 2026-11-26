import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {DOMParser} from '@xmldom/xmldom'
import {planTylerSubsequentCivilFiling} from '../lib/efiling/tylerSubsequentCivilMapper.js'
import {buildUnsignedTylerSubsequentCivilFilingMessage} from '../lib/efiling/tylerSubsequentCivilMessage.js'
import {buildUnsignedTylerPaymentMessage} from '../lib/efiling/tylerPaymentMessage.js'
import {buildUnsignedTylerReviewFilingSoap} from '../lib/efiling/tylerReviewFilingEnvelope.js'

const nc='http://release.niem.gov/niem/niem-core/4.0/'
const ecf='https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf'
const filing='https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/filing'
const j='http://release.niem.gov/niem/domains/jxdm/6.1/'
const tyler='urn:tyler:ecf:v5.0:extensions:common'
const structures='http://release.niem.gov/niem/structures/4.0/'
const bytes=Buffer.from('%PDF-1.7\nsynthetic staging only\n%%EOF')
const sha=createHash('sha256').update(bytes).digest('hex')
const document={fileName:'Motion & Notice.pdf',pageCount:1,byteLength:bytes.length,
 sha256:sha,documentTypeCode:'677',filingComponentCode:'332',sourceObjectId:'doc-lead',description:'Motion & Notice'}
const attachment={...document,fileName:'Exhibit A.pdf',sourceObjectId:'doc-exhibit'}
const input={environment:'stage',mode:'efile_only',isNewCase:false,messageId:'msg-1',
 courtLocationId:'harris:dc',caseCategoryCode:'7',caseTypeCode:'545',caseTrackingId:'CASE-123',
 sendingMdeLocationId:'https://efsp.example.test/assembly',filingCodeId:'670',
 filingPartyParticipantId:'PARTY-123',filingAttorneyParticipantId:'AT-456',
 leadDocument:document,attachments:[attachment],paymentAccountId:'PAY-123',maxFeeAmountCents:15000}
const plan=()=>planTylerSubsequentCivilFiling(input)
const prepared = p=>buildUnsignedTylerSubsequentCivilFilingMessage({
 plan:p,bytesBySourceId:{'doc-lead':bytes,'doc-exhibit':bytes},
 submittedAt:'2026-11-26T15:00:00.000Z',
})
function elements(xml,ns,name) {
 const doc=new DOMParser().parseFromString(xml,'application/xml')
 return Array.from(doc.getElementsByTagNameNS(ns,name))
}
test('existing case FilingMessage has Tyler sample case and attorney/party reference graph',()=>{
 const p=plan(), r=prepared(p)
 assert.equal(r.signed,false)
 assert.equal(r.schemaValidated,false)
 assert.equal(r.transportReady,false)
 assert.equal(elements(r.xml,filing,'FilingMessage').length,1)
 assert.equal(elements(r.xml,j,'CaseAugmentation').length,1)
 assert.equal(elements(r.xml,ecf,'CaseAugmentation').length,1)
 assert.equal(elements(r.xml,ecf,'CaseTrackingID')[0].textContent,'CASE-123')
 assert.equal(elements(r.xml,ecf,'CaseNewIndicator')[0].textContent,'false')
 assert.equal(elements(r.xml,tyler,'FilingAction')[0].textContent,'EFile')
 assert.equal(elements(r.xml,tyler,'PartyReference').length,2)
 assert.equal(elements(r.xml,tyler,'AttorneyReference')[0].getAttributeNS(structures,'ref'),'Attorney1')
 assert.equal(elements(r.xml,nc,'RoleOfPerson')[0].getAttributeNS(structures,'id'),'Attorney1')
 assert.equal(elements(r.xml,nc,'EntityPerson')[0].getAttributeNS(structures,'id'),'Party1')
 assert.equal(elements(r.xml,ecf,'RegisterActionDescriptionCode')[0].textContent,'670')
 assert.equal(elements(r.xml,nc,'DocumentPostDate').length,1)
})
test('connected document links to lead and every attachment is digest verified',()=>{
 const r=prepared(plan())
 assert.equal(r.connectedDocumentCount,1)
 assert.equal(elements(r.xml,filing,'FilingConnectedDocument').length,1)
 assert.equal(elements(r.xml,filing,'FilingLeadDocument')[0].getAttributeNS(structures,'id'),'Filing1')
 assert.equal(elements(r.xml,nc,'PrimaryDocument')[0].getAttributeNS(structures,'ref'),'Filing1')
 assert.equal(elements(r.xml,nc,'Base64BinaryObject').length,2)
 assert.equal(elements(r.xml,nc,'Base64BinaryObject')[0].textContent,bytes.toString('base64'))
 assert.equal(elements(r.xml,tyler,'OriginalFileName')[0].textContent,'Exhibit A.pdf')
 assert.equal(elements(r.xml,tyler,'OriginalFileName')[1].textContent,'Motion & Notice.pdf')
})
test('rejects missing source bytes, mismatched digests, and duplicate source references',()=>{
 const p=plan()
 assert.throws(()=>buildUnsignedTylerSubsequentCivilFilingMessage({
  plan:p,bytesBySourceId:{'doc-lead':bytes},submittedAt:'2026-11-26T15:00:00.000Z',
 }),/Missing authorized PDF bytes/)
 const altered=Buffer.from('%PDF-1.7\naltered bytes')
 assert.throws(()=>buildUnsignedTylerSubsequentCivilFilingMessage({
  plan:p,bytesBySourceId:{'doc-lead':altered,'doc-exhibit':bytes},
  submittedAt:'2026-11-26T15:00:00.000Z',
 }),/PDF size differs|PDF digest differs/)
 const duplicate={...p,attachments:[{...p.lead}],transportReady:false}
 assert.throws(()=>prepared(duplicate),/Duplicate source document IDs/)
})
test('electronic service preserves verified contact IDs and party references',()=>{
 const p=planTylerSubsequentCivilFiling({...input,mode:'efile_and_serve',
 serviceContacts:[{selected:true,tylerServiceContactId:'svc-123',serviceTypeCode:'-580',representedPartyRef:'Party1'}]})
 const r=prepared(p)
 assert.equal(elements(r.xml,tyler,'ServiceContactID').length,1)
 assert.equal(elements(r.xml,tyler,'ServiceTypeCode')[0].textContent,'-580')
 assert.equal(elements(r.xml,ecf,'CaseRepresentedParty').length,2)
 assert.throws(()=>prepared({...p,serviceContacts:[{...p.serviceContacts[0],representedPartyRef:'OtherParty'}]}),/Unsupported represented party/)
})
test('Tyler PaymentMessage permits only same account and verified quote below fee cap',()=>{
 const p=plan()
 const quote={source:'tyler_stage',verifiedByServer:true,paymentAccountId:'PAY-123',quoteId:'QUOTE-1',feeAmountCents:7599}
 const r=buildUnsignedTylerPaymentMessage({plan:p,feeQuote:quote})
 assert.equal(r.transportReady,false)
 assert.match(r.xml,/<cbc:PaymentID>PAY-123<\/cbc:PaymentID>/)
 assert.match(r.xml,/<cbc:Amount currencyID="USD">75\.99<\/cbc:Amount>/)
 assert.throws(()=>buildUnsignedTylerPaymentMessage({plan:p,feeQuote:{...quote,verifiedByServer:false}}),/server-verified/)
 assert.throws(()=>buildUnsignedTylerPaymentMessage({plan:p,feeQuote:{...quote,feeAmountCents:20000}}),/authorized maximum/)
 assert.throws(()=>buildUnsignedTylerPaymentMessage({plan:p,feeQuote:{...quote,paymentAccountId:'OTHER'}}),/selected payment account/)
})
test('assembled filing + payment pass existing ReviewFiling SOAP identity checks, never live-send',()=>{
 const p=plan()
 const f=prepared(p)
 const pay=buildUnsignedTylerPaymentMessage({plan:p,feeQuote:{
  source:'tyler_stage',verifiedByServer:true,paymentAccountId:'PAY-123',quoteId:'quote',feeAmountCents:200,
 }})
 const soap=buildUnsignedTylerReviewFilingSoap({
  filingMessages:[f.xml],paymentMessage:pay.xml,
  expected:{courtLocationId:p.courtLocationId,messageId:p.messageId,
   filingCodes:[p.filingCodeId],serviceContactIds:[],mode:p.mode},
 })
 assert.equal(soap.signed,false)
 assert.equal(soap.transportReady,false)
 assert.equal(elements(soap.xml,filing,'FilingMessage').length,1)
})
