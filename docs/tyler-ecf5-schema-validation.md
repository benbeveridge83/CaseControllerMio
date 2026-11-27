# Tyler ECF5 extension-aware offline validation

**Status: diagnostic only.** This is not integrated schema certification or authority to file. The live Tyler submission/callback gates remain off.

## Source of truth
Tested against the user's original Tyler package,
`EFM Documentation - v2026.2.2 - ECF5 - 7-9-2026.zip`, in the connected OneDrive `efile protocol` directory.
The following files are inside `Artifacts/Schema/`:
- `filing.xsd`: standard ECF5 FilingMessage grammar
- `extension/common.xsd`: Tyler augmentation element declarations
- `payment.xsd`: PaymentMessage grammar
- `xmlsig/xmldsig-core-schema.xsd`: packaged signature schema

The package's `policyresponse.xsd` imports an external `xmldsig-core-schema.xsd` URL. We resolve **that exact URL** to the bundled schema using a local XML resolver. Network access, DTD processing and external entity resolution are disabled.

## Verified vendor fixtures (offline)
- `Artifacts/Sample Messages/filingreviewmde/reviewfiling/tyler-subsequent-civil-filingmessage.xml`
- `Artifacts/Sample Messages/filingreviewmde/reviewfiling/tyler-paymentmessage.xml`

The raw vendor filing sample fails the standalone `filing.xsd` because of six Tyler augmentation nodes. The supplied `extension/common.xsd` validates **all six augmentation subtrees separately**. When the six approved nodes are removed in a **copy only**, the remaining filing passes `filing.xsd`. The original tree has no dangling or duplicate NIEM `structures:id/ref` values. Tyler's payment sample passes `payment.xsd`.

This two-part validation is a **diagnostic profile**, not evidence that the whole original document is valid against a single fully integrated vendor schema. Local `scripts/validate_tyler_ecf5.py` reports its profile expressly.

## Run against an authorized local copy of Tyler's package
Extract the ZIP (do not commit the proprietary vendor package, schemas, or sample court materials) and run:

```bash
python3 -m pip install lxml==6.0.2
python3 scripts/validate_tyler_ecf5.py \
  --schema-root "/path/to/Artifacts/Schema" \
  --filing "/path/to/tyler-subsequent-civil-filingmessage.xml" \
  --payment "/path/to/tyler-paymentmessage.xml"
```

The command prints JSON with specific schema errors and exits nonzero on failure.
`tests/tyler_ecf5_schema_validation_test.py` uses self-contained synthetic schemas (not copyrighted Tyler samples), including tests that reject unfamiliar extensions, invalid augmentation payloads, dangling NIEM references and XML DTDs. GitHub Actions runs these tests without access to the user's private EFM package.

## Next work / blockers
1. Apply the diagnostic to **Mio-generated** FilingMessage and PaymentMessage XML and fix deviations from the vendor sample. Synthetic unit tests alone do not certify generated XML.
2. Confirm Tyler's endorsed integrated XSD validation strategy and schema version in Stage. Do not silently strip extension nodes from the payload sent to Tyler.
3. Build WS-Security X.509 XMLDSIG generation and trusted-signature verification with pinned or validated issuer, reference and digest checks, timestamps, replay cache and signed vendor examples. `Signature` tag presence is never proof of authenticity.
4. Integrate verified signing/receipt into the durable outbox only after Stage credentials and test fixtures are available. Keep all production filing disabled.
