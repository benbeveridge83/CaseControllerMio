# Tyler ECF5: X.509 signing identity and callback trust prerequisites

## Implemented

`lib/efiling/tylerX509Readiness.js` checks **server-only** prerequisites:
- An X.509 PEM certificate matches an explicitly approved SHA-256 certificate fingerprint.
- The current clock is within its validity period.
- A server-held RSA private key matches the certificate public key, demonstrated with a fresh random SHA-256 challenge.
- RSA modulus is at least 2048 bits.
- The Stage or Production environment is explicit.
- The callback response certificate is present in an environment-specific allowlist and is unexpired.

The module **does not** log, persist, return, or export signing keys, signatures, or raw certificate contents. The optional certificate pin must be supplied by server configuration after independent verification; it must never be inferred from an untrusted SOAP message.

`tests/tyler-x509-signing-readiness.test.js` generates two ephemeral, self-signed *synthetic* certificates, exercises good and bad keys, mismatched pins, and expiry, and confirms that a trusted-looking certificate never amounts to a verified XML signature.

## Critical limits

These helpers do **not**:
- Produce an XMLDSIG signature, XML canonicalization, or signed SOAP envelope.
- Verify the digest or cryptographic signature covering the SOAP Body and Timestamp.
- Validate a trusted CA chain, key usage, revocation, sender identity, or Tyler Stage-approved algorithms.
- Perform replay detection or Stage credential handshakes.
- Enable a POST to `/api/tyler-efm-callback` or any Tyler transmission.

`keyReady:true` is deliberately distinct from `xmlSignatureReady:false` and `transportReady:false`. The similarly named incoming-response readiness function returns `trustVerified:false` even when a certificate pin matches, because XML signature verification has not happened.

## Remaining independent engineering

1. Select/review an XMLDSIG library supporting the exact Stage-required WS-Security reference canonicalization and inclusive namespace rules. Integrate it **server-side**.
2. Produce outgoing XMLDSIG over SOAP Body and Timestamp using X.509 references. Verify signed fixtures with an independent verifier.
3. Complete the incoming XMLDSIG verification path including actual certificate trust, signed message-to-body binding, replay store and rejection of weak algorithms.
4. Connect to the duplicate-protected outbox only after schema validation and Tyler's Stage credential/endpoint configuration is confirmed.

The current development must remain fail-closed. These files do not change billing, trust accounting, court filings or existing user workflows.
