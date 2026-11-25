// Isolated ECF5 DocumentRendition component preparation.
// Matches Tyler v2026.2.2 sample FilingLeadDocument / FilingConnectedDocument
// structure but is NOT a full filing message or XSD-validating serializer.
// The source bytes must come from an authorized private document read.
// Never persist Base64 content in a browser-local draft or structured logs.
import { createHash } from 'node:crypto'

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
const code = (v, name) => {
 if(typeof v !== 'string' || !v.trim() || v.trim().length>256)
  throw new Error(name+' must be provided by the EFM or source document.')
 return v.trim()
}

export function buildTylerDocumentRendition({document,bytes,structureId,isLead=false}) {
 if(!document || typeof document !== 'object')throw new Error('Mapped document is required.')
 if(!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length>15*1024*1024)
  throw new Error('Authorized PDF Buffer of at most 15 MiB is required.')
 if(bytes.subarray(0,5).toString('ascii')!=='%PDF-')
  throw new Error('Document bytes do not begin with a PDF header.')
 if(bytes.length!==document.byteLength) throw new Error('PDF size differs from reviewed filing.')
 const digest=createHash('sha256').update(bytes).digest('hex')
 if(digest!==document.sha256) throw new Error('PDF digest differs from reviewed filing.')
 const fileName=code(document.fileName,'OriginalFileName')
 if(!/\.pdf$/i.test(fileName)) throw new Error('Document filename must end in .pdf.')
 if(!Number.isSafeInteger(document.pageCount) || document.pageCount<1)
  throw new Error('Verified page count required.')
 const attachmentId=code(structureId,'NIEM attachment structures:id')
 const component=isLead ? '<tyler:FilingComponentCode>'+esc(code(document.filingComponentCode,'FilingComponentCode'))+'</tyler:FilingComponentCode>' : ''
 const xml = '<ecf:DocumentRendition xmlns:ecf="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf" '+
  'xmlns:nc="http://release.niem.gov/niem/niem-core/4.0/" '+
  'xmlns:tyler="urn:tyler:ecf:v5.0:extensions:common" '+
  'xmlns:structures="http://release.niem.gov/niem/structures/4.0/">'+
  '<nc:DocumentIdentification/><nc:Attachment structures:id="'+esc(attachmentId)+'">'+
  '<tyler:AttachmentAugmentation>'+component+
  '<tyler:PageCount>'+document.pageCount+'</tyler:PageCount>'+
  '<tyler:OriginalFileName>'+esc(fileName)+'</tyler:OriginalFileName>'+
  '<tyler:IsRedactedIndicator>'+(document.redacted?'true':'false')+'</tyler:IsRedactedIndicator>'+
  '</tyler:AttachmentAugmentation>'+
  '<nc:Base64BinaryObject>'+bytes.toString('base64')+'</nc:Base64BinaryObject>'+
  '<nc:BinaryDescriptionText>'+esc(code(document.description,'Document description'))+'</nc:BinaryDescriptionText>'+
  '<nc:BinarySizeValue>'+bytes.length+'</nc:BinarySizeValue>'+
  '</nc:Attachment></ecf:DocumentRendition>'
 return Object.freeze({
  xml, sha256:digest, byteLength:bytes.length,
  documentTypeCode:code(document.documentTypeCode,'DocumentTypeCode'),
  // Requires surrounding FilingLeadDocument / FilingConnectedDocument
  // with relationships and full ECF5 schema validation.
  schemaValidated:false,signed:false,transportReady:false,
 })
}
