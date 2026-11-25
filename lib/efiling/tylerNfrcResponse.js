// Response structure derived from Tyler ECF5 wrappers.xsd and tyler-messagestatus.xml.
// This function ONLY serializes a response. It does not authenticate or acknowledge
// an inbound request; the live gateway remains fail-closed pending Stage verification.
function escapeXml(input) {
 return String(input).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
}
export function buildTylerNfrcSoapAcknowledgment({messageId, timestamp = new Date().toISOString()} = {}) {
 if (typeof messageId !== 'string' || !messageId.trim() || messageId.length > 256) throw new Error('Original message ID required')
 if (!Number.isFinite(Date.parse(timestamp))) throw new Error('Valid timestamp required')
 return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body><w:NotifyFilingReviewCompleteResponse
xmlns:w="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/wrappers"
xmlns:cbrn="http://release.niem.gov/niem/domains/cbrn/4.1/"
xmlns:ecf="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf"
xmlns:nc="http://release.niem.gov/niem/niem-core/4.0/">
<cbrn:MessageStatus cbrn:systemSimulatedIndicator="false">
<cbrn:SystemEventDateTime>${escapeXml(timestamp)}</cbrn:SystemEventDateTime>
<cbrn:SystemOperatingModeCode>Ops</cbrn:SystemOperatingModeCode>
<cbrn:CredentialsAuthenticatedCode>Authenticated</cbrn:CredentialsAuthenticatedCode>
<cbrn:MessageStatusCode>Success</cbrn:MessageStatusCode>
<cbrn:MessageHandlingError><cbrn:ErrorCodeText>0</cbrn:ErrorCodeText></cbrn:MessageHandlingError>
<cbrn:ResendRequestIndicator>false</cbrn:ResendRequestIndicator>
<ecf:MessageStatusAugmentation><nc:DocumentIdentification>
<nc:IdentificationID>${escapeXml(messageId)}</nc:IdentificationID>
<nc:IdentificationCategoryDescriptionText>messageID</nc:IdentificationCategoryDescriptionText>
<nc:IdentificationSourceText>FilingReview</nc:IdentificationSourceText>
</nc:DocumentIdentification></ecf:MessageStatusAugmentation>
</cbrn:MessageStatus>
</w:NotifyFilingReviewCompleteResponse></soap:Body></soap:Envelope>`
}
