// ECF5 subsequent-civil FilingMessage serializer (unsigned, Stage-only).
// Source: Tyler EFM Documentation v2026.2.2, tyler-subsequent-civil-filingmessage.xml.
// Does not validate against the complete Tyler extension schema, sign SOAP,
// authorize a payment, or send a network request.
import { buildTylerDocumentRendition } from './tylerDocumentRendition.js'
const e = value => String(value).replace(/[&<>"']/g, char => ({
 '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;',
})[char])
function assertXmlToken(value, label) {
 if (typeof value !== 'string' || !value.trim() || value.length > 1024 ||
   /[\u0000-\u001f\u007f]/.test(value)) throw new Error(label + ' required.')
 return e(value.trim())
}
const ncId = value => '<nc:IdentificationID>'+value+'</nc:IdentificationID>'
const partyRef = 'Party1', attorneyRef = 'Attorney1', filingRef = 'Filing1'

function renderDocumentAugmentation(document, bytes, structureId, lead) {
 const rendition = buildTylerDocumentRendition({
  document, bytes, structureId, isLead:lead,
 })
 return '<ecf:DocumentAugmentation>'+rendition.xml+
  '<ecf:DocumentTypeCode>'+assertXmlToken(document.documentTypeCode,'Document type code')+'</ecf:DocumentTypeCode>'+
  (lead ? '<ecf:RegisterActionDescriptionCode>'+assertXmlToken(document.filingCodeId,'Filing code')+'</ecf:RegisterActionDescriptionCode>' : '')+
  (lead ? '' : '<nc:DocumentAssociation><nc:PrimaryDocument structures:ref="'+filingRef+'">'+
     '<nc:DocumentIdentification/></nc:PrimaryDocument>'+
     '<ecf:DocumentAssociationAugmentation><ecf:DocumentRelatedCode>parent</ecf:DocumentRelatedCode>'+
     '</ecf:DocumentAssociationAugmentation></nc:DocumentAssociation>')+
  '</ecf:DocumentAugmentation>'
}

function validatePlan(plan, bytesBySourceId) {
 if (!plan || plan.transportReady !== false || plan.signed !== false ||
  plan.schemaValidated !== false || !plan.messageId || !plan.caseTrackingId ||
  !plan.filingCodeId || !plan.lead || plan.filerPartyRef !== partyRef ||
  plan.attorneyRef !== attorneyRef || plan.leadRef !== filingRef ||
  !['EFile','EFileAndServe','Serve'].includes(plan.filingAction))
  throw new Error('An unsigned, validated subsequent-civil Stage plan is required.')
 if (!bytesBySourceId || typeof bytesBySourceId !== 'object')
  throw new Error('Authorized PDF buffer map is required.')
 if (!Array.isArray(plan.attachments) || plan.attachments.length > 50)
  throw new Error('Invalid connected document count.')
 const all = [plan.lead, ...plan.attachments]
 const sourceIds = all.map(d => d.sourceObjectId)
 if (new Set(sourceIds).size !== all.length) throw new Error('Duplicate source document IDs.')
 for (const d of all) {
  if (!Buffer.isBuffer(bytesBySourceId[d.sourceObjectId]))
   throw new Error('Missing authorized PDF bytes for source document.')
 }
 const ids = (plan.serviceContacts || []).map(c => c.contactId)
 if (new Set(ids).size !== ids.length) throw new Error('Duplicate service contacts.')
 if (plan.filingAction === 'EFile' && ids.length) throw new Error('E-file-only filing cannot include e-service.')
 if (plan.filingAction !== 'EFile' && !ids.length) throw new Error('Service contacts required.')
 if ((plan.serviceContacts || []).some(c => c.representedPartyRef !== partyRef))
  throw new Error('Unsupported represented party; Stage mapping supports the filing party only.')
 return all
}

