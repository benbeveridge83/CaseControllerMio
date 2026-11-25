import {extractDisclosureRequests} from '../_shared/disclosure-extraction.js'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type DiscoveryRequest = {
  request_number: string
  request_text: string
  confidence: number
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeText(rawText: string) {
  return String(rawText || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function serverExtractRequests(rawText: string, discoveryType: string): DiscoveryRequest[] {
  if (/disclosure|rfd/i.test(discoveryType)) return extractDisclosureRequests(rawText)
  const text = normalizeText(rawText)
  if (!text) return []

  const matches: Array<{ index: number; end: number; number: number }> = []
  const collect = (pattern: RegExp) => {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
      const number = Number(match[1])
      if (!Number.isInteger(number) || number < 1 || number > 250) continue
      matches.push({ index: match.index, end: pattern.lastIndex, number })
    }
  }

  collect(/(?:^|\n)\s*(?:request\s+(?:for\s+)?(?:production|inspection|admission|admissions|disclosure|disclosures)|interrogatory|interrogatories|rog(?:g)?s?|rfp|rfa|rfd)\s*(?:no\.?|number|#)?\s*(\d{1,3})\b\s*[).:\-]?/gim)
  if (matches.length < 2) {
    matches.length = 0
    collect(/(?:^|\n)\s*request\s*(?:no\.?|number|#)\s*(\d{1,3})\b\s*[).:\-]?/gim)
  }
  if (matches.length < 2) {
    matches.length = 0
    collect(/(?:^|\n)\s*(\d{1,3})\s*[.)]\s+(?=[A-Z])/gm)
  }

  const ordered = matches
    .sort((a, b) => a.index - b.index)
    .filter((item, index, rows) => index === 0 || item.index !== rows[index - 1].index)

  let best: typeof ordered = []
  for (let start = 0; start < ordered.length; start += 1) {
    if (ordered[start].number !== 1) continue
    const sequence = [ordered[start]]
    let expected = 2
    for (let index = start + 1; index < ordered.length; index += 1) {
      if (ordered[index].number === expected) {
        sequence.push(ordered[index])
        expected += 1
      } else if (ordered[index].number > expected) {
        break
      }
    }
    if (sequence.length > best.length) best = sequence
  }

  const source = best.length >= 2 ? best : ordered
  return source.map((item, index) => {
    const end = index + 1 < source.length ? source[index + 1].index : text.length
    const requestText = text.slice(item.end, end)
      .replace(/^[:.)\-\s]+/, '')
      .replace(/\s*(?:certificate of service|respectfully submitted)[\s\S]*$/i, '')
      .trim()
    return { request_number: String(item.number), request_text: requestText, confidence: 0.78 }
  }).filter((item) => item.request_text.length >= 10)
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

    const serverRequests = serverExtractRequests(rawText, discoveryType)
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

