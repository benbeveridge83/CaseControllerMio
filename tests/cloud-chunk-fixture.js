// Synthetic implementation of the read-only SQL contract, for tests only.
export function chunkRows(rows, p) {
  return rows.filter(row => row.user_id === p.p_user_id && p.p_keys.includes(row.key))
    .sort((a,b) => a.key.localeCompare(b.key)).map(row => {
      const raw = row.raw_value != null ? String(row.raw_value) : typeof row.json_value === 'string' ? row.json_value : JSON.stringify(row.json_value ?? null)
      const chars = Array.from(raw)
      const fragment = chars.slice(p.p_offset, p.p_offset + Math.min(p.p_chunk_chars, Math.floor(262144 / p.p_keys.length))).join('')
      const next = p.p_offset + Array.from(fragment).length
      return {key:row.key,raw_value:fragment,updated_at:row.updated_at,chunk_offset:p.p_offset,next_offset:next,total_chars:chars.length,complete:next===chars.length}
    })
}
