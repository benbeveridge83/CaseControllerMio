// PaymentMessage XML from Tyler EFM v2026.2.2 sample tyler-paymentmessage.xml.
// Requires a verified server-side quote and the same PaymentID as the reviewed
// filing plan. No charge is initiated, no bank details are accessed here.
const esc = s => String(s).replace(/[&<>"']/g, c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;',
})[c])
export function buildUnsignedTylerPaymentMessage({plan,feeQuote}) {
 if(!plan || plan.transportReady!==false || !plan.paymentAccountId ||
  plan.environment !== undefined && plan.environment !== 'stage')
  throw new Error('Stage-only reviewed filing plan required.')
 if(!feeQuote || feeQuote.source !== 'tyler_stage' ||
   feeQuote.verifiedByServer !== true || typeof feeQuote.paymentAccountId!=='string' ||
   feeQuote.paymentAccountId !== plan.paymentAccountId)
  throw new Error('A server-verified Tyler Stage fee quote with the selected payment account is required.')
 if(!Number.isSafeInteger(feeQuote.feeAmountCents) || feeQuote.feeAmountCents < 0 ||
   !Number.isSafeInteger(plan.maxFeeAmountCents) ||
   feeQuote.feeAmountCents > plan.maxFeeAmountCents)
  throw new Error('Fee quote exceeds or does not match the authorized maximum.')
 if(!feeQuote.quoteId || typeof feeQuote.quoteId!=='string' || feeQuote.quoteId.length>256 ||
  /[\u0000-\u001f\u007f]/.test(feeQuote.quoteId))
  throw new Error('Missing verified Tyler Stage fee quote identifier.')
 const amount=(feeQuote.feeAmountCents/100).toFixed(2)
 const xml = '<payment:PaymentMessage '+
  'xmlns:payment="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/payment" '+
  'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" '+
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">'+
  '<cac:Address/><cac:AllowanceCharge><cbc:ChargeIndicator>true</cbc:ChargeIndicator>'+
  '<cbc:Amount currencyID="USD">'+amount+'</cbc:Amount>'+
  '<cac:PaymentMeans><cbc:PaymentMeansCode/><cbc:PaymentID>'+esc(plan.paymentAccountId)+
  '</cbc:PaymentID></cac:PaymentMeans></cac:AllowanceCharge>'+
  '<cac:Payment/><payment:CorrectedPaymentIndicator>false</payment:CorrectedPaymentIndicator>'+
  '<payment:Payer/></payment:PaymentMessage>'
 return Object.freeze({
  xml,feeAmountCents:feeQuote.feeAmountCents,quoteId:feeQuote.quoteId,
  signed:false,schemaValidated:false,transportReady:false,
 })
}
