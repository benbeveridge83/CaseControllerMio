import {extractServedDiscoveryRequests} from '../_shared/served-discovery-extraction.js'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    const body = await req.json()
    const rawText = String(body?.raw_text || '').slice(0, 180000)
    const discoveryType = String(body?.discovery_type || 'Request for Production')
    const fileName = String(body?.file_name || '')
    if (rawText.trim().length < 40) return jsonResponse({ error: 'No usable document text was provided.' }, 400)

    const serverRequests = extractServedDiscoveryRequests(rawText, discoveryType)
    if (!serverRequests.length) return jsonResponse({ error: `No numbered ${discoveryType} requests were found in ${fileName || 'the document'}.` }, 422)
    return jsonResponse({
      requests: serverRequests,
      extraction_method: 'server_parser',
      document_type: discoveryType,
      file_name: fileName,
    })
  } catch (error) {
    console.error('extract-discovery failed', error)
    return jsonResponse({ error: error?.message || 'Discovery extraction failed.' }, 500)
  }
})

