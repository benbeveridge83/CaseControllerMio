// ECF5 Stage-only preparatory mapping for EXISTING civil cases.
// Field names and parent-child paths follow Tyler EFM v2026.2.2:
// Artifacts/Sample Messages/filingreviewmde/reviewfiling/
// tyler-subsequent-civil-filingmessage.xml and tyler-paymentmessage.xml.
// This module returns validated metadata, not signable/filable XML. Its output
// still requires complete NIEM case-entity mapping, XSD validation, signed
// document bytes, real Tyler fee/account information and Stage verification.
import { createHash } from 'node:crypto'

const id = (value, name, max = 256) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new Error(name + ' must be a nonempty, bounded EFM identifier.')
  return value.trim()
}
const optional = v => typeof v === 'string' ? v.trim() : ''
const numeric = (value, name) => {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 0 || n > 10_000_000) throw new Error(name + ' must be a nonnegative integer.')
  return n
}
function file(document, name) {
  if (!document || typeof document !== 'object') throw new Error(name + ' is required.')
  const fileName = id(document.fileName, name + ' fileName')
  if (!/\.pdf$/i.test(fileName)) throw new Error(name + ' must be a PDF for this mapper.')
  const pageCount = numeric(document.pageCount, name + ' pageCount')
  if (!pageCount) throw new Error(name + ' needs a nonzero page count.')
  const byteLength = numeric(document.byteLength, name + ' byteLength')
  if (!byteLength) throw new Error(name + ' needs a nonzero byteLength.')
  const sha256 = id(document.sha256, name + ' SHA-256', 64).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(name + ' needs a verified SHA-256 digest.')
  const documentTypeCode = id(document.documentTypeCode, name + ' document type')
  const filingComponentCode = id(document.filingComponentCode, name + ' filing component')
  return Object.freeze({
    fileName, pageCount, byteLength, sha256, documentTypeCode,
    filingComponentCode, description: id(document.description || fileName, name + ' description', 500),
    redacted: document.redacted === true,
    // No raw document bytes stored in the planning record.
    sourceObjectId: id(document.sourceObjectId, name + ' source object'),
  })
}
function normalizeContacts(contacts, mode) {
  if (mode === 'efile_only') {
    if (Array.isArray(contacts) && contacts.some(c => c?.selected !== false))
      throw new Error('E-File Only cannot include selected e-service recipients.')
    return []
  }
  if (!['efile_and_serve', 'eserve_only'].includes(mode))
    throw new Error('Unsupported filing mode.')
  if (!Array.isArray(contacts)) throw new Error('Service recipients must be a list.')
  const selected = contacts.filter(c => c && c.selected !== false).map(c => ({
    contactId:id(c.tylerServiceContactId, 'Tyler ServiceContactID'),
    serviceTypeCode:id(c.serviceTypeCode, 'Tyler ServiceTypeCode'),
    representedPartyRef:id(c.representedPartyRef, 'Represented party reference'),
  }))
  if (!selected.length) throw new Error('Service mode requires selected Tyler service contacts.')
  if (new Set(selected.map(c => c.contactId)).size !== selected.length)
    throw new Error('Duplicate Tyler service recipient.')
  return selected
}
export function planTylerSubsequentCivilFiling(input = {}) {
  if (input.environment !== 'stage') throw new Error('This mapper supports Tyler Stage only.')
  const mode = id(input.mode, 'Mode')
  if (!['efile_only','efile_and_serve','eserve_only'].includes(mode))
    throw new Error('Unsupported filing mode.')
  if (input.isNewCase !== false) throw new Error('This mapper is only for an existing civil case.')
  const messageId = id(input.messageId, 'Message ID')
  const courtLocationId = id(input.courtLocationId, 'Court location')
  const caseCategoryCode = id(input.caseCategoryCode, 'Case category code')
  const caseTypeCode = id(input.caseTypeCode, 'Case type code')
  const caseTrackingId = id(input.caseTrackingId, 'Tyler CaseTrackingID')
  const sendingMdeLocationId = id(input.sendingMdeLocationId, 'EFSP SendingMDELocationID', 1024)
  const filingCodeId = id(input.filingCodeId, 'Tyler filing code')
  const filingPartyParticipantId = id(input.filingPartyParticipantId, 'Tyler party participant ID')
  const filingAttorneyParticipantId = id(input.filingAttorneyParticipantId, 'Tyler attorney participant ID')
  const filerPartyRef = 'Party1', attorneyRef = 'Attorney1', leadRef = 'Filing1'
  const lead = file(input.leadDocument, 'Lead document')
  const attachments = (input.attachments || []).map((attachment,i) =>
    Object.freeze({...file(attachment,'Attachment '+(i+1)),parentRef:leadRef}))
  if (attachments.length > 50) throw new Error('Too many attachments; separate or review with Tyler.')
  const serviceContacts = normalizeContacts(input.serviceContacts || [],mode)
  const paymentAccountId = id(input.paymentAccountId, 'Tyler PaymentID')
  const maxFeeAmountCents = numeric(input.maxFeeAmountCents, 'Maximum filing fee cents')
  if (!maxFeeAmountCents) throw new Error('Maximum filing fee authorization is required.')
  const canonical = {
    mode,messageId,courtLocationId,caseCategoryCode,caseTypeCode,caseTrackingId,
    sendingMdeLocationId,filingCodeId,filingPartyParticipantId,
    filingAttorneyParticipantId,filerPartyRef,attorneyRef,leadRef,
    filingAction: mode === 'efile_and_serve' ? 'EFileAndServe' :
      mode === 'eserve_only' ? 'Serve' : 'EFile',
    lead,attachments,serviceContacts,paymentAccountId,maxFeeAmountCents,
    causeNumber:optional(input.causeNumber),
  }
  return Object.freeze({
    ...canonical,
    fingerprint:createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
    // Explicit gate: construction is a mapping plan, not vendor-approved XML.
    signed:false, schemaValidated:false, transportReady:false,
    outstanding:Object.freeze([
      'Render filing message with schema-validated NIEM party/case structure',
      'Fetch PDF bytes from the authorized matter document, verify digest and Base64 attachment',
      'Map Tyler PaymentMeans / TOGA fee calculation and confirm account',
      'Run ECF5 XSD and Tyler Stage ReviewFiling tests',
      'Sign SOAP with approved WS-Security X.509 identity',
    ]),
  })
}
