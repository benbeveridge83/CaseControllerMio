// Strict pre-cryptographic XMLDSIG reference check for ECF5 WS-Security.
// This detects SOAP wrapping / reference confusion before invoking a vetted
// XMLDSIG engine. It DOES NOT validate digests, signatures or certificate trust.
import { DOMParser } from '@xmldom/xmldom'
import { inspectTylerWsSecurityEnvelope } from './tylerWsSecurityInspection.js'

const SOAP='http://schemas.xmlsoap.org/soap/envelope/'
const WSSE='http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
const WSU='http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd'
const DS='http://www.w3.org/2000/09/xmldsig#'
const SHA1=/sha1|rsa-sha1|hmac-sha1/i

export function inspectTylerXmlDsigReferenceBindings(xml, options = {}) {
 const preliminary=inspectTylerWsSecurityEnvelope(xml,options)
 const doc=new DOMParser({
  onError(level,message){if(level!=='warning')throw Error('Malformed XML: '+message)},
 }).parseFromString(xml,'application/xml')
 const one=(ns,name)=>Array.from(doc.getElementsByTagNameNS(ns,name))
 const root=doc.documentElement
 if(root.namespaceURI!==SOAP || root.localName!=='Envelope')
  throw Error('SOAP envelope required.')
 const header=one(SOAP,'Header'),body=one(SOAP,'Body')
 const security=one(WSSE,'Security'),timestamps=one(WSU,'Timestamp')
 if(header.length!==1 || body.length!==1 || security.length!==1 || timestamps.length!==1 ||
   security[0].parentNode!==header[0])
  throw Error('Single SOAP Header, Body and Security header required.')
 const bodyId=body[0].getAttributeNS(WSU,'Id')
 const timestampId=timestamps[0].getAttributeNS(WSU,'Id')
 if(!bodyId || !timestampId || bodyId===timestampId)
  throw Error('SOAP Body and Timestamp must have distinct wsu:Id values.')
 const signedInfo=one(DS,'SignedInfo')
 if(signedInfo.length!==1)throw Error('Exactly one ds:SignedInfo required.')
 const methods=one(DS,'SignatureMethod'),canon=one(DS,'CanonicalizationMethod')
 if(methods.length!==1 || canon.length!==1 ||
   !methods[0].getAttribute('Algorithm') || !canon[0].getAttribute('Algorithm'))
  throw Error('Signature and canonicalization algorithms must be identified.')
 if(SHA1.test(methods[0].getAttribute('Algorithm')))
  throw Error('SHA-1 signatures are forbidden.')
 const references=Array.from(signedInfo[0].getElementsByTagNameNS(DS,'Reference'))
 const ids=[]
 for (const ref of references) {
  const uri=ref.getAttribute('URI')
  if(!uri || !/^#[A-Za-z_][A-Za-z0-9_.-]*$/.test(uri))
   throw Error('Only local, unambiguous XMLDSIG references allowed.')
  const id=uri.slice(1)
  const matching=Array.from(doc.getElementsByTagName('*'))
   .filter(n=>n.getAttributeNS(WSU,'Id')===id)
  if(matching.length!==1)throw Error('Signature reference does not resolve uniquely.')
  const digests=Array.from(ref.getElementsByTagNameNS(DS,'DigestMethod'))
  if(digests.length!==1 || !digests[0].getAttribute('Algorithm') ||
     SHA1.test(digests[0].getAttribute('Algorithm')))
   throw Error('Missing or forbidden XMLDSIG digest algorithm.')
  ids.push(id)
 }
 if(new Set(ids).size!==ids.length)
  throw Error('Repeated signature references forbidden.')
 if(!ids.includes(bodyId) || !ids.includes(timestampId))
  throw Error('SOAP Body and Timestamp must both be signed.')
 return Object.freeze({
  structuralChecksPassed:true,
  boundSoapBodyId:bodyId,
  boundTimestampId:timestampId,
  referencedIds:Object.freeze(ids),
  timestampCreatedAt:preliminary.createdAt,
  cryptographicallyVerified:false,
  trustedIssuer:false,
  replayVerified:false,
  transportReady:false,
 })
}
