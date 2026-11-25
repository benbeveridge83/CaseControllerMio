import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DOMParser } from '@xmldom/xmldom'
import {buildTylerDocumentRendition} from '../lib/efiling/tylerDocumentRendition.js'
const bytes=Buffer.from('%PDF-1.7\nsynthetic test-only document bytes\n%%EOF')
const doc={fileName:'Motion & Order.pdf',pageCount:1,byteLength:bytes.length,
 sha256:createHash('sha256').update(bytes).digest('hex'),
 documentTypeCode:'677',filingComponentCode:'332',
 description:'Motion & supporting declaration',redacted:false}
test('prepares ECF5 document rendition only after digest and byte-size checks',()=>{
 const r=buildTylerDocumentRendition({document:doc,bytes,structureId:'Document1',isLead:true})
 const x=new DOMParser().parseFromString(r.xml,'application/xml')
 const nc='http://release.niem.gov/niem/niem-core/4.0/'
 const tyler='urn:tyler:ecf:v5.0:extensions:common'
 assert.equal(x.getElementsByTagNameNS(nc,'Base64BinaryObject')[0].textContent,bytes.toString('base64'))
 assert.equal(x.getElementsByTagNameNS(nc,'BinarySizeValue')[0].textContent,String(bytes.length))
 assert.equal(x.getElementsByTagNameNS(tyler,'OriginalFileName')[0].textContent,doc.fileName)
 assert.equal(x.getElementsByTagNameNS(tyler,'FilingComponentCode')[0].textContent,'332')
 assert.equal(r.transportReady,false)
})
test('blocks altered PDF, incorrect digest and non-PDF content',()=>{
 assert.throws(()=>buildTylerDocumentRendition({document:doc,bytes:Buffer.from('%PDF-1.7\ntampered'),structureId:'Document1'}),/size/)
 assert.throws(()=>buildTylerDocumentRendition({document:{...doc,sha256:'b'.repeat(64)},bytes,structureId:'Document1'}),/digest/)
 assert.throws(()=>buildTylerDocumentRendition({document:{...doc,byteLength:4},bytes:Buffer.from('evil'),structureId:'Document1'}),/PDF/)
})
test('connected document does not claim to have a lead component code',()=>{
 const x=buildTylerDocumentRendition({document:doc,bytes,structureId:'Document2'})
 assert.equal(x.xml.includes('FilingComponentCode'),false)
 assert.equal(x.schemaValidated,false)
})
