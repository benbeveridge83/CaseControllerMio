import test from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from '@xmldom/xmldom'
import {buildUnsignedTylerReviewFilingSoap,TYLER_REVIEW_FILING_ACTION} from '../lib/efiling/tylerReviewFilingEnvelope.js'

const ns = {
  filing:'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/filing',
  ecf:'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf',
  nc:'http://release.niem.gov/niem/niem-core/4.0/',
  tyler:'urn:tyler:ecf:v5.0:extensions:common',
  j:'http://release.niem.gov/niem/domains/jxdm/6.1/',
  payment:'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/payment',
  wrappers:'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/wrappers',
  soap:'http://schemas.xmlsoap.org/soap/envelope/',
}
const filing = (court='harris:dc',code='670',service='') => `<filing:FilingMessage
  xmlns:filing="${ns.filing}" xmlns:ecf="${ns.ecf}" xmlns:nc="${ns.nc}"
  xmlns:tyler="${ns.tyler}" xmlns:j="${ns.j}">
  <nc:DocumentIdentification><nc:IdentificationID>msg-1</nc:IdentificationID>
  <nc:IdentificationCategoryDescriptionText>messageID</nc:IdentificationCategoryDescriptionText></nc:DocumentIdentification>
  <j:CaseCourt><nc:OrganizationIdentification><nc:IdentificationID>${court}</nc:IdentificationID>
  </nc:OrganizationIdentification></j:CaseCourt>
  ${service ? `<ecf:ElectronicServiceInformation><tyler:ElectronicServiceAugmentation>
    <tyler:ServiceRecipient><tyler:ServiceContactID>
    <nc:IdentificationID>${service}</nc:IdentificationID></tyler:ServiceContactID>
    </tyler:ServiceRecipient></tyler:ElectronicServiceAugmentation></ecf:ElectronicServiceInformation>` : ''}
  <filing:FilingLeadDocument><ecf:DocumentAugmentation>
  <ecf:RegisterActionDescriptionCode>${code}</ecf:RegisterActionDescriptionCode>
  </ecf:DocumentAugmentation></filing:FilingLeadDocument>
  </filing:FilingMessage>`
const payment=`<payment:PaymentMessage xmlns:payment="${ns.payment}"><payment:Address/></payment:PaymentMessage>`
const expected={courtLocationId:'harris:dc',messageId:'msg-1',filingCodes:['670'],serviceContactIds:[],mode:'efile_only'}
const build=(override={})=>buildUnsignedTylerReviewFilingSoap({filingMessages:[filing()],paymentMessage:payment,expected,...override})

test('builds correct ECF5 document/literal SOAP 1.1 ReviewFiling request',()=>{
  const result=build()
  assert.equal(result.soapAction,TYLER_REVIEW_FILING_ACTION)
  assert.equal(result.signed,false)
  assert.equal(result.transportReady,false)
  assert.equal(result.leadFilingCount,1)
  const root=new DOMParser().parseFromString(result.xml,'application/xml')
  assert.equal(root.documentElement.localName,'Envelope')
  assert.equal(root.documentElement.namespaceURI,ns.soap)
  assert.equal(root.getElementsByTagNameNS(ns.wrappers,'ReviewFilingRequest').length,1)
  assert.equal(root.getElementsByTagNameNS(ns.filing,'FilingMessage').length,1)
  assert.equal(root.getElementsByTagNameNS(ns.payment,'PaymentMessage').length,1)
  assert.equal(root.getElementsByTagNameNS(ns.soap,'Header').length,0)
})
test('blocks wrong court, message ID, and filing code',()=>{
 assert.throws(()=>build({filingMessages:[filing('dallas:dc')]}),/court/)
 assert.throws(()=>build({expected:{...expected,messageId:'another'}}),/message ID/)
 assert.throws(()=>build({expected:{...expected,filingCodes:['999']}}),/Filing code/)
})
test('e-service requires the same Tyler service-contact IDs as reviewed',()=>{
 const serviceXml=filing('harris:dc','670','SVC-42')
 assert.throws(()=>build({filingMessages:[serviceXml]}),/service recipients/)
 const result=build({filingMessages:[serviceXml],expected:{...expected,serviceContactIds:['SVC-42'],mode:'efile_and_serve'}})
 assert.equal(result.transportReady,false)
})
test('rejects XML DTDs, wrong message roots, and unsupported multiple messages',()=>{
 assert.throws(()=>build({filingMessages:['<!DOCTYPE x><x/>']}),/Invalid FilingMessage/)
 assert.throws(()=>build({filingMessages:['<FilingMessage/>']}),/root element/)
 assert.throws(()=>build({filingMessages:[filing(),filing()]}),/Exactly one/)
 assert.throws(()=>build({paymentMessage:'<PaymentMessage/>'}),/PaymentMessage root/)
 assert.throws(()=>build({paymentMessage:''}),/PaymentMessage must be supplied/)
})
