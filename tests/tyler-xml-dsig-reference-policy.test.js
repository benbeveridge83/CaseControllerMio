import test from 'node:test'
import assert from 'node:assert/strict'
import {inspectTylerXmlDsigReferenceBindings} from '../lib/efiling/tylerXmlDsigReferencePolicy.js'
const now=Date.parse('2026-11-27T01:15:00.000Z')
const xml=`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
<s:Header><wsse:Security>
<wsu:Timestamp wsu:Id="Timestamp-1"><wsu:Created>2026-11-27T01:14:00Z</wsu:Created><wsu:Expires>2026-11-27T01:16:00Z</wsu:Expires></wsu:Timestamp>
<ds:Signature><ds:SignedInfo>
<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
<ds:Reference URI="#Body-1"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>fake</ds:DigestValue></ds:Reference>
<ds:Reference URI="#Timestamp-1"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>fake</ds:DigestValue></ds:Reference>
</ds:SignedInfo><ds:SignatureValue>fake</ds:SignatureValue></ds:Signature>
</wsse:Security></s:Header><s:Body wsu:Id="Body-1"><x:ReviewFilingResponse xmlns:x="urn:example:only"/></s:Body></s:Envelope>`
const inspect = s => inspectTylerXmlDsigReferenceBindings(s,{now})
test('a complete-looking signature is never marked cryptographically verified',()=>{
 const r=inspect(xml)
 assert.equal(r.structuralChecksPassed,true)
 assert.equal(r.cryptographicallyVerified,false)
 assert.equal(r.trustedIssuer,false)
 assert.equal(r.transportReady,false)
 assert.deepEqual([...r.referencedIds],['Body-1','Timestamp-1'])
})
test('rejects signing only the timestamp (signature wrapping)',()=>{
 const without=xml.replace(/<ds:Reference URI="#Body-1">[\s\S]*?<\/ds:Reference>/,'')
 assert.throws(()=>inspect(without),/Body and Timestamp must both be signed/)
})
test('rejects signature pointing to external URL or an unresolved identifier',()=>{
 assert.throws(()=>inspect(xml.replace('URI="#Body-1"','URI="https://example.invalid/payload"')),/Only local/)
 assert.throws(()=>inspect(xml.replace('URI="#Body-1"','URI="#WrongBody"')),/does not resolve uniquely/)
})
test('rejects SHA-1 methods and repeated references',()=>{
 assert.throws(()=>inspect(xml.replace('rsa-sha256','rsa-sha1')),/SHA-1 signatures/)
 assert.throws(()=>inspect(xml.replace('xmlenc#sha256','xmldsig#sha1')),/XMLDSIG digest/)
 const extra='<ds:Reference URI="#Body-1"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/></ds:Reference>'
 assert.throws(()=>inspect(xml.replace('</ds:SignedInfo>',extra+'</ds:SignedInfo>')),/Repeated signature references/)
})
test('rejects signature moved into SOAP Body',()=>{
 const start=xml.indexOf('<ds:Signature>')
 const end=xml.indexOf('</ds:Signature>',start)
 const signature=start>=0 && end>=0 ? xml.slice(start,end+'</ds:Signature>'.length) : null
 assert.ok(signature)
 const wrapped=xml.replace(signature,'').replace('</s:Body>',signature+'</s:Body>')
 assert.throws(()=>inspect(wrapped),/Single SOAP Header/)
})
test('rejects duplicate signed XML IDs and ambiguous header structure',()=>{
 assert.throws(()=>inspect(xml.replace('wsu:Id="Body-1"','wsu:Id="Timestamp-1"')),/Duplicate WS-Security IDs|distinct/)
 assert.throws(()=>inspect(xml.replace('<s:Header>','<s:Header></s:Header><s:Header>')),/Single SOAP Header/)
})
