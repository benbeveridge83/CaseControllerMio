// V323/V325: connect the LawPay classification workflow to the firm-wide LawPay review queue.
//
// What this transform does, and nothing more:
//   * loads the stored classifications, ledger entries, account mapping and redacted
//     linkage evidence from the gateway for the signed-in finance administrator;
//   * mounts the review panel that records the three decisions, previews them, and asks the
//     gateway to save, record, correct, match or map;
//   * lets a posted entry reach the trust ledger that the matter dashboard, the withdrawal
//     page, the accounting view and the PNC view all read, and suppresses the derived LawPay
//     row for the same provider transaction so the money is counted exactly once;
//   * counts a refund once in the invoice reconciliation arithmetic, instead of subtracting a
//     charge's refunded total and a separate refund record for the same money.
// `replace` is given a function so the replacement is inserted literally: the code this
// transform injects contains `${...}` sequences, which a string replacement would expand as
// $& / $' / $` patterns and quietly corrupt.
function once(code, from, to, label) {
  const parts = code.split(from)
  if (parts.length !== 2) throw Error(`V323 ${label || 'anchor'} count=${parts.length} (${String(from).slice(0, 110)}): source anchor not unique or missing`)
  return code.replace(from, () => to)
}
function editFunction(code, name, edit) {
  const re = new RegExp(' {2}(?:async )?function ' + name + '\\('), match = re.exec(code)
  if (!match) throw Error(`V323 missing ${name}`)
  const start = match.index, next = /\n {2}(?:async )?function /.exec(code.slice(start + match[0].length))
  if (!next) throw Error(`V323 missing end ${name}`)
  const end = start + match[0].length + next.index
  return code.slice(0, start) + edit(code.slice(start, end)) + code.slice(end)
}

