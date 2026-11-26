# ECF5 existing civil FilingMessage composition (unsigned)

Source checked against the original user-provided Tyler package in OneDrive,
`EFM Documentation - v2026.2.2 - ECF5 - 7-9-2026.zip`:
- `Artifacts/Sample Messages/filingreviewmde/reviewfiling/tyler-subsequent-civil-filingmessage.xml`
- `Artifacts/Sample Messages/filingreviewmde/reviewfiling/tyler-paymentmessage.xml`
- `Artifacts/Schema/filing.xsd`, `payment.xsd`, and `extension/common.xsd`

## What was implemented
- `tylerSubsequentCivilMessage.js`: synthesizes a complete **structural** `filing:FilingMessage` for one lead filing and connected documents, reproducing the sample ordering and NIEM references: `Filing1`, `Party1`, `Attorney1`, `Document1...` plus e-service `Recipient1...`.
- Case relationships use `j:CaseAugmentation` before `ecf:CaseAugmentation`, case tracking, participant IDs, court ID, category/type codes, and existing-case indicator `false`.
- PDFs come through `tylerDocumentRendition.js` and are checked against size and SHA-256 before inclusion; connected documents refer to the lead by `nc:PrimaryDocument structures:ref='Filing1'`.
- `tylerPaymentMessage.js`: constructs the separate payment message using the reviewed Tyler Stage `PaymentID`, a server-verified fee quote and the user's explicit fee cap. It never accesses bank details or initiates a charge.
- `tests/tyler-ecf5-existing-case-message.test.js`: checks structural reference graph, attachment links, payment caps, service recipients, negative cases, and composition into `ReviewFilingRequest`.

## Important schema-validation finding
The official Tyler example `tyler-paymentmessage.xml` validates against the package's `payment.xsd`.
However, the official `tyler-subsequent-civil-filingmessage.xml` **does not** validate as-is against the standalone `filing.xsd`: the validator reports six unexpected Tyler augmentation elements (including electronic service, document and filing message augmentations). Those extensions are central to the sample. They may require the Tyler extension schema and NIEM augmentation machinery and/or validation configuration confirmed by Tyler; do **not** falsely claim this serializer is schema-validated merely because it resembles the vendor sample.

## Remaining prerequisites to actual submission
1. Resolve extension-aware XSD validation with Tyler and prove the generated XML is valid against the correct complete schema set, including cross-reference rules.
2. Map and reconcile genuine Tyler Stage case, court, party, attorney, document type, filing and service codes; handle optional service, multiple parties and initial filing separately.
3. Retrieve authorized PDF bytes from the matter document store, verify trusted metadata/page counts and enforce a full message-size budget.
4. Confirm the payment message format, live fee quote provenance, fee-waiver / payment means nuances and TOGA account configuration with Tyler.
5. Sign outgoing SOAP with trusted WS-Security / XMLDSIG X.509 and verify signed responses; connect server-side transport and durable outbox.
6. Finish signed callback acceptance, status updates, stamped documents and OCA certification.

All generated messages explicitly return `signed:false`, `schemaValidated:false`,
and `transportReady:false`. The existing mock provider remains the only
usable filing interface. No real Tyler submission, payment, or callback
acknowledgment has been enabled by these changes.
