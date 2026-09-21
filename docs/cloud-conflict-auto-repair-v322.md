# Cloud save conflicts

Two-tab writes no longer interrupt the user when nothing is at risk. The strict
stop-and-ask behavior is kept for any genuine clash between two edits.

## Behavior

- A rejected write (`PT409`/`40001`) first re-reads the record. If the cloud already
  holds exactly the value this window intended, the write is treated as complete:
  nothing is written, no conflict is recorded, and no notice is shown.
- If both values are JSON arrays of records with unique `id`/`uuid`/`key` fields, a
  three-way merge against the version this window loaded is written instead. A merge is
  only used when **every** difference belongs to exactly one side: an unchanged row takes
  the other tab's copy, a row only one tab added is kept, and a deletion on one side is
  honored. Rows added by each tab therefore survive, and the user is not asked.
- Every other case still stops and asks: the same row changed in both tabs, an edit
  racing a deletion, a reordered list, duplicate or missing identifiers, and non-array
  values. The pending edit is kept in RAM, the winning cloud value is never overwritten,
  and `Preserve my edits and reload` still stores a verified recovery copy first.
- A merged write marks the record as requiring a refresh. `status().reloadRequired`
  becomes true, `stage()` rejects stale component writes for that record until the window
  reloads, and the reload path in `mioCloudSync` refreshes the window when it is clean.
  A silent merge can therefore never be overwritten by a form that did not see it.
- `saveNow()` accepts a merged key as a completed save, because the caller's own rows are
  part of the merged value.
- Display preferences (`caseMioStickyFilter:*`, expanded rows, column widths) keep their
  existing bounded rebasing through `mioStickyValues.rebaseFilterValue`.

## Verification

Run `node --test tests/*.test.js` and `npm run build`.

- `tests/cloud-conflict-repair.test.js` covers: the already-stored value, a completed
  deletion, independent rows added by two tabs, a deletion surviving a local addition,
  duplicate/missing identifiers, reordered lists, non-array values, the same row edited
  twice, an edit racing a deletion, the refresh lock on a merged record, and the
  preserved recovery copy.
- `tests/cloud-storage.test.js` covers two tabs sharing one backend: preference merging,
  independent record rows merging, and the same row still conflicting.

No database migration, production data change, or dependency change is required.
