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