export function buildUnsignedTylerSubsequentCivilFilingMessage({plan, bytesBySourceId, submittedAt}) {
 const documents = validatePlan(plan, bytesBySourceId)
 const submitted = new Date(submittedAt)
 if (typeof submittedAt !== 'string' || !Number.isFinite(submitted.getTime()) ||
     submitted.toISOString() !== submittedAt)
  throw new Error('Explicit UTC submission timestamp required.')
 const x = key => assertXmlToken(plan[key], key)
 const lead = {...plan.lead,filingCodeId:plan.filingCodeId}
 const rendition = renderDocumentAugmentation(lead,bytesBySourceId[lead.sourceObjectId],'Document1',true)
 const linked = documents.slice(1).map((doc,i)=>'<filing:FilingConnectedDocument>'+
  '<nc:DocumentIdentification/>'+
  renderDocumentAugmentation(doc,bytesBySourceId[doc.sourceObjectId],'Document'+(i+2),false)+
  '</filing:FilingConnectedDocument>').join('')
 const recipients = (plan.serviceContacts || []).map((contact,i)=>
  '<tyler:ServiceRecipient structures:id="Recipient'+(i+1)+'">'+
  '<tyler:ServiceContactID>'+ncId(assertXmlToken(contact.contactId,'ServiceContactID'))+
  '<tyler:ServiceTypeCode>'+assertXmlToken(contact.serviceTypeCode,'ServiceTypeCode')+'</tyler:ServiceTypeCode>'+
  '</tyler:ServiceContactID><tyler:Status/>'+
  '<ecf:CaseRepresentedParty structures:ref="'+partyRef+'"/>'+
  '</tyler:ServiceRecipient>').join('')
 const service = recipients ? '<ecf:ElectronicServiceInformation>'+
  '<tyler:ElectronicServiceAugmentation>'+recipients+'</tyler:ElectronicServiceAugmentation>'+
  '<ecf:ReceivingMDELocationID/><ecf:ReceivingMDEProfileCode>'+
  'urn:oasis:names:tc:legalxml-courtfiling:schema:xsd:WebServicesMessaging-5.0'+
  '</ecf:ReceivingMDEProfileCode><ecf:ServiceRecipientID/>'+
  '</ecf:ElectronicServiceInformation>' : ''
 const xml = '<filing:FilingMessage '+
  'xmlns:filing="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/filing" '+
  'xmlns:ecf="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf" '+
  'xmlns:nc="http://release.niem.gov/niem/niem-core/4.0/" '+
  'xmlns:j="http://release.niem.gov/niem/domains/jxdm/6.1/" '+
  'xmlns:tyler="urn:tyler:ecf:v5.0:extensions:common" '+
  'xmlns:structures="http://release.niem.gov/niem/structures/4.0/">'+
  '<nc:DocumentIdentification>'+ncId(x('messageId'))+
  '<nc:IdentificationCategoryDescriptionText>messageID</nc:IdentificationCategoryDescriptionText>'+
  '<nc:IdentificationSourceText>FilingAssembly</nc:IdentificationSourceText>'+
  '</nc:DocumentIdentification>'+
  '<ecf:SendingMDELocationID>'+ncId(x('sendingMdeLocationId'))+'</ecf:SendingMDELocationID>'+
  '<ecf:ServiceInteractionProfileCode>urn:oasis:names:tc:legalxml-courtfiling:schema:xsd:WebServicesMessaging-5.0</ecf:ServiceInteractionProfileCode>'+
  '<j:CaseCourt><nc:OrganizationIdentification>'+ncId(x('courtLocationId'))+
  '</nc:OrganizationIdentification></j:CaseCourt>'+
  '<nc:DocumentPostDate><nc:DateTime>'+e(submittedAt)+'</nc:DateTime></nc:DocumentPostDate>'+
  service+linked+
  '<filing:FilingLeadDocument structures:id="'+filingRef+'">'+
  '<nc:DocumentDescriptionText>'+assertXmlToken(lead.description,'Document description')+'</nc:DocumentDescriptionText>'+
  '<nc:DocumentFiledDate><nc:DateTime>'+e(submittedAt)+'</nc:DateTime></nc:DocumentFiledDate>'+
  '<nc:DocumentIdentification/><nc:DocumentSequenceID>1</nc:DocumentSequenceID>'+
  rendition+
  '<tyler:DocumentAugmentation><tyler:FilingAction>'+e(plan.filingAction)+'</tyler:FilingAction>'+
  '<tyler:FilingAssociation><tyler:PartyReference structures:ref="'+partyRef+'"/></tyler:FilingAssociation>'+
  '</tyler:DocumentAugmentation></filing:FilingLeadDocument>'+
  '<tyler:FilingMessageAugmentation><tyler:FilingParty><tyler:PartyReference structures:ref="'+partyRef+
  '"/></tyler:FilingParty><tyler:FilingAttorney><tyler:AttorneyReference structures:ref="'+attorneyRef+
  '"/></tyler:FilingAttorney></tyler:FilingMessageAugmentation>'+
  '<nc:Case>'+
  '<j:CaseAugmentation><j:CaseCourt><nc:OrganizationIdentification>'+ncId(x('courtLocationId'))+
  '</nc:OrganizationIdentification></j:CaseCourt><j:CaseOfficial>'+
  '<nc:RoleOfPerson structures:id="'+attorneyRef+'"><ecf:PersonAugmentation><ecf:ParticipantID>'+
  ncId(x('filingAttorneyParticipantId'))+'</ecf:ParticipantID></ecf:PersonAugmentation></nc:RoleOfPerson>'+
  '<ecf:CaseOfficialAugmentation><ecf:CaseRepresentedParty structures:ref="'+partyRef+
  '"/></ecf:CaseOfficialAugmentation></j:CaseOfficial></j:CaseAugmentation>'+
  '<ecf:CaseAugmentation><ecf:CaseCategoryCode>'+x('caseCategoryCode')+
  '</ecf:CaseCategoryCode><ecf:CaseNewIndicator>false</ecf:CaseNewIndicator>'+
  '<ecf:CaseParty><nc:EntityPerson structures:id="'+partyRef+'"><ecf:PersonAugmentation><ecf:ParticipantID>'+
  ncId(x('filingPartyParticipantId'))+
  '</ecf:ParticipantID></ecf:PersonAugmentation></nc:EntityPerson></ecf:CaseParty>'+
  '<ecf:CaseTrackingID>'+ncId(x('caseTrackingId'))+'</ecf:CaseTrackingID>'+
  '<ecf:CaseTypeCode>'+x('caseTypeCode')+'</ecf:CaseTypeCode>'+
  '</ecf:CaseAugmentation></nc:Case></filing:FilingMessage>'
 return Object.freeze({
  xml, signed:false,schemaValidated:false,transportReady:false,
  connectedDocumentCount:linked ? documents.length-1 : 0,
  messageId:plan.messageId,filingCodeId:plan.filingCodeId,
  requires:['Tyler extension-schema validation','Approved payment message',
    'WS-Security signing','Tyler Stage acceptance tests'],
 })
}
