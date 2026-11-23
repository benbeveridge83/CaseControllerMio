# Tyler EFM callback: engineering status

## Scope
The Case Controller Mio Vercel application now has a reserved API route at
`/api/tyler-efm-callback`. The code is **not** a complete Tyler EFM callback
implementation. It is intentionally fail-closed and **MUST NOT** be provided
to Tyler as a functioning callback or used to request Stage activation.

- GET returns a non-sensitive readiness document with
  `acceptsNotifications:false`.
- POST always returns HTTP 503 and never logs, stores, parses, or acknowledges
  untrusted filing data.
- Unsupported methods return 405.
- No signing certificate, private key, or payment credentials are embedded.

## Blocking Tyler specification
Before enabling POST acceptance, obtain and review the applicable official
Tyler EFM/ECF5 integration callback contract, including:

1. Callback method(s), content-type, XML/SOAP schema, SOAPAction if any,
   endpoint identity expectations, and acknowledgment/response messages.
2. Authentication mechanism (TLS/mTLS, WS-Security/X.509 signatures,
   signing algorithms, certificate chain), sender authentication and
   certificate rotation. Do not substitute a custom HMAC unless Tyler
   explicitly documents it.
3. Required correlators (envelope, filing, external case IDs) and
   authorization to the Mio tenant/matter; define ownership through the
   original outbound submission, never from an unauthenticated callback.
4. Idempotency/replay rules, duplicate delivery, event ordering, retry timing,
   and timeout policies.
5. Persistence and transaction rules, including how to record raw-event
   provenance safely, filing status, error/rejection details, audit trail,
   sealed-document handling, and stamped-document retrieval.
6. Stage test messages and the Phase I/II verification checklist.

## Release gate
Do not enable receipt processing or advertise the endpoint to Kathy Cui until:
- Tyler protocol and signer validation tests pass with authentic Stage fixtures;
- each callback is correlated to a previously created authorized filing;
- persistence/updates are atomic and idempotent, and tenancy boundaries tested;
- all service-role credentials reside only in server-side secret storage;
- the deployment is reachable without Vercel SSO or password gates;
- retry/ack behavior matches Tyler's specification.

## Tests
Run `node --test tests/tyler-efm-callback.test.js`.

## Existing architecture
The UI provider at `src/efiling/mioEfilingProvider.js` still defines
`createTylerEfilingProvider` as a disabled stub. The pre-existing
`supabase/migrations/20261002130000_efiling_drafts_v1.sql` covers drafts and
activity but is not a verified callback-specific durable event inbox.
The route is rewritten through the existing `/api/auth/callback.js` Vercel function to avoid exceeding the 12-function Hobby-plan limit. The guarded handler is at `lib/efiling/tylerCallbackGateway.js`. No real Tyler submission or notification processing is enabled by this change.


## ECF5 source review (Tyler package v2026.2.2, 9 July 2026)
Sources read directly from the user's OneDrive `efile protocol/Integration Documentation/EFM Documentation` ZIP:
- `OFS EFSP Specification.pdf`: Chapter "Process #5: Notification" explicitly states the EFM calls `NotifyFilingReviewComplete` once for **each filing**, not once per envelope. Calls from EFM use retry on failure and eventually an exception queue.
- `Artifacts/Schema/wsi/schema/FilingAssemblyMDE.wsdl`: SOAP 1.1 document/literal operation `NotifyFilingReviewComplete` with action
  `https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0WSDL/FilingAssemblyMDE/NotifyFilingReviewComplete`.
  The service declares an X.509 token and WS-Security policy; the service implementation WSDL contains a placeholder localhost URL.
- `Artifacts/Schema/reviewfilingcallback.xsd` and
  `Artifacts/Sample Messages/filingassemblymde/notifyfilingreviewcomplete/tyler-reviewfilingcallbackrequest.xml`: wrapper `NotifyFilingReviewCompleteRequest` contains a `NotifyFilingReviewCompleteMessage`, a messageID, an envelopeID and a lead filingID under `ReviewedDocument`.
- `In App Notifications Specification.pdf` describes a **different** SignalR service for court-to-filer app messages; it is NOT a substitute for the ECF5 filing-review callback.

Code:
- `lib/efiling/tylerNfrcContract.js` parses the documented three identifiers and completion metadata from XML fixture inputs. It deliberately does **not** infer an accepted/rejected state from the sample because that example does not expose a definitive status code.
- `tests/tyler-ecf5-nfrc-contract.test.js` tests a synthetic namespace-correct request, SOAP 1.1 wrapping, and invalid input. No copyrighted sample messages were committed.

Remaining before enabling callback:
1. Confirm Tyler's **inbound** WS-Security signature/trust-chain requirements and a signed sample request; never trust merely the presence of an XML signature tag.
2. Confirm whether the Stage EFM sends MTOM attachments, inline documents, or URL downloads to this callback and the maximum payload sizes.
3. Verify how accepted/rejected status is encoded in **real Stage messages**, and test with actual accepted and rejected notifications.
4. Specify and implement SOAP response `NotifyFilingReviewCompleteResponse` / MessageStatus, idempotent receipt and retry behavior.
5. Persist outbound-to-inbound message correlation and tenant ownership; only then update filing status in a transaction.
6. Run integration and certification tests in Tyler Stage. Keep POST fail-closed until all above have passed.

**Do not supply the current URL to Tyler for Stage activation yet.** The gateway returns 503 to POST, by design.
