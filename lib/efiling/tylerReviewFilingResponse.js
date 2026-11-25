// Tyler ECF5 ReviewFilingResponse metadata extraction.
// Based on Artifacts/Sample Messages/filingreviewmde/reviewfiling/
// tyler-reviewfiling-response.xml from EFM Documentation v2026.2.2.
// Does NOT cryptographically authenticate any XML. Upstream WS-Security
// signature verification is mandatory before passing this to the ledger.
import { DOMParser } from '@xmldom/xmldom'
const NS={
 wrapper:'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/wrappers',
 cbrn:'http://release.niem.gov/niem/domains/cbrn/4.1/',
 ecf:'https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf',
 nc:'http://release.niem.gov/niem/niem-core/4.0/',
 soap:'http://schemas.xmlsoap.org/soap/envelope/',
}
const children=(n,ns,name)=>Array.from(n?.childNodes||[]).filter(e=>e.nodeType===1 && e.namespaceURI===ns && e.localName===name)
const one=(n,ns,name)=>children(n,ns,name)[0]
const txt=n=>String(n?.textContent||'').trim()
export function parseTylerReviewFilingResponse(xml) {
 if(typeof xml!=='string' || !xml || Buffer.byteLength(xml,'utf8')>8*1024*1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
  throw new Error('Invalid Tyler response payload.')
 const doc=new DOMParser({onError(level,msg){if(level!=='warning')throw Error('Invalid Tyler XML: '+msg)}}).parseFromString(xml,'application/xml')
 let root=doc.documentElement
 if(root?.namespaceURI===NS.soap && root.localName==='Envelope') {
  const body=one(root,NS.soap,'Body')
  if(!body || children(root,NS.soap,'Body').length!==1)throw new Error('SOAP body missing.')
  const ops=Array.from(body.childNodes).filter(n=>n.nodeType===1)
  if(ops.length!==1)throw new Error('Ambiguous SOAP operation.')
  root=ops[0]
 }
 if(root?.namespaceURI!==NS.wrapper || root.localName!=='ReviewFilingResponse')
  throw new Error('Unexpected ReviewFiling response operation.')
 const status=one(root,NS.cbrn,'MessageStatus')
 if(!status)throw new Error('Missing Tyler message status.')
 const statusCode=txt(one(status,NS.cbrn,'MessageStatusCode'))
 if(statusCode!=='Success')throw new Error('Tyler did not report ReviewFiling success.')
 const augmentation=one(status,NS.ecf,'MessageStatusAugmentation')
 if(!augmentation)throw new Error('Missing Tyler filing references.')
 const idByCategory=new Map()
 for(const element of children(augmentation,NS.nc,'DocumentIdentification')){
  const kind=txt(one(element,NS.nc,'IdentificationCategoryDescriptionText')).toLowerCase()
  const id=txt(one(element,NS.nc,'IdentificationID'))
  if(kind && id){const values=idByCategory.get(kind)||[];values.push(id);idByCategory.set(kind,values)}
 }
 const ids=key=>idByCategory.get(key)||[]
 const envelopes=ids('envelopeid'),filings=ids('filingid')
 if(envelopes.length!==1 || filings.length<1 || filings.length>100 ||
    filings.some(x=>x.length>256) || new Set(filings).size!==filings.length)
  throw new Error('ReviewFiling must return one envelope and valid filing identifiers.')
 return Object.freeze({envelopeId:envelopes[0],filingIds:filings,caseId:ids('caseid')[0]||null,
  messageId:ids('messageid')[0]||null,cryptographicallyVerified:false})
}
