# Process Builder: first usable milestone

## Access after deployment

Open Settings → Process Builder. Choose **Use Need to Set example** or **Create process/page**. Click a card to configure it; drag cards to reposition. Connect using the bottom and top ports or the preceding-block selector. Save explicitly to the signed-in account. The example is not saved until Save process succeeds.

## Implemented

- Email, Calendar, Draft document, E-file/E-serve, and Save file cards.
- Activation and predecessor rules; step name/number; configured output/completion field.
- Email From, To, CC, subject/body, merge fields, attachments, review and reply controls.
- Existing drafting-template dropdown, field-mapping notes, format and review preferences.
- Filing versus service selection and document/case/recipient/payment references.
- Calendar mailbox, candidate dates, duration, buffers, timezone and busy-event preferences.
- File destination, folder reference, filename pattern and conflict preference.
- Per-state row messages, billing configuration, reusable saved definitions and duplication.
- Seven-block Need to Set example and isolated status simulator.
- Save acknowledgement and conflict handling through existing Supabase cloud storage; no new schema required for this milestone.

## Deliberate limits

This is the builder/configuration milestone, not the complete live workflow engine. It does not send email, query calendars, generate or save case documents, submit filings, create live custom navigation pages, or write billing entries. The simulator explicitly uses synthetic data and does not imply those actions occurred. Template field mappings are editable configuration text in this milestone, not executed bindings. Billing options are saved for the next integration stage.

Background Microsoft authorization, worker persistence/execution, provider adapters, and per-row integrations remain necessary for the full approved specification. Existing Withdrawals, Orders, and Need to Set pages are unchanged.

## Verification

- `node --test tests/*.test.js`: 291 passed, zero failed.
- `npx eslint lib/process src/process tests/process-*.test.js`: passed.
- `npm run build`: passed, existing bundle-size/plugin timing warnings remain.
- `CHROMIUM_PATH=/tmp/mio-chromium node tests/process-builder-browser.mjs`: passed in isolated fixture; all five block types, save/reload, send/reply/output/next-step transitions, keyboard move, rejected cycle, save-failure retention, narrow layout.
- Browser test uses real React builder components and a synthetic persistence endpoint. No real mail, court filing, account settings or case records were changed.

Native review only; independent subagent polish remains deferred per Ben's instruction. A live signed-in smoke check is still needed after authorized deployment. No production push or migration has occurred.
