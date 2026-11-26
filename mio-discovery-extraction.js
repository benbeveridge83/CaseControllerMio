import {mountDiscoveryRerun} from './mio-discovery-rerun.js'
// Follow Mio's existing App integration pattern; fail the build on anchor drift.
export function mountDiscoveryExtraction(input){
 let source=input
 const patch=(from,to)=>{if(!source.includes(from))throw new Error('Discovery extraction anchor missing: '+from.slice(0,100));source=source.replace(from,to)}
 const start=source.indexOf('  function extractExhibitANumberedRequests(')
 const end=source.indexOf('  function localExtractRespondingDiscoveryRequests(',start)
 if(start<0||end<start)throw new Error('Discovery disclosure parser anchors missing')
 source=source.slice(0,start)+"  function extractExhibitANumberedRequests(rawText = '', type = '') {\n    return extractServedDiscoveryRequests(rawText, type)\n  }\n  function extractNumberedDisclosureRequests(rawText = '') {\n    return extractDisclosureRequests(rawText)\n  }\n\n"+source.slice(end)
 const localStart=source.indexOf('  function localExtractRespondingDiscoveryRequests(')
 const localEnd=source.indexOf('  async function callRespondingDiscoveryExtractionApi(',localStart)
 if(localStart<0||localEnd<localStart)throw new Error('Discovery local parser anchors missing')
 source=source.slice(0,localStart)+"  function localExtractRespondingDiscoveryRequests(rawText = '', type = '') {\n    return extractServedDiscoveryRequests(rawText, type)\n  }\n\n"+source.slice(localEnd)
 patch("    const extracted = extractionResult?.requests || []\n    return (extracted.length ? extracted : localExtractRespondingDiscoveryRequests(rawText, setType))", "    const extracted = extractionResult?.requests || []\n    if (!extracted.length) throw new Error('No individual numbered discovery requests were recognized. No set was created. Review the document text or paste the requests manually.')\n    return extracted")
 patch('{discoveryTypeShortLabel(activeSet.discovery_type)} {index + 1}', '{discoveryTypeShortLabel(activeSet.discovery_type)} {request.request_number || index + 1}')
 return mountDiscoveryRerun("import {extractServedDiscoveryRequests} from '../supabase/functions/_shared/served-discovery-extraction.js'\nimport {extractDisclosureRequests} from '../supabase/functions/_shared/disclosure-extraction.js'\n"+source)
}
export default function discoveryExtraction(){return {name:'mio-discovery-extraction',enforce:'pre',transform(code,id){if(!id.replaceAll('\\','/').endsWith('/src/App.jsx'))return null;return {code:mountDiscoveryExtraction(code),map:null}}}}
