# Notification-of-service calendar events

## Behavior

- Events created from a Notification of Service filing (and every other calendar event) are stored in `calendar_events`. Inside the creating window the month table, checklist, and matter timelines read that table, so a saved event appears in all three.
- Saving, deleting, completing, rescheduling, reactivating, or importing an event broadcasts a `calendar-changed` invalidation on the same-origin `mio-calendar-events-v321` channel. Messages contain no case data: an open window re-reads `calendar_events` from Supabase.
- A window that already shows the calendar re-reads the events when it receives that invalidation, and also when it regains focus or becomes visible again (throttled so moving between windows does not re-read constantly). No full page reload is required, so an event created in one window appears in another within a second or two.
- Calendar status filters only hide an event when the user de-selected that specific, known status value. A matter that is missing from the loaded matter list, or whose `case_status`/`matter_status` is blank, is never hidden by a filter; an incomplete record must not look like a deleted event.
- The calendar reports how many events in the visible month the Case/Matter status filters hide and offers **Show all events**. The Calendar's case and matter panels both support the `__all__` (every known status) selection used by that button.
- The default hide-closed behavior is unchanged: with no explicit selection, events for matters whose case status starts with "Closed" stay hidden until the user selects them.

## Verification

- `tests/calendar-event-filters.test.js` covers the status-filter rules (blank/missing status visible, explicit de-selection hidden, `None`, `__all__`, hidden-event counting).
- `tests/calendar-event-channel.test.js` covers same-origin delivery, one delivery per save, no case data in messages, throwing listeners, and browsers without `BroadcastChannel`.
- `tests/calendar-events-browser.mjs` runs the real bundled app against a synthetic account and proves: a blank-status matter's event survives a partial matter-status filter, the hidden-event notice counts and clears, a save in another window reaches an open calendar without reloading it, and creating an event through the app's own event window broadcasts to the other window.
- `.github/workflows/calendar-events-sync.yml` runs the unit suite, the production build, and both browser checks.

## Notes

- `src/mioCalendarEventFilters.js` holds the tested filter rules; `mio-v312-sticky-filters.js` no longer patches the calendar's status matching at build time.
- No database migration, dependency change, or production data change is required.