const imports = `import MioLawPayClassificationPanel from './MioLawPayClassificationPanel.jsx'
import MioLawPayDiagnostics from './MioLawPayDiagnostics.jsx'
import { notifyLawPayReviewChanged } from './mioLawPayNotifications.js'
import { singleCountProviderPayments, recordedProviderIds } from './mioLawPayClassification.js'
`
const stateAndLoader = `  const [lawPayV323Review,setLawPayV323Review]=useState({transactions:[],classifications:[],ledger_entries:[],accounts:[],mapping_available:true,review_cutover_date:'',legacy_recorded_transaction_ids:[],legacy_attributed_transaction_ids:[],legacy_refund_entries:[]})
  const [lawPayV323Busy,setLawPayV323Busy]=useState(false)
  const [lawPayV323Error,setLawPayV323Error]=useState('')
  const [lawPayV323Notice,setLawPayV323Notice]=useState('')
  // The stored classifications, the ledger entries they produced and the deposit-account
  // mapping are read from the gateway. Nothing here writes: every write is an explicit review
  // decision made in the panel below.
  async function loadLawPayClassification(options={}){
    setLawPayV323Busy(true);setLawPayV323Error('')
    try{
      const {data,error}=await supabase.functions.invoke('lawpay-gateway',{body:{action:'review'}})
      if(error)throw new Error(error.message||'The LawPay gateway could not be reached.')
      if(data?.error)throw new Error(data.error)
      setLawPayV323Review({transactions:data.transactions||[],classifications:data.classifications||[],ledger_entries:data.ledger_entries||[],accounts:data.accounts||[],mapping_available:data.mapping_table_available!==false,refund_resolutions:data.refund_resolutions||[],refund_resolutions_available:data.refund_resolutions_available!==false,review_cutover_date:data.review_cutover_date||activeMioBillingCutoverDate,legacy_recorded_transaction_ids:data.legacy_recorded_transaction_ids||[],legacy_attributed_transaction_ids:data.legacy_attributed_transaction_ids||[],legacy_refund_entries:data.legacy_refund_entries||[]})
      setLawPayV323Notice('')
      if(options.notify!==false)notifyLawPayReviewChanged()
    }catch(failure){setLawPayV323Error(failure instanceof Error?failure.message:String(failure))}finally{setLawPayV323Busy(false)}
  }
  // Loaded once per signed-in session, so that every view reading the trust ledger - the matter
  // dashboard, the withdrawal page, Bulk billing and the PNC view - counts a recorded payment
  // the same way. A firm finance administrator is required by the gateway itself.
  const lawPayV323LoadedRef=useRef(false)
  useEffect(()=>{
    if(!session?.user?.id||lawPayV323LoadedRef.current)return
    lawPayV323LoadedRef.current=true
    loadLawPayClassification()
  },[session?.user?.id])
  // The global LawPay review notification opens the centralized queue through the same window-event
  // pattern the Formspree inbox uses to open itself.
  useEffect(()=>{
    const openLawPay=()=>setPage('lawpay')
    window.addEventListener('mio-open-lawpay',openLawPay)
    return()=>window.removeEventListener('mio-open-lawpay',openLawPay)
  },[session?.user?.id])
  // A decision on any other open tab refreshes this tab's review state quietly (without re-broadcasting,
  // so two tabs cannot ping-pong), keeping the matter trust balance and the review queue in sync.
  useEffect(()=>{
    let channel
    try {
      channel=new BroadcastChannel('mio-lawpay')
      channel.onmessage=(event)=>{
        if(event.data?.type!=='refresh')return
        // Reader views (the matter dashboard, billing, the withdrawal source) re-read the ledger so
        // a recording on this tab reaches their trust balance. A second LawPay queue tab is left stale
        // on purpose: the gateway still refuses its duplicate posting, and that safety net must stay
        // exercisable rather than being masked by an automatic editor refresh.
        const thisTab=String(typeof window!=='undefined'?window.location.hash:'').split('?')[0].replace('#/','#').replace('#','')
        if(thisTab==='lawpay')return
        void loadLawPayClassification({notify:false})
      }
    } catch { /* BroadcastChannel unavailable */ }
    return()=> { try { channel?.close() } catch { /* nothing to close */ } }
  },[session?.user?.id])
`
const panel = `        <MioLawPayClassificationPanel matter={null} matters={matters} pncOptions={(matters||[]).filter(option=>pncStage(option)).map(option=>({id:String(option.id),label:[matterClientName(option),option.name,option.cause_number].filter(Boolean).join(' — ')}))} transactions={lawPayV323Review.transactions} classifications={lawPayV323Review.classifications} invoices={(mioInvoices||[])} existingEntries={[
          ...(mioTrustTransactions||[]).filter(row=>!!row.lawpay_transaction_id).map(row=>({id:String(row.id),source:'legacy_attribution',lawpay_transaction_id:String(row.lawpay_transaction_id||''),matter_id:String(row.matter_id||''),direction:String(row.direction||''),transaction_type:String(row.transaction_type||''),payer_payee:String(row.payer_payee||''),amount:Math.abs(financeNumber(row.amount)),date:String(row.date||row.created_at||''),label:\`\${row.date||''} · \${row.memo||'Mio trust entry'} · $\${financeNumber(row.amount).toFixed(2)}\`})),
          ...((lawPayV323Review.legacy_refund_entries||[]).length?(lawPayV323Review.legacy_refund_entries||[]):(mioTrustTransactions||[]).filter(row=>String(row.transaction_type||'').toLowerCase()==='client_refund')).map(row=>({id:String(row.id),source:'mio_trust_refund',lawpay_transaction_id:String(row.lawpay_transaction_id||''),matter_id:String(row.matter_id||''),direction:String(row.direction||'out'),transaction_type:'client_refund',payer_payee:String(row.payer_payee||''),amount:Math.abs(financeNumber(row.amount)),date:String(row.date||row.created_at||''),label:\`\${row.date||''} · \${row.memo||'Mio trust refund'} · $\${financeNumber(row.amount).toFixed(2)}\`})),
          ...(lawPayV323Review.ledger_entries||[]).map(entry=>{const classification=(lawPayV323Review.classifications||[]).find(record=>String(record.id||'')===String(entry.classification_id||''))||{};const transaction=(lawPayV323Review.transactions||[]).find(row=>String(row.gateway_transaction_id||'')===String(classification.gateway_transaction_id||''))||{};return {id:String(entry.id),source:'classification_workflow',lawpay_transaction_id:String(transaction.gateway_transaction_id||''),matter_id:String(entry.matter_id||classification.matter_id||''),direction:String(entry.direction||''),transaction_type:String(entry.entry_kind||'')==='refund_effect'||String(classification.category||'')==='client_refund'?'client_refund':'',amount:Math.abs(Number(entry.amount_cents||0)/100),date:String(entry.occurred_at||entry.created_at||''),label:\`\${entry.entry_kind} · $\${(Number(entry.amount_cents||0)/100).toFixed(2)}\`}})
        ]} accounts={lawPayV323Review.accounts} mappingAvailable={lawPayV323Review.mapping_available!==false} busy={lawPayV323Busy} error={lawPayV323Error} notice={lawPayV323Notice} onRefresh={loadLawPayClassification} onActed={loadLawPayClassification} refundResolutions={lawPayV323Review.refund_resolutions} reviewCutoverDate={lawPayV323Review.review_cutover_date||activeMioBillingCutoverDate} legacyRecordedTransactionIds={lawPayV323Review.legacy_recorded_transaction_ids||[]} legacyAttributedTransactionIds={lawPayV323Review.legacy_attributed_transaction_ids||[]} />
`
const lawpayQueue = `      <section aria-label="LawPay review queue" style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <h2 style={{ marginTop: 0 }}>LawPay review queue</h2>
        ${panel}
        <MioLawPayDiagnostics />
      </section>
`
const postedRows = `    // A transaction recorded through the classification workflow appears exactly once: as the
    // posted ledger entry. A corrected posting keeps its original entry and its reversal, which
    // cancel each other, so correcting never removes money twice. The derived LawPay row is
    // suppressed for the same provider transaction.
    const postedTrustRows=(lawPayV323Review.ledger_entries||[])
      .filter(entry=>String(entry.matter_id||'')===matterId&&String(entry.account_key||'').toLowerCase().includes('trust'))
      .map(entry=>{
        const classification=(lawPayV323Review.classifications||[]).find(record=>String(record.id||'')===String(entry.classification_id||''))||{}
        const provider=(lawPayV323Review.transactions||[]).find(transaction=>String(transaction.gateway_transaction_id||'')===String(classification.gateway_transaction_id||''))||{}
        const isReversal=String(entry.entry_kind||'')==='reversal'
        return {id:\`lawpay-entry:\${entry.id}\`,matter_id:matterId,date:financeDateOnly(entry.occurred_at||entry.created_at),occurred_at:entry.occurred_at||entry.created_at,created_at:entry.created_at||entry.occurred_at,direction:entry.direction==='out'?'out':'in',transaction_type:isReversal?'reversal':(entry.direction==='out'?'refund':'lawpay'),amount:Math.abs(financeNumber(entry.amount_cents)/100),payer_payee:provider.payer_name||provider.payer_email||'',reference:provider.reference||'',memo:isReversal?'Reversal of a corrected LawPay posting':\`\${entry.direction==='out'?'Refund':'Digital payment'} through LawPay, recorded from the classification review\`,source:'LawPay',lawpay_transaction_id:String(provider.id||provider.gateway_transaction_id||''),lawpay_ledger_entry_id:String(entry.id),lawpay_classification_id:String(entry.classification_id||'')}
      })
    // A derived row is identified by whichever value its loader used, so a recorded provider
    // transaction is resolved against the stored transactions themselves instead of assuming
    // one identifier form. This is what stops the same money being shown twice.
    const postedProviderIds=new Set([...(lawPayV323Review.classifications||[]).map(record=>String(record.gateway_transaction_id||'')),...postedTrustRows.map(row=>String(row.lawpay_transaction_id||'')),...(lawPayV323Review.ledger_entries||[]).map(entry=>String(entry.identity||'').split(':').pop())].map(value=>String(value||'')).filter(Boolean))
    const postedLawPayKeys=new Set((lawPayTransactionSource||[]).filter(transaction=>postedProviderIds.has(String(transaction.gateway_transaction_id||''))||postedProviderIds.has(String(transaction.id||''))).map(transaction=>String(transaction.id||transaction.gateway_transaction_id||'')).filter(Boolean))
`
const refundOnce = `      // A refund that LawPay reports twice over — as a refunded total on the charge and as its
      // own refund record — used to be subtracted twice here, which understated what the client
      // had paid. The refund is now counted once, and any overlap is reported for review.
      const counted=singleCountProviderPayments(successful)
      const transactionPaid=counted.total_cents/100
`
const originalRefundSum = `      const transactionPaid = successful.reduce((sum, transaction) => {
        const type = String(transaction.transaction_type || '').toLowerCase()
        const amount = Math.abs(financeNumber(transaction.amount_cents) / 100 || financeNumber(transaction.amount))
        const refunded = Math.abs(financeNumber(transaction.amount_refunded_cents) / 100)
        return sum + (/refund|chargeback|reversal/.test(type) ? -amount : Math.max(0, amount - refunded))
      }, 0)
`
const discrepancy = `        {finance.trustNegative ? <p role="alert" data-testid="trust-discrepancy" style={{ color: '#b91c1c', fontWeight: 800 }}>{'Trust ledger is negative: ' + money(finance.trust) + ' for ' + String(matter.name || 'this matter') + '. This is a discrepancy to review, not funds to spend, and it is shown rather than hidden.'}</p> : null}
`
//V323_APPEND
export default function lawPayClassification() {
  return {
    name: 'mio-v323-lawpay-classification',
    enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/src/App.jsx')) return null
      let code = imports + source
      code = once(code, '  const [lawPayTransactions, setLawPayTransactions] = useState([])', '  const [lawPayTransactions, setLawPayTransactions] = useState([])\n' + stateAndLoader, 'classification state')
      code = editFunction(code, 'clientFinanceLedgerRows', (part) => {
        part = once(part, '    const manualRows = (trustTransactionSource || [])', postedRows + `    // One effect per provider transaction, whoever recorded it: a legacy attribution's own trust
    // row is dropped once the classification workflow has a posted entry for the same immutable
    // LawPay transaction id, so the two paths can never both move the money.
    const manualRows=[...(trustTransactionSource || []).filter(row=>!postedProviderIds.has(String(row.lawpay_transaction_id || ''))),...postedTrustRows]`, 'manual rows carry posted entries')
        return once(part, "    return [...manualRows, ...lawPayRows.filter((row) => !manualLawPayIds.has(String(row.id).replace(/^lawpay:/, '')))]", "    return [...manualRows, ...lawPayRows.filter((row) => !manualLawPayIds.has(String(row.id).replace(/^lawpay:/, '')) && !postedLawPayKeys.has(String(row.id).replace(/^lawpay:/, '')))]", 'a recorded payment is never also shown as a derived LawPay row')
      })

      code = once(code, `      if(result.entry) {
        const latestTrust=await latestStoredTrustTransactions()
        if(duplicateLawPayAttribution(latestTrust,transaction))throw new Error('This charge is already in the trust ledger, so Mio did not post it twice. Refresh the matter to see the recorded deposit.')
        const nextTrust=[result.entry,...latestTrust]
        await saveMioStateKeyNow('caseMioTrustTransactions',JSON.stringify(nextTrust),{throwOnError:true})
        const verified=await latestStoredTrustTransactions()
        if(!verified.some(row=>String(row?.id||'')===String(result.entry.id)))throw new Error('The trust-ledger entry could not be verified, so Mio recorded no attribution.')
        verifiedTrustRows=verified
      }`, `      // The Bulk Billing control no longer keeps a ledger or an attribution state of its own. It
      // records the decision through the same classification workflow, gateway and server tables
      // that Matter Finances uses, so one immutable LawPay transaction has exactly one posting
      // wherever it is categorized. It never writes a trust row itself, and the server refuses a
      // second posting of the same transaction.
      const attributedAccountKey=String(transaction.account_key||transaction.raw?.account_key||'').trim().toLowerCase()
      // A charge whose deposit account LawPay did not report is never posted, but the decision is
      // still recorded through the shared workflow so it stays reviewable and can be corrected
      // once the account is verified. The server refuses to post it without account evidence.
      const attributedDecisionMatter=['matter','pnc'].includes(editor.decision)
      const attributedUnresolvedAccount=!result.ok
      const attributedCategory=attributedDecisionMatter?(attributedUnresolvedAccount||attributedAccountKey.includes('trust')?'trust_deposit':'consultation_payment'):'other'
      const attributedSharesLedger=attributedDecisionMatter&&!attributedUnresolvedAccount&&attributedAccountKey.includes('trust')
      const {data:attributedResult,error:attributedError}=await supabase.functions.invoke('lawpay-gateway',{body:{action:attributedSharesLedger?'post':'save',classification:{gateway_transaction_id:String(transaction.gateway_transaction_id||transaction.id||''),provider_account_id:String(transaction.account_id||''),ownership:editor.decision==='matter'?'matter':editor.decision==='pnc'?'pnc':'other_unresolved',matter_id:editor.decision==='matter'?String(editor.matter_id||''):'',pnc_workflow_id:editor.decision==='pnc'?String(editor.matter_id||''):'',other_reason:editor.decision==='neither'?String(editor.reason||''):'',actual_account_key:attributedAccountKey,account_source:attributedAccountKey?'reported_by_lawpay':'',account_evidence:'',account_explanation:String(editor.reason||''),category:attributedCategory,direction:editor.money_out?'out':'in',explanation:String(editor.reason||'')}}})
      if(attributedError)throw new Error(attributedError.message||'The LawPay gateway could not be reached, so nothing was recorded.')
      if(attributedResult?.error)throw new Error(attributedResult.error)
      try { await loadLawPayClassification() } catch {}`, 'bulk billing records through the one classification workflow')
      // Only the refusal that means "LawPay did not report the deposit account" may continue: that
      // decision is recorded for review through the same workflow and is never posted. Every other
      // legacy refusal still stops the decision exactly where it stopped before.
      code = once(code, `if(!result.ok){setLawPayAttributionEditor({...editor,error:result.error});return}`, `if(!result.ok&&!/Account not reported/.test(String(result.error||''))){setLawPayAttributionEditor({...editor,error:result.error});return}`, 'an unresolved deposit account is recorded for review, never posted')
      code = once(code, '  }, [matters, latestFinancialSnapshotByMatterId, billingEntries, mioInvoices, mioTrustTransactions, lawPayTransactions, lawPayPaymentRequests, activeMioBillingCutoverDate, clioMinimumBalancesByMatterId, mioFinanceOpeningBalances])', '  }, [matters, latestFinancialSnapshotByMatterId, billingEntries, mioInvoices, mioTrustTransactions, lawPayTransactions, lawPayPaymentRequests, activeMioBillingCutoverDate, clioMinimumBalancesByMatterId, mioFinanceOpeningBalances, lawPayV323Review])', 'the prepared matter finances follow the classification ledger')
      code = once(code, `const nextRecords=[result.record,...latestRecords.filter(record=>String(record?.gateway_transaction_id||'')!==String(result.record.gateway_transaction_id))]`, `const nextRecords=result.record?[result.record,...latestRecords.filter(record=>String(record?.gateway_transaction_id||'')!==String(result.record.gateway_transaction_id))]:latestRecords`, 'an unresolved account has no legacy attribution record to write')
      code = once(code, `if(!verifiedRecords.some(record=>String(record?.gateway_transaction_id||'')===String(result.record.gateway_transaction_id)))throw new Error('The attribution decision could not be verified.')`, `if(result.record&&!verifiedRecords.some(record=>String(record?.gateway_transaction_id||'')===String(result.record.gateway_transaction_id)))throw new Error('The attribution decision could not be verified.')`, 'an unresolved account has nothing to verify against the legacy state')
      code = once(code, `setLawPayMessage(lawPayAttributionSummary(result.record,{matterName:matter?.name||'',pncLabel:matter?.name||''})+'. This charge no longer requires review.')`, `setLawPayMessage(result.record?lawPayAttributionSummary(result.record,{matterName:matter?.name||'',pncLabel:matter?.name||''})+'. This charge no longer requires review.':'This charge is saved for review. LawPay did not report which account the money went into, so Mio posted nothing and the account can be verified later.')`, 'an unresolved account says plainly that it was saved for review')
      code = once(code, '    const trust = Math.max(0, snapshotTrust + ledgerDelta)', `    // The trust ledger balance is reported exactly as it is. A negative balance is a real
    // discrepancy to review, never hidden: only an "available to apply toward billing" figure may
    // be floored at zero, and that is done where it is used.
    const trust = snapshotTrust + ledgerDelta
    const trustNegative = trust < -0.005`, 'trust is never clamped to zero')
      code = once(code, originalRefundSum, refundOnce, 'refund counted once')
      code = once(code, '      trust,\n', '      trust,\n      trustNegative,\n', 'the negative trust balance is reported')
      code = editFunction(code, 'renderClientDashboardFinances', (part) => once(part, "    return <div style={{ display: 'grid', gap: 14 }}>\n", "    return <div style={{ display: 'grid', gap: 14 }}>\n" + discrepancy, 'trust discrepancy mount'))
      code = once(code, "      <p style={{ color: '#475569', marginTop: -6 }}>Create secure LawPay payment links, associate them with Mio matters and Mio invoices, and synchronize gateway transaction events. Card and bank details remain on LawPay's hosted pages.</p>\n", "      <p style={{ color: '#475569', marginTop: -6 }}>Create secure LawPay payment links, associate them with Mio matters and Mio invoices, and synchronize gateway transaction events. Card and bank details remain on LawPay's hosted pages.</p>\n" + lawpayQueue, 'centralized LawPay review queue and diagnostics mount')
      code = once(code, '        return {...result,audit}', '        notifyLawPayReviewChanged()\n        return {...result,audit}', 'the review notification refreshes after a live sync')
      code = editFunction(code, 'renderFinanceSyncStatus', (part) => once(part,
        `    return <details style={{border:'1px solid #cbd5e1',borderRadius:8,padding:10,margin:'10px 0'}}>`,
        `    // V327: a transaction already recorded through the classification review (posted/matched),
    // or a legacy trust/attribution decision, is no longer "unlinked" - it has been connected, so
    // it is removed from the reconciliation list and its count.
    const recordedIds=recordedProviderIds({classifications:lawPayV323Review.classifications,legacyRecordedTransactionIds:lawPayV323Review.legacy_recorded_transaction_ids,legacyAttributedTransactionIds:lawPayV323Review.legacy_attributed_transaction_ids})
    audit.unlinked=audit.unlinked.filter(issue=>!recordedIds.has(String(issue.id)))
    return <details style={{border:'1px solid #cbd5e1',borderRadius:8,padding:10,margin:'10px 0'}}>`,
        'recorded transactions are no longer unlinked'))
      if (code.includes('finishLawPayClassification')) throw Error('V323 transform ran twice')
      return `${code}\n// finishLawPayClassification\n`
    },
  }
}
