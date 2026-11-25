import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {extractDisclosureRequests} from '../supabase/functions/_shared/disclosure-extraction.js'
import {mountDiscoveryExtraction} from '../mio-discovery-extraction.js'

// Synthetic three-page disclosure: lowercase requests, wrapped lines and rule citations.
const questions=['the correct names of the parties;','the names and contact information of potential parties;','the factual bases of the claims, without marshaling evidence;','the amount and calculation of claimed damages;','the people with knowledge of relevant facts and their connection to the case;','for any expert, the information described in Rule 194a.2(f) and Rule 195a;','any discoverable insurance agreements;','any discoverable settlement agreements;','any discoverable witness statements;','in a suit alleging injury, the records obtained through an authorization; and','the contact information of a potential responsible third party.']
const pages=['NOTICE: SENSITIVE DATA\nREQUESTS FOR DISCLOSURE\nPursuant to Rule 194a, respond within 30 days.\nRespectfully submitted\nFirm counsel\nPage 1 of 3','Certificate of Service\nServed on November 12, 2026.\nPage 2 of 3','Disclosure Request\nUnder Rule 194a, provide the requested information.\nMatters to Be Disclosed\n'+questions.map((q,i)=>(i+1)+'. '+q).join('\n')+'\nPage 3 of 3']
const flatPages=pages.map(p=>p.replace(/\s+/g,' ')).join('\n\n')
const check=rows=>{assert.equal(rows.length,11);assert.deepEqual(rows.map(r=>r.request_number),questions.map((_,i)=>String(i+1)));assert.deepEqual(rows.map(r=>r.request_text),questions);assert.doesNotMatch(rows.map(r=>r.request_text).join(' '),/Certificate of Service|NOTICE|Respectfully submitted|Matters to Be Disclosed|Page \d/) }
test('extracts eleven lowercase requests from three flattened PDF pages',()=>check(extractDisclosureRequests(flatPages)))
test('line wrapping, CRLF and a completely flattened document produce the same requests',()=>{for(const text of [pages.join('\n\n'),pages.join('\r\n\r\n'),flatPages.replace(/\s+/g,' ')])check(extractDisclosureRequests(text))})
test('mixed case and parenthesized request numbers are accepted',()=>{const result=extractDisclosureRequests('Matters to Be Disclosed 1) the names. 2) Any agreements. 3) FOR any expert, the qualifications.');assert.deepEqual(result.map(r=>r.request_text),['the names.','Any agreements.','FOR any expert, the qualifications.'])})
test('actual disclosure list wins over numbered introductory instructions',()=>{check(extractDisclosureRequests('Instructions\n1. Use complete sentences.\n2. Respond in time.\n'+flatPages))})
test('a document with no numbered requests is never split into page-sized requests',()=>assert.deepEqual(extractDisclosureRequests(pages.slice(0,2).join('\n\n')),[]))
test('a single request is recognized and legal citations are not request numbers',()=>{const r=extractDisclosureRequests('Disclosure Request under Rule 194a.2.\n1. the information described in Rule 194a.2(f).');assert.equal(r.length,1);assert.equal(r[0].request_text,'the information described in Rule 194a.2(f).')})
test('the App fallback uses the shared parser and returns no page-sized guesses',()=>{
 const app=mountDiscoveryExtraction(fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8'))
 const names=['discoveryTypeColumnKey','normalizeDiscoveryExtractionText','extractNumberedDisclosureRequests','extractExhibitANumberedRequests','localExtractRespondingDiscoveryRequests']
 const body=names.map(name=>{const start=app.indexOf('  function '+name+'('),end=app.indexOf('\n  function ',start+4);return app.slice(start,end)}).join('\n')
 const parse=new Function('extractDisclosureRequests',body+';return localExtractRespondingDiscoveryRequests')(extractDisclosureRequests)
 check(parse(flatPages,'Request for Disclosures'));assert.deepEqual(parse(pages[0]+'\n\n'+pages[1],'Request for Disclosures'),[])
 for(const type of ['Request for Production','Interrogatories','Request for Admissions']){
  const rows=parse('Exhibit A\n1. Produce or identify the first item.\n2. Produce or identify the second item.',type);assert.equal(rows.length,2,type)
 }
 assert.match(app,/if \(!extracted.length\) throw new Error\('No individual numbered discovery requests/)
 assert.throws(()=>mountDiscoveryExtraction('changed source'),/anchors missing/)
})
test('the deployed Edge handler returns eleven requests and uses 422 only for unrecognized text',async()=>{
 let handler;const original=globalThis.Deno;globalThis.Deno={serve(fn){handler=fn}}
 try{await import('../supabase/functions/extract-discovery/index.ts');for(const raw_text of [flatPages,pages.join('\n')]){
  const response=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({raw_text,discovery_type:'Request for Disclosures',file_name:'synthetic.pdf'})}));assert.equal(response.status,200);check((await response.json()).requests)
 }const rejected=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({raw_text:pages[0],discovery_type:'Request for Disclosures'})}));assert.equal(rejected.status,422)
 }finally{if(original===undefined)delete globalThis.Deno;else globalThis.Deno=original}
})
