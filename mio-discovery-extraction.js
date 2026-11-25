// Follow Mio's existing App integration pattern; fail the build on anchor drift.
export function mountDiscoveryExtraction(input){
 let source=input
 const patch=(from,to)=>{if(!source.includes(from))throw new Error('Discovery extraction anchor missing: '+from.slice(0,100));source=source.replace(from,to)}
 const start=source.indexOf('  function extractNumberedDisclosureRequests(')
 const end=source.indexOf('  function localExtractRespondingDiscoveryRequests(',start)
 if(start<0||end<start)throw new Error('Discovery disclosure parser anchors missing')
 source=source.slice(0,start)+"  function extractNumberedDisclosureRequests(rawText = '') {\n    return extractDisclosureRequests(rawText)\n  }\n\n"+source.slice(end)
 patch('      if (disclosureRequests.length >= 2) return disclosureRequests','      return disclosureRequests')
 patch("    return clean\n      .split(/\\n{2,}/)\n      .map((part) => part.trim())\n      .filter((part) => part.length > 20)\n      .slice(0, 100)\n      .map((requestText, index) => ({ request_number: String(index + 1), request_text: requestText, confidence: 0.35 }))",'    return [] // Document pages are not individual discovery requests.')
 patch("    const extracted = extractionResult?.requests || []\n    return (extracted.length ? extracted : localExtractRespondingDiscoveryRequests(rawText, setType))", "    const extracted = extractionResult?.requests || []\n    if (!extracted.length) throw new Error('No individual numbered discovery requests were recognized. No set was created. Review the document text or paste the requests manually.')\n    return extracted")
 return "import {extractDisclosureRequests} from '../supabase/functions/_shared/disclosure-extraction.js'\n"+source
}
export default function discoveryExtraction(){return {name:'mio-discovery-extraction',enforce:'pre',transform(code,id){if(!id.replaceAll('\\','/').endsWith('/src/App.jsx'))return null;return {code:mountDiscoveryExtraction(code),map:null}}}}
