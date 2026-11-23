// ECF5 Filing Assembly MDE / NotifyFilingReviewComplete metadata reader.
// Based on Tyler EFM Documentation v2026.2.2 ECF5: FilingAssemblyMDE.wsdl,
// reviewfilingcallback.xsd and the supplied sample messages. This is NOT a
// SOAP signature verifier or a webhook receiver; never pass untrusted data
// from this parser directly to a database write or an HTTP 2xx acknowledgment.
import { DOMParser } from '@xmldom/xmldom'

export const TYLER_NFRC_SOAP_ACTION =
  'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0WSDL/FilingAssemblyMDE/NotifyFilingReviewComplete'

const NS = Object.freeze({
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  wrappers: 'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/wrappers',
  callback: 'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/reviewfilingcallback',
  nc: 'http://release.niem.gov/niem/niem-core/4.0/',
  ecf: 'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf',
  tyler: 'urn:tyler:ecf:v5.0:extensions:common',
})

function children(node, ns, name) {
  return Array.from(node?.childNodes || []).filter(
    (child) => child.nodeType === 1 && child.namespaceURI === ns && child.localName === name,
  )
}
function child(node, ns, name) {
  return children(node, ns, name)[0] || null
}
function scalar(node) { return String(node?.textContent || '').trim() }
function descendant(node, ns, name) {
  return node?.getElementsByTagNameNS(ns, name)?.[0] || null
}

function identified(node, category) {
  const values = children(node, NS.nc, 'DocumentIdentification')
    .filter((entry) => scalar(child(entry, NS.nc, 'IdentificationCategoryDescriptionText')).toLowerCase() === category.toLowerCase())
    .map((entry) => scalar(child(entry, NS.nc, 'IdentificationID')))
    .filter(Boolean)
  if (values.length !== 1) throw new Error('ECF5 callback requires exactly one ' + category + ' identification.')
  return values[0]
}

export function parseTylerNfrcMetadata(xml) {
  if (typeof xml !== 'string' || !xml.trim() || Buffer.byteLength(xml, 'utf8') > 8 * 1024 * 1024) {
    throw new Error('Invalid ECF5 XML message size.')
  }
  // Prevent DTD/entity handling and make the intended XML-only contract explicit.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD/entity declarations are not accepted.')
  const doc = new DOMParser({
    errorHandler: {
      warning() {},
      error(message) { throw new Error('Invalid ECF5 XML: ' + message) },
      fatalError(message) { throw new Error('Invalid ECF5 XML: ' + message) },
    },
  }).parseFromString(xml, 'application/xml')
  const root = doc?.documentElement
  if (!root || root.localName === 'parsererror') throw new Error('Invalid ECF5 XML.')
  let wrapper
  if (root.namespaceURI === NS.soap && root.localName === 'Envelope') {
    const body = child(root, NS.soap, 'Body')
    if (!body || children(root, NS.soap, 'Body').length !== 1) throw new Error('Missing SOAP 1.1 Body.')
    const elements = Array.from(body.childNodes).filter((n) => n.nodeType === 1)
    if (elements.length !== 1) throw new Error('Expected one SOAP operation in Body.')
    wrapper = elements[0]
  } else {
    // Tyler's published sample artifacts contain operation wrappers without a
    // SOAP envelope. This form is for contract fixture testing only.
    wrapper = root
  }
  if (wrapper.namespaceURI !== NS.wrappers || wrapper.localName !== 'NotifyFilingReviewCompleteRequest') {
    throw new Error('Unexpected ECF5 Filing Assembly operation.')
  }
  const message = child(wrapper, NS.callback, 'NotifyFilingReviewCompleteMessage')
  if (!message || children(wrapper, NS.callback, 'NotifyFilingReviewCompleteMessage').length !== 1) {
    throw new Error('Missing NotifyFilingReviewCompleteMessage.')
  }
  const lead = child(message, NS.ecf, 'LeadDocumentReview')
  const reviewed = child(lead, NS.ecf, 'ReviewedDocument')
  if (!reviewed) throw new Error('Missing reviewed filing.')
  const completed = scalar(child(child(message, NS.ecf, 'FilingCompletionDate'), NS.nc, 'DateTime'))
  const status = child(message, NS.ecf, 'FilingStatus')
  if (!status) throw new Error('Missing ECF5 FilingStatus.')
  const augmentation = child(status, NS.tyler, 'FilingStatusAugmentation')
  return {
    operation: 'NotifyFilingReviewComplete',
    messageId: identified(message, 'messageID'),
    envelopeId: identified(message, 'envelopeID'),
    filingId: identified(reviewed, 'filingID'),
    completionDate: completed || null,
    reviewerComments: scalar(child(augmentation, NS.tyler, 'ReviewCommentsText')) || null,
    // The supplied Tyler sample does not contain an explicit accepted/rejected
    // status code. Do not derive one from completion date or reviewer comments.
    normalizedStatus: null,
    requiresSignatureVerification: true,
    requiresOriginalSubmissionMatch: true,
  }
}
