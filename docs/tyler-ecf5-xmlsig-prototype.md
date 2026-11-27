# Tyler ECF5 XMLDSIG — offline cryptographic prototype

## Scope

`scripts/tyler_xmlsig_prototype.py` is an **isolated** Python proof of a real cryptographic SOAP signature using `signxml==5.1.0`, `lxml` and `cryptography`.

It signs **two exact elements** inside a SOAP 1.1 envelope, using X.509 RSA-SHA256 and exclusive XML canonicalization:

- The top-level `soap:Body` with its unique `wsu:Id`
- The `wsu:Timestamp` in the sole `wsse:Security` header, with its unique `wsu:Id`

The resulting `ds:Signature` lives inside `wsse:Security`. Verification requires:
- A separately trusted certificate supplied outside of the message (never trusting the certificate embedded in an incoming payload)
- Exactly two signature references bound to the verified `soap:Body` and `wsu:Timestamp`
- RSA-SHA256 and SHA-256 digests
- Successful cryptographic verification of both references against the trusted certificate
- Certificate validity and timestamp/skew checks
- No DTDs, network XML fetches, duplicate `wsu:Id` values, multiple Body/Header, or misplaced signature

**The verifier returns the *verified signed body node*, not a raw unverified body**. This prevents the application from accidentally processing a different, unsigned message.

## Synthetic regression tests

`tests/tyler_xmlsig_prototype_test.py` creates short-lived in-memory RSA keys/certificates and tests:
- Genuine sign + verify round trip (two signed references)
- Tampering with the signed filing body
- Tampering with the signed timestamp
- Wrong independently trusted certificate
- Expired timestamp
- Absent or duplicate Body ID
- Unsigned request, DTD injection

Run in GitHub Actions using `signxml==5.1.0`. No real user certificates, payment details, private client documents, or Tyler Stage endpoints are involved.

## Remaining security blockers

This is **not** a production signing provider and is **not** wired into the live Vercel JavaScript runtime, the durable submission outbox, or the public Tyler callback endpoint. No submission and no signed callback acknowledgment can occur.

Before using real Tyler communications:
1. Confirm Tyler's approved inclusive namespace and canonicalization rules, token references, signing algorithms, acceptable cert chain and SOAP action with authenticated Stage fixtures.
2. Build or select a reviewed server-side production XMLDSIG implementation compatible with Mio's Vercel runtime. Avoid shelling out to Python with private keys.
3. Protect certificate trust anchor provisioning, key rotation, and signed-message replay prevention with a durable storage boundary.
4. Verify callback signatures against approved Tyler Stage certificate(s), validate the actual signed Body content, match the outbound envelope and filing IDs, and persist status before acknowledging.
5. Complete Tyler Stage/OCA certification and keep production feature flags disabled until approval.

### Release safeguards
No network transport enabled. No secrets stored in source. Billing/trust code untouched.
