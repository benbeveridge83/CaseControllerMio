# Tyler ECF5: Outbound and signed callback integration — working handoff

## Verified existing foundation
- Mio's Filings tab prepares an E-Filing draft, validates it, and uses a **mock provider**.
- The read-only history widget queries Mio's Supabase `mio_efiling_submissions` and `mio_efiling_status_audit` by signed-in owner and matter.
- The callback endpoint is reserved at `/api/tyler-efm-callback`, but POST remains HTTP 503. This is deliberate: no court result can be acknowledged without trusted processing.
- Tyler's ECF5 documentation identifies `NotifyFilingReviewComplete` (Filing Assembly MDE) as the per-filing SOAP callback. Separate SignalR in-app messages are not this callback.

## This implementation
- `lib/efiling/tylerOutboundPipeline.js`: validates a filing intent, produces a deterministic request fingerprint, and requires a durable once-only network reservation. Timeouts are considered **uncertain**, never auto-retried.
- `lib/efiling/tylerSubmissionRegistrar.js`: server-side RPC adapter to associate real Tyler envelope/filing IDs with the original Mio owner and matter.
- `lib/efiling/tylerWsSecurityInspection.js`: strictly preliminary SOAP envelope/timestamp/structure checks. **Never produces a cryptographically verified result**; it cannot authorize a callback.
- `tests/tyler-outbound-pipeline.test.js`: tests negative cases, duplicate reservations, successful mock transport injection, ambiguous delivery, DB adapter, malformed SOAP.
- **No live network transport or signing key** is configured; the guarded coordinator is not wired to a browser action.

## Release gates / remaining tasks
1. **Outbound SOAP mapping** — implement vendor ECF5 `ReviewFiling` request/response from WSDL + schema, including service recipient selections, case IDs, filing codes, documents, filing fees, and TOGA payment configuration. Establish Tyler endpoints per environment from TCP. Do not send partial or mock envelopes to Tyler.
2. **Server-side identity and durable queue** — require authenticated Mio actor/matter ownership and a transactional outbox/reservation keyed by request ID, with a reconciliation path for ambiguous timeouts. Existing database RPC registers only *confirmed* vendor IDs; it is not a network outbox.
3. **XMLDSIG/WS-Security** — implement actual digest and reference verification, canonicalization, X.509 trust chain/pinned sender identity, signed timestamps, replay rejection, and algorithm restrictions. Test with signed Tyler Stage fixtures. Merely finding a `Signature` XML tag is not authentication.
4. **Callback HTTP transport** — verify Tyler identity, parse NFRC, confirm outbound ownership, derive accepted/rejected result from authenticated real Stage fixtures, write atomically, then send the exact SOAP acknowledgment. Reject unsigned/unknown/uncorrelated messages. Never switch POST to 2xx before this passes.
5. **Court documents and fees** — reconcile accepted/rejected outcomes, stamped copies, receipts, e-service recipients/returns and attorney-facing notifications. Keep user-facing status source of truth in Supabase.
6. **Tyler Stage and OCA certification** — wait for Kathy Cui to restore Integrator Stage access, confirm review tool / TOGA activation, execute OCA diagnostic and certification test cases, then authorize production.

## No-impact assurance
The new modules do not import the existing trust, billing, payment, or Mio cloud data modules; no live filing actions have been enabled.
