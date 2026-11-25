// ECF5 FilingReviewMDE ReviewFiling SOAP 1.1 envelope assembler.
// Verified against Tyler v2026.2.2 Artifacts/Schema/wrappers.xsd,
// wsi/schema/FilingReviewMDE.wsdl and tyler-reviewfiling.xml sample.
// This assembles previously produced FilingMessage / PaymentMessage XML
// documents. It is NOT a serializer for court party/case/document content,
// NOT an XML Schema validator and NOT a WS-Security signer. Never transmit
// its unsigned result to Tyler or treat it as Stage certified.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

export const TYLER_REVIEW_FILING_ACTION =
  'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0WSDL/FilingReviewMDE/ReviewFiling'
const NS = Object.freeze({
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  wrapper: 'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/wrappers',
  filing: 'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/filing',
  payment: 'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/payment',
  j: 'http://release.niem.gov/niem/domains/jxdm/6.1/',
  nc: 'http://release.niem.gov/niem/niem-core/4.0/',
  ecf: 'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf',
  tyler: 'urn:tyler:ecf:v5.0:extensions:common',
})
const children = (el, ns, localName) => Array.from(el?.childNodes || [])
  .filter(n => n.nodeType === 1 && n.namespaceURI === ns && n.localName === localName)
const one = (el, ns, name) => children(el, ns, name)[0] || null
const text = n => String(n?.textContent || '').trim()

function readFragment(xml, ns, localName, label) {
  if (typeof xml !== 'string' || !xml.trim() ||
    Buffer.byteLength(xml, 'utf8') > 20 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid ' + label + ' XML.')
  const doc = new DOMParser({
    onError(level, message) {
      if (level !== 'warning') throw new Error('Malformed ' + label + ': ' + message)
    },
  }).parseFromString(xml, 'application/xml')
  const root = doc.documentElement
  if (!root || root.namespaceURI !== ns || root.localName !== localName ||
    doc.doctype) throw new Error('Unexpected ' + label + ' root element.')
  if (Array.from(doc.childNodes).filter(n => n.nodeType === 1).length !== 1)
    throw new Error('Multiple ' + label + ' root elements.')
  return root
}

function verifyFilingMessage(root, expected) {
  const court = text(one(one(one(root, NS.j, 'CaseCourt'),
    NS.nc, 'OrganizationIdentification'), NS.nc, 'IdentificationID'))
  if (!court || court !== expected.courtLocationId)
    throw new Error('FilingMessage court does not match selected Mio court.')
  const messageIds = children(root, NS.nc, 'DocumentIdentification')
    .filter(el => text(one(el, NS.nc, 'IdentificationCategoryDescriptionText')).toLowerCase() === 'messageid')
    .map(el => text(one(el, NS.nc, 'IdentificationID')))
  if (messageIds.length !== 1 || messageIds[0] !== expected.messageId)
    throw new Error('FilingMessage message ID does not match outbound request ID.')
  const lead = children(root, NS.filing, 'FilingLeadDocument')
  if (!lead.length || lead.length > 100)
    throw new Error('FilingMessage must have 1-100 lead filings.')
  if (expected.filingCodes && (
    expected.filingCodes.length !== lead.length ||
    lead.some((el, i) => text(one(one(el, NS.ecf, 'DocumentAugmentation'),
      NS.ecf, 'RegisterActionDescriptionCode')) !== expected.filingCodes[i])
  )) throw new Error('Filing code(s) do not match the reviewed filing.')
  const suppliedIds = Array.from(root.getElementsByTagNameNS(NS.tyler, 'ServiceContactID'))
    .map(el => text(one(el, NS.nc, 'IdentificationID'))).filter(Boolean)
  const expectedIds = expected.serviceContactIds || []
  if (suppliedIds.length !== expectedIds.length ||
    [...suppliedIds].sort().join('|') !== [...expectedIds].sort().join('|'))
    throw new Error('Tyler service recipients differ from reviewed Mio recipients.')
  if (new Set(suppliedIds).size !== suppliedIds.length)
    throw new Error('Duplicate service contact identifiers in FilingMessage.')
  if (expected.mode === 'efile_only') {
    // No Tyler service recipients should exist in an e-file-only submission.
    if (suppliedIds.length) throw new Error('Unexpected recipients for E-File Only.')
  } else if (expectedIds.length === 0) {
    throw new Error('Service mode requires verified Tyler service contact IDs.')
  }
  // Connected documents, case party relationships, payment means and filing
  // attachment bytes must be schema validated upstream before transmission.
  return lead.length
}

export function buildUnsignedTylerReviewFilingSoap({
  filingMessages, paymentMessage, expected,
}) {
  if (!expected || typeof expected !== 'object' ||
    typeof expected.courtLocationId !== 'string' || !expected.courtLocationId ||
    typeof expected.messageId !== 'string' || !expected.messageId ||
    !Array.isArray(expected.filingCodes) || !expected.filingCodes.length ||
    !Array.isArray(expected.serviceContactIds) ||
    !['efile_only','efile_and_serve','eserve_only'].includes(expected.mode))
    throw new Error('Complete immutable reviewed filing metadata is required.')
  if (!Array.isArray(filingMessages) || filingMessages.length < 1 ||
      filingMessages.length > 100)
    throw new Error('ReviewFiling requires one or more FilingMessage elements.')
  if (typeof paymentMessage !== 'string' || !paymentMessage.trim())
    throw new Error('PaymentMessage must be supplied by the approved payment mapper.')
  const fragments = filingMessages.map(xml => readFragment(xml, NS.filing, 'FilingMessage', 'FilingMessage'))
  const leadCount = fragments.reduce((total, f) => total + verifyFilingMessage(f, expected), 0)
  if (leadCount !== expected.filingCodes.length)
    throw new Error('Incorrect count of reviewed lead filings.')
  // Full payment details depend on the real EFM payment account / TOGA mapping.
  const payment = readFragment(paymentMessage, NS.payment, 'PaymentMessage', 'PaymentMessage')
  const serialized = new XMLSerializer()
  const body = [...fragments.map(f => serialized.serializeToString(f)),
    serialized.serializeToString(payment)].join('')
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap:Envelope xmlns:soap="' + NS.soap + '">' +
    '<soap:Body><wrapper:ReviewFilingRequest xmlns:wrapper="' + NS.wrapper + '">' +
    body + '</wrapper:ReviewFilingRequest></soap:Body></soap:Envelope>'
  // Absence of SOAP Header is intentional: the WS-Security signer must add it.
  return Object.freeze({
    xml,
    soapAction: TYLER_REVIEW_FILING_ACTION,
    contentType: 'text/xml; charset=utf-8',
    leadFilingCount: leadCount,
    signed: false,
    transportReady: false,
    requires: Object.freeze(['ECF5 full XSD validation','XMLDSIG/WS-Security signing',
      'trusted Tyler Stage endpoint','authorized payment configuration']),
  })
}
