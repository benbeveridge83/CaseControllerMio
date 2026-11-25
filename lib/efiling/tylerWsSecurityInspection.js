// Defensive WS-Security envelope inspection for Tyler ECF5.
// This is intentionally NOT an XMLDSIG verifier. Canonicalization, signed
// references, certificate-chain trust, digest verification and replay protection
// still require Tyler-signed Stage fixtures and a reviewed crypto implementation.
// Never treat output of this function as evidence that an event is genuine.
import { DOMParser } from '@xmldom/xmldom'
const soapNs = 'http://schemas.xmlsoap.org/soap/envelope/'
const wsseNs = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
const wsuNs = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd'
const dsNs = 'http://www.w3.org/2000/09/xmldsig#'

export function inspectTylerWsSecurityEnvelope(xml, {now = Date.now(), skewMs = 5 * 60 * 1000} = {}) {
 if (typeof xml !== 'string' || !xml || Buffer.byteLength(xml,'utf8') > 8*1024*1024 ||
     /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsafe or oversized SOAP payload.')
 const doc = new DOMParser({onError(level,msg){if(level!=='warning') throw Error('Invalid XML: '+msg)}}).parseFromString(xml,'application/xml')
 const root=doc.documentElement
 if (!root || root.namespaceURI!==soapNs || root.localName!=='Envelope') throw new Error('SOAP 1.1 envelope required.')
 const all=(ns,name)=>Array.from(doc.getElementsByTagNameNS(ns,name))
 const body=all(soapNs,'Body'),sec=all(wsseNs,'Security'),sig=all(dsNs,'Signature'),timestamps=all(wsuNs,'Timestamp')
 if(body.length!==1 || sec.length!==1 || sig.length!==1 || timestamps.length!==1)
   throw new Error('Exactly one body, WS-Security header, signature and timestamp required.')
 const created=all(wsuNs,'Created'),expires=all(wsuNs,'Expires')
 if(created.length!==1 || expires.length!==1) throw new Error('Unique signed timestamps required.')
 const creation=Date.parse(created[0].textContent.trim()),expiry=Date.parse(expires[0].textContent.trim())
 if(!Number.isFinite(creation)||!Number.isFinite(expiry)||expiry<=creation||
    creation>now+skewMs||expiry<now-skewMs||expiry-creation>60*60*1000)
   throw new Error('SOAP timestamp is outside acceptable bounds.')
 const ids=new Set()
 for (const el of Array.from(doc.getElementsByTagName('*'))) {
   const id=el.getAttributeNS(wsuNs,'Id')
   if (id) {
     if(ids.has(id))throw new Error('Duplicate WS-Security IDs are forbidden.')
     ids.add(id)
   }
 }
 const signedInfo=all(dsNs,'SignedInfo'),references=all(dsNs,'Reference')
 if(signedInfo.length!==1 || references.length===0) throw new Error('No signature references.')
 // Deliberately no further trust claim, even when references look correct.
 return Object.freeze({
   candidate:true, cryptographicallyVerified:false, trustedIssuer:false,
   signatureCount:sig.length, referencedIds:references.map(x=>x.getAttribute('URI')||''),
   createdAt:new Date(creation).toISOString(), expiresAt:new Date(expiry).toISOString(),
 })
}
