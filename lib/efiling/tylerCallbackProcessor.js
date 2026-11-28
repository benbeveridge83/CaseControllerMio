// Tyler ECF5 callback entry point composition (SERVER ONLY).
//
// Ties the XMLDSIG verifier to the notification processor so the callback
// gateway performs, in order: cryptographic verification, validated NFRC
// extraction from the verified signed body, atomic duplicate/status recording,
// and a SOAP acknowledgment only after the record commits. Replay/deduplication
// is enforced atomically by the receipt recorder (mio_record_efiling_callback_v1),
// so a crash between verification and recording cannot lose a valid event.
import { verifyTylerSoapEnvelope } from './tylerXmlDsig.js'
import { processVerifiedTylerNotification } from './tylerNfrcProcessor.js'

export async function processTylerCallback({
  rawXml,
  environment,
  trustedCertificatePem,
  approvedCertificateSha256,
  resolveStatus,
  recordReceipt,
  now,
} = {}) {
  const security = verifyTylerSoapEnvelope({
    xml: rawXml,
    trustedCertificatePem,
    approvedCertificateSha256,
    environment,
    now,
  })
  return processVerifiedTylerNotification({
    rawXml,
    environment,
    security: {
      signatureVerified: security.signatureVerified === true,
      trustedIssuer: security.trustedIssuer === true,
      timestampVerified: security.timestampVerified === true,
    },
    resolveStatus,
    recordReceipt,
  })
}
