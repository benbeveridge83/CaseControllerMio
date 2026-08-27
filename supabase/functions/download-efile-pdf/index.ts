// Supabase Edge Function: download-efile-pdf
// Purpose: server-side download of Tyler/eFile PDF links that the browser cannot fetch because of CORS.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function safeFileName(name = 'efile-document.pdf') {
  const clean = String(name || 'efile-document.pdf')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
  return /\.pdf$/i.test(clean) ? clean : `${clean || 'efile-document'}.pdf`
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)

  try {
    const { url, file_name } = await req.json()
    const targetUrl = String(url || '')
    if (!/^https:\/\/(texas\.tylertech\.cloud|efiletx\.tylertech\.cloud)\//i.test(targetUrl)) {
      return json({ error: 'Only Tyler/eFile document links are allowed.' }, 400)
    }

    const response = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 CaseControllerMio/1.0',
        'Accept': 'application/pdf,application/octet-stream,text/html;q=0.8,*/*;q=0.5',
      },
    })

    const contentType = response.headers.get('content-type') || 'application/pdf'
    if (!response.ok) {
      return json({ error: `Tyler download returned ${response.status}`, status: response.status }, 502)
    }

    const arrayBuffer = await response.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    const textProbe = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 300))).toLowerCase()
    const looksLikeHtml = contentType.includes('text/html') || textProbe.includes('<html') || textProbe.includes('<!doctype')
    const looksLikePdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46

    if (looksLikeHtml && !looksLikePdf) {
      return json({
        error: 'Tyler returned an HTML page instead of a PDF. The link may require an active eFile session or may have expired.',
        content_type: contentType,
        status: response.status,
      }, 502)
    }

    if (bytes.length < 100) {
      return json({ error: 'Tyler returned too few bytes to be a PDF.', content_type: contentType }, 502)
    }

    return json({
      ok: true,
      file_name: safeFileName(file_name || 'efile-document.pdf'),
      content_type: looksLikePdf ? 'application/pdf' : contentType,
      file_base64: bytesToBase64(bytes),
      size: bytes.length,
    })
  } catch (error) {
    return json({ error: error?.message || String(error) }, 500)
  }
})
