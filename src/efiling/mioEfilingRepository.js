// E-Filing draft persistence plan. The in-memory repository works immediately and
// is used by unit tests and the mock workflow. The Supabase repository targets the
// public.mio_efiling_drafts table + mio_save_efiling_draft_v1 RPC introduced by
// supabase/migrations/*_efiling_drafts_v1.sql. It is intentionally not called
// until that migration is applied.

import { efilingId } from './mioEfilingModel.js'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function createInMemoryEfilingRepository() {
  const drafts = new Map()
  const events = []
  return {
    mode: 'memory',
    async saveDraft(ownerId, draft, eventType = 'draft_saved') {
      const now = new Date().toISOString()
      const record = { ...clone(draft || {}), id: draft?.id || efilingId('draft'), ownerId, updatedAt: now }
      if (!record.createdAt) record.createdAt = now
      drafts.set(record.id, record)
      await this.recordEvent(ownerId, draft?.matterId || '', record.id, eventType, { draftId: record.id })
      return record
    },
    async getDraft(ownerId, draftId) {
      const record = drafts.get(String(draftId))
      return record && record.ownerId === ownerId ? clone(record) : null
    },
    async listDrafts(ownerId, matterId = '') {
      return [...drafts.values()]
        .filter((record) => record.ownerId === ownerId && (!matterId || record.matterId === matterId))
        .map(clone)
    },
    async recordEvent(ownerId, matterId, draftId, eventType, event = {}) {
      const entry = {
        id: efilingId('event'),
        ownerId,
        matterId: String(matterId || ''),
        draftId: String(draftId || ''),
        eventType: String(eventType || ''),
        event: clone(event || {}),
        recordedAt: new Date().toISOString(),
      }
      events.push(entry)
      return entry
    },
    async listEvents(ownerId, matterId = '') {
      return events
        .filter((entry) => entry.ownerId === ownerId && (!matterId || entry.matterId === matterId))
        .map(clone)
    },
  }
}

// Maps an e-filing activity event to a row compatible with the existing
// public.calendar_events timeline so drafts and validations can appear in the
// Matter Timelines view without a second, parallel timeline concept.
export function efilingEventToTimelineRow(event = {}) {
  const today = new Date().toISOString().slice(0, 10)
  const labels = {
    efiling_draft_created: 'E-filing draft created',
    efiling_draft_saved: 'E-filing draft saved',
    efiling_draft_validated: 'E-filing draft validated',
    efiling_ready: 'E-filing marked ready',
  }
  return {
    id: event.id,
    matter_id: event.matterId || '',
    event_category: 'E-Filing',
    event_subcategory: event.eventType || '',
    title: labels[event.eventType] || 'E-filing activity',
    start_date: today,
    start_time: '',
    end_date: today,
    end_time: '',
    description: '',
    is_active: true,
  }
}

export function createSupabaseEfilingRepository(client, options = {}) {
  const rpcName = options.rpcName || 'mio_save_efiling_draft_v1'
  return {
    mode: 'supabase',
    async saveDraft(ownerId, draft, eventType = 'draft_saved') {
      if (!client?.rpc) throw new Error('E-filing Supabase repository requires a Supabase client.')
      const { data, error } = await client.rpc(rpcName, {
        p_owner_id: ownerId,
        p_draft_id: draft?.id || null,
        p_matter_id: draft?.matterId || null,
        p_expected_revision: Number(draft?.revision || 0),
        p_draft: draft || {},
        p_event_type: eventType,
        p_event: { draftId: draft?.id || '' },
      })
      if (error) throw new Error(error.message || 'E-filing draft save failed.')
      return data
    },
    async getDraft(ownerId, draftId) {
      if (!client) throw new Error('E-filing Supabase repository requires a Supabase client.')
      const { data, error } = await client
        .from('mio_efiling_drafts')
        .select('*')
        .eq('owner_id', ownerId)
        .eq('id', draftId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? { ...(data.draft || {}), id: data.id, revision: data.revision } : null
    },
    async listDrafts(ownerId, matterId = '') {
      if (!client) throw new Error('E-filing Supabase repository requires a Supabase client.')
      let query = client.from('mio_efiling_drafts').select('*').eq('owner_id', ownerId)
      if (matterId) query = query.eq('matter_id', matterId)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data || []).map((row) => ({ ...(row.draft || {}), id: row.id, revision: row.revision }))
    },
    async recordEvent(ownerId, matterId, draftId, eventType, event = {}) {
      if (!client) throw new Error('E-filing Supabase repository requires a Supabase client.')
      const { data, error } = await client.from('mio_efiling_events').insert({
        owner_id: ownerId,
        matter_id: matterId,
        draft_id: draftId,
        event_type: eventType,
        event,
      }).select().single()
      if (error) throw new Error(error.message)
      return data
    },
    async listEvents(ownerId, matterId = '') {
      if (!client) throw new Error('E-filing Supabase repository requires a Supabase client.')
      let query = client.from('mio_efiling_events').select('*').eq('owner_id', ownerId)
      if (matterId) query = query.eq('matter_id', matterId)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data || []
    },
  }
}
