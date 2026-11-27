# Tyler ECF5 — actual Mio-generated XML validation, November 26, 2026

The official package `EFM Documentation - v2026.2.2 - ECF5 - 7-9-2026.zip` remains in the user's connected OneDrive and must **not** be committed to GitHub.

## Actual outputs checked

`scripts/emit_tyler_ecf5_fixture.mjs` uses the real Mio ECF5 JavaScript mappers/serializers and creates **only synthetic** XML. The workflow saves a one-day artifact named `synthetic-tyler-xml`. Using the original Tyler schemas locally, the following checks were run:

| Generated file | Tyler validation | Findings |
| --- | --- | --- |
| generated-filing.xml — subsequent civil, E-File Only, 1 PDF | Base `filing.xsd` + separately validated Tyler `extension/common.xsd` augmentations + NIEM IDs/refs | PASS; 3 extension blocks, no reference issues |
| generated-service-and-exhibit.xml — subsequent civil, E-File & Serve, 2 PDFs | Same two-part extension diagnostic | PASS; 5 extension blocks, no reference issues |
| generated-payment.xml — synthetic fee and payment account | Tyler `payment.xsd` | PASS |

This extends the earlier validation of **Tyler's own supplied examples** to **Mio-generated XML**.

### Qualification

These are synthetic filing messages produced by the app. Neither Tyler's Stage service nor an approved integrated schema validator has approved them. The two-part diagnostic strips *copies* of approved Tyler augmentations for base validation, then validates each augmentation separately. It **never changes the XML that would be submitted**. Cross-namespace integrated content models and real local Tyler code correctness still require verification.

### Repeat locally

```sh
node scripts/emit_tyler_ecf5_fixture.mjs ./synthetic-efm-artifacts
python3 scripts/validate_tyler_ecf5.py --schema-root "/private/path/to/Artifacts/Schema" --filing ./synthetic-efm-artifacts/generated-filing.xml --payment ./synthetic-efm-artifacts/generated-payment.xml
python3 scripts/validate_tyler_ecf5.py --schema-root "/private/path/to/Artifacts/Schema" --filing ./synthetic-efm-artifacts/generated-service-and-exhibit.xml --payment ./synthetic-efm-artifacts/generated-payment.xml
```

No client data or real certificate/private key is used or printed.

## WS-Security

`lib/efiling/tylerXmlDsigReferencePolicy.js` adds pre-cryptographic SOAP wrapping checks for signature references bound to the SOAP body and signed timestamp, with fail-closed rejection for duplicate IDs, external references, missing IDs and SHA-1 algorithms.

**Not implemented:** actual XML canonicalization, reference digest verification, RSA/ECDSA verification, X.509 certificate-chain validation or pinned issuer, certificate expiry, signed timestamp binding to canonicalization, replay persistence or signing outbound SOAP. The new policy **always** reports `cryptographicallyVerified:false`, `trustedIssuer:false`, `transportReady:false`.

**Security gate remains closed.** Neither outgoing submissions nor incoming callback acknowledgments are enabled.

## Next engineering steps

1. Obtain/confirm Tyler-approved SOAP WS-Security algorithms, exact signing scope and Stage fixture with valid X.509 signature.
2. Integrate an independently maintained XMLDSIG verifier and signer; prohibit algorithm downgrade and XML signature wrapping.
3. Bind trust to Kathy Sui's approved Tyler signing certificate(s) / Stage trust anchors and a durable replay cache. Do not expose private keys to browser code.
4. Validate generated XML against an integrated extension-aware schema set if Tyler provides one and run authenticated Stage tests.
5. Connect the verified signer/transport to Mio's durable outbox and the signed NFRC callback processor after OCA review.
