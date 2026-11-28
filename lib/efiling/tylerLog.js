// Redacted, structured logging for the Tyler e-filing server paths (SERVER ONLY).
//
// Every server log line is a single JSON object carrying a correlation id and a
// named event. Values whose key looks like a secret are redacted, as are JWT,
// private-key and certificate strings, so no credential or client document
// content is written to logs. Keep all privileged calls server-side.
import { randomUUID } from 'node:crypto'

const SECRET_KEY = /(private|key|secret|token|certificate|password|authorization|apikey|api_key)/i

export function newTylerCorrelationId() {
  return randomUUID()
}

export function redactTylerValue(value) {
  if (value == null) return value
  if (typeof value !== 'string') return value
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return '[redacted:private-key]'
  if (/-----BEGIN CERTIFICATE-----/.test(value)) return '[redacted:certificate]'
  if (/^eyJ[A-Za-z0-9._-]{20,}/.test(value)) return '[redacted:jwt]'
  return value
}

function sanitizeTyler(data) {
  if (data == null) return undefined
  if (typeof data !== 'object') return redactTylerValue(data)
  const out = {}
  for (const [key, value] of Object.entries(data)) {
    out[key] = SECRET_KEY.test(key)
      ? '[redacted]'
      : (value && typeof value === 'object' ? sanitizeTyler(value) : redactTylerValue(value))
  }
  return out
}

export function createTylerLogger({ log = console, correlationId } = {}) {
  const cid = correlationId || newTylerCorrelationId()
  const emit = (writer, level, event, data) => {
    const line = { level, correlationId: cid, event, ...sanitizeTyler(data) }
    writer(JSON.stringify(line))
  }
  return {
    correlationId: cid,
    info(event, data) { emit(log.log ? log.log.bind(log) : log.info.bind(log), 'info', event, data) },
    error(event, error) {
      emit(log.error ? log.error.bind(log) : log.log.bind(log), 'error', event, { message: error?.message || String(error) })
    },
  }
}
