// Deterministic synthetic ECF5 documents for testing the REAL Mio serializers.
// No client data, Tyler secrets, valid payment credentials, or court submission.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { planTylerSubsequentCivilFiling } from '../lib/efiling/tylerSubsequentCivilMapper.js'
import { buildUnsignedTylerSubsequentCivilFilingMessage } from '../lib/efiling/tylerSubsequentCivilMessage.js'
import { buildUnsignedTylerPaymentMessage } from '../lib/efiling/tylerPaymentMessage.js'
const outputDir = resolve(process.argv[2] || '/tmp/tyler-ecf5-synthetic')
mkdirSync(outputDir,{recursive:true})
const bytes=Buffer.from('%PDF-1.7\nsynthetic fixture only, not a court filing\n%%EOF')
const doc={fileName:'Synthetic Motion.pdf',pageCount:1,byteLength:bytes.length,
 sha256:createHash('sha256').update(bytes).digest('hex'),
 documentTypeCode:'677',filingComponentCode:'332',
 sourceObjectId:'synthetic-document',description:'Synthetic Motion'}
const plan=planTylerSubsequentCivilFiling({
 environment:'stage',mode:'efile_only',isNewCase:false,messageId:'msg-synthetic-1',
 courtLocationId:'harris:dc',caseCategoryCode:'7',caseTypeCode:'545',
 caseTrackingId:'CASE-SYNTHETIC-123',
 sendingMdeLocationId:'https://example.invalid/efsp',filingCodeId:'670',
 filingPartyParticipantId:'PARTY-SYNTHETIC-123',
 filingAttorneyParticipantId:'ATTORNEY-SYNTHETIC-123',
 leadDocument:doc,attachments:[],
 paymentAccountId:'PAYMENT-SYNTHETIC-123',maxFeeAmountCents:10000,
})
const filing=buildUnsignedTylerSubsequentCivilFilingMessage({
 plan,bytesBySourceId:{'synthetic-document':bytes},
 submittedAt:'2026-11-26T15:00:00.000Z',
})
const payment=buildUnsignedTylerPaymentMessage({plan,feeQuote:{
 source:'tyler_stage',verifiedByServer:true,
 paymentAccountId:'PAYMENT-SYNTHETIC-123',
 quoteId:'SYNTHETIC-QUOTE-123',feeAmountCents:100,
}})
for (const [name,xml] of [
 ['generated-filing.xml',filing.xml], ['generated-payment.xml',payment.xml],
]) writeFileSync(resolve(outputDir,name),xml,{mode:0o600})
if(filing.transportReady!==false || payment.transportReady!==false)
 throw Error('Synthetic ECF5 fixture unexpectedly marked transport ready.')
process.stdout.write('Generated synthetic, unsigned ECF5 XML fixtures. No live transport.\n')
