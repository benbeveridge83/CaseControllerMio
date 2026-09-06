// Read-only, bounded cloud startup. Partial records are never exposed to App.
const TABLE = 'case_mio_user_state'
const RPC = 'mio_cloud_state_read_chunks_v297'
const LEGACY_SNAPSHOT = '__mio_live_state_snapshot__'
const cancelled = () => Object.assign(new Error('Cloud loading was cancelled.'), { code: 'LOAD_CANCELLED' })
const transient = error => [408, 429, 500, 502, 503, 504].includes(Number(error?.status)) ||
  ['CLOUD_TIMEOUT', '57014'].includes(error?.code) || /failed to fetch|networkerror/i.test(error?.message || '')
const characterCount = text => { let n = 0; for (const character of text) { void character; n++ } return n }

// Bound fetch and a client waiting on sign-in; abortSignal alone cannot bound the latter.
export async function cloudReadRequest(makeQuery, { signal, timeoutMs = 15000 } = {}) {
  if (signal?.aborted) throw cancelled()
  const controller = new AbortController()
  let timer, onAbort
  const deadline = new Promise((_, reject) => {
    onAbort = () => { controller.abort(); reject(cancelled()) }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      controller.abort()
      reject(Object.assign(new Error('Supabase did not finish a cloud read within ' + Math.ceil(timeoutMs / 1000) + ' seconds. Retry loading; saved data has not been reset.'), { code: 'CLOUD_TIMEOUT' }))
    }, timeoutMs)
  })
  try {
    let query = makeQuery()
    if (typeof query?.abortSignal === 'function') query = query.abortSignal(controller.signal)
    const result = await Promise.race([Promise.resolve(query), deadline])
    if (signal?.aborted) throw cancelled()
    if (result?.error || Number(result?.status) >= 400) {
      const missing = result?.error?.code === 'PGRST202'
      throw Object.assign(new Error(missing ? 'The cloud startup update is not available on the server yet. Retry loading; no defaults were loaded.' : result?.error?.message || 'Supabase could not read the saved workspace.'), {
        code: result?.error?.code, status: result?.status || result?.error?.status,
      })
    }
    if (!Array.isArray(result?.data)) throw new Error('Supabase returned an incomplete cloud read. No defaults were loaded.')
    return result.data
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function readMioCloudRows(client, userId, {
  isAppKey, signal, onProgress = () => {}, timeoutMs = 15000, retryDelayMs = 300, cachedRows = [], concurrency = 4,
} = {}) {
  const request = factory => cloudReadRequest(factory, { signal, timeoutMs })
  const retry = async factory => {
    try { return await request(factory) }
    catch (error) {
      if (!transient(error) || signal?.aborted) throw error
      await new Promise(resolve => setTimeout(resolve, retryDelayMs))
      return request(factory)
    }
  }
  // Only names are listed here; document values never enter the manifest response.
  const keys = [], seen = new Set(), manifest = new Map()
  for (let start = 0; ; start += 100) {
    onProgress({ phase: 'listing', loaded: 0, total: keys.length, characters: 0 })
    const page = await retry(() => client.from(TABLE).select('key,updated_at').eq('user_id', userId)
      .neq('key', LEGACY_SNAPSHOT).order('key').range(start, start + 99))
    for (const row of page) {
      if (typeof row.key !== 'string' || seen.has(row.key)) throw new Error('The cloud record list changed while loading. Please retry.')
      seen.add(row.key)
      if (isAppKey(row.key)) { keys.push(row.key); manifest.set(row.key, row.updated_at) }
    }
    if (page.length < 100) break
  }
  // Only Supabase-confirmed baseline values may be supplied here. Every reused
  // version is checked against the current, account-scoped cloud manifest.
  const cached = new Map((await cachedRows).filter(row => row && typeof row.key === 'string' &&
    typeof row.raw_value === 'string' && typeof row.updated_at === 'string' && row.updated_at &&
    manifest.get(row.key) === row.updated_at).map(row => [row.key, row]))
  const rows = keys.filter(key => cached.has(key)).map(key => cached.get(key))
  const missing = keys.filter(key => !cached.has(key))
  const reused = rows.length
  let loaded = reused, characters = 0
  const progress = () => onProgress({ phase: 'reading', loaded, total: keys.length, characters, reused })
  progress()
  const chunks = (group, offset) => retry(() => client.rpc(RPC, {
    p_user_id: userId, p_keys: group, p_offset: offset, p_chunk_chars: Math.floor(262144 / group.length),
  }))
  const validate = (data, group, offset) => {
    if (data.length !== group.length || new Set(data.map(row => row.key)).size !== group.length ||
        data.some(row => !group.includes(row.key))) {
      throw new Error('A saved cloud record was not returned. Loading stopped to protect your data. Please retry.')
    }
    for (const row of data) {
      if (typeof row.raw_value !== 'string' || typeof row.updated_at !== 'string' ||
          !Number.isSafeInteger(row.total_chars) || !Number.isSafeInteger(row.next_offset) ||
          row.total_chars < 0 || row.chunk_offset !== offset || row.next_offset !== offset + characterCount(row.raw_value) ||
          row.next_offset > row.total_chars || row.complete !== (row.next_offset === row.total_chars) ||
          (!row.complete && row.next_offset <= offset)) {
        throw new Error('A cloud record was truncated or incomplete. No partial data was loaded. Please retry.')
      }
      characters += row.raw_value.length
    }
    progress()
    return data
  }
  const finishRecord = async first => {
    let part = first
    const parts = [first.raw_value]
    while (!part.complete) {
      const next = validate(await chunks([first.key], part.next_offset), [first.key], part.next_offset)[0]
      if (next.updated_at !== first.updated_at || next.total_chars !== first.total_chars) {
        throw Object.assign(new Error('A saved record changed in another tab while loading. Retry loading to use the complete latest version.'), { code: 'CLOUD_CHANGED' })
      }
      parts.push(next.raw_value); part = next
    }
    return { key: first.key, raw_value: parts.join(''), updated_at: first.updated_at }
  }
  const readGroup = async group => {
    let data
    try { data = await chunks(group, 0) }
    catch (error) {
      if (!transient(error) || signal?.aborted || group.length === 1) throw error
      const middle = Math.ceil(group.length / 2)
      return [...await readGroup(group.slice(0, middle)), ...await readGroup(group.slice(middle))]
    }
    validate(data, group, 0)
    const result = []
    for (const row of data) {
      try { result.push(await finishRecord(row)) }
      catch (error) {
        if (error.code !== 'CLOUD_CHANGED' || signal?.aborted) throw error
        const fresh = validate(await chunks([row.key], 0), [row.key], 0)[0]
        result.push(await finishRecord(fresh))
      }
    }
    return result
  }
  // A small fixed worker pool avoids dozens of serial round trips without
  // increasing the existing server-side 4-record / 256KiB response bounds.
  let cursor = 0, failure = null
  const worker = async () => {
    while (!failure && cursor < missing.length) {
      const start = cursor; cursor += 4
      try {
        const group = await readGroup(missing.slice(start, start + 4))
        if (failure) return
        rows.push(...group); loaded += group.length; progress()
      } catch (error) { failure ||= error }
    }
  }
  await Promise.all(Array.from({length: Math.min(4, Math.max(1, Math.floor(concurrency) || 1))}, worker))
  if (failure) throw failure
  if (signal?.aborted) throw cancelled()
  return rows
}
