# ECF5 subsequent-civil mapping — November 25, 2026

Reference source, inspected directly from connected OneDrive:
`efile protocol/Integration Documentation/EFM Documentation/EFM Documentation - v2026.2.2 - ECF5 - 7-9-2026.zip`, particularly:
- `Artifacts/Sample Messages/filingreviewmde/reviewfiling/tyler-subsequent-civil-filingmessage.xml`
- `Artifacts/Sample Messages/filingreviewmde/reviewfiling/tyler-initial-civil-filingmessage.xml`
- `Artifacts/Sample Messages/filingreviewmde/reviewfiling/tyler-paymentmessage.xml`
- `Artifacts/Schema/filing.xsd` and `payment.xsd`

## Implemented mapping contract
`tylerSubsequentCivilMapper.js` prepares an immutable, signed-off-stage-only mapping for an **existing civil case**. It rejects:
- Missing real Tyler identifiers for court, case tracking, party, attorney, filing code, payment means
- Production requests or initial-case requests
- E-File Only with e-service recipients, and e-service without real Tyler ServiceContactID and service type codes
- PDF documents missing metadata, source object reference or SHA-256 digest
- Invalid fee authorization, duplicate recipients and oversized attachment lists

It maps the source sample's `j:CaseCourt`, `ecf:CaseTrackingID`,
`ecf:CaseCategoryCode`, `ecf:CaseTypeCode`, `tyler:FilingParty`,
`tyler:FilingAttorney`, `tyler:ServiceContactID`,
`ecf:RegisterActionDescriptionCode`, `tyler:FilingComponentCode`,
`tyler:OriginalFileName`, `tyler:PageCount`, `cac:PaymentMeans/cbc:PaymentID`
to explicit, validated fields.

`tylerDocumentRendition.js` checks actual PDF buffer header, exact size,
SHA-256, redaction flag, page count and filename before preparing a
`ecf:DocumentRendition` with a Base64 body. No user PDF bytes are persisted
or logged by this mapper. It does not attempt to determine page count from the
PDF; that remains a required trusted input.

These pure preparation helpers **DO NOT** produce a complete
`filing:FilingMessage` or `payment:PaymentMessage`, do not
perform XSD validation or signed SOAP transport, and do not enable live filing.

## Specific remaining implementation work
1. Full case entity relationships, correct `structures:id` /
   `structures:ref` crosslinks, lead and connected document wrappers, filing
   association, billing party, e-service recipient mapping and accepted case
   type codes from Stage / GetFilingCodes.
2. PaymentMessage / TOGA account mapping, live fee quote confirmation, waiver
   and fee caps; never infer payment IDs from Mio internal trust account IDs.
3. Validate generated XML with Tyler's ECF5 schema dependency graph and
   server-side XML security safeguards. Test with Stage responses.
4. Implement WS-Security signing, certificate trust verification and secure
   server transport, then integrate with the durable outbox.
5. Only then activate callback signature verification and Stage tests.

## Deployment safety
No HTTP endpoint, filing-status mutation, service-role credentials, or
existing billing / trust code was touched. No production filing can be sent
by these functions.
