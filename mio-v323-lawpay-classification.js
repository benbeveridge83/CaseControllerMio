// V323: connect the LawPay classification workflow to the Matter Dashboard -> Finances page.
//
// What this transform does, and nothing more:
//   * loads the stored classifications, ledger entries, account mapping and redacted
//     diagnostics from the gateway while a matter's Finances view is on screen;
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
import { singleCountProviderPayments } from './mioLawPayClassification.js'
`
const stateAndLoader = `  const [lawPayV323Review,setLawPayV323Review]=useState({transactions:[],classifications:[],ledger_entries:[],accounts:[],mapping_available:true})
  const [lawPayV323Diagnostics,setLawPayV323Diagnostics]=useState(null)
  const [lawPayV323Busy,setLawPayV323Busy]=useState(false)
  const [lawPayV323Error,setLawPayV323Error]=useState('')
  const [lawPayV323Notice,setLawPayV323Notice]=useState('')
  // The stored classifications, the ledger entries they produced and the deposit-account
  // mapping are read from the gateway. Nothing here writes: every write is an explicit review
  // decision made in the panel below.
  async function loadLawPayClassification(){
    setLawPayV323Busy(true);setLawPayV323Error('')
    try{
      const {data,error}=await supabase.functions.invoke('lawpay-gateway',{body:{action:'review'}})
      if(error)throw new Error(error.message||'The LawPay gateway could not be reached.')
      if(data?.error)throw new Error(data.error)
      setLawPayV323Review({transactions:data.transactions||[],classifications:data.classifications||[],ledger_entries:data.ledger_entries||[],accounts:data.accounts||[],mapping_available:data.mapping_table_available!==false})
      const diagnostics=await supabase.functions.invoke('lawpay-account-diagnostics',{body:{limit:200}})
      setLawPayV323Diagnostics(diagnostics?.error?null:(diagnostics?.data?.diagnostics||null))
      setLawPayV323Notice('')
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
`
const panel = `        <MioLawPayClassificationPanel matter={matter} matters={matters} transactions={lawPayV323Review.transactions} classifications={lawPayV323Review.classifications} invoices={(mioInvoices||[]).filter(row=>String(row.matter_id||'')===String(matter.id))} existingEntries={[...(mioTrustTransactions||[]).filter(row=>String(row.matter_id||'')===String(matter.id)&&!!row.lawpay_transaction_id).map(row=>({id:String(row.id),label:\`\${row.date||''} · \${row.memo||'Mio trust entry'} · $\${financeNumber(row.amount).toFixed(2)}\`})),...(lawPayV323Review.ledger_entries||[]).filter(entry=>String(entry.matter_id||'')===String(matter.id)).map(entry=>({id:String(entry.id),label:\`\${entry.entry_kind} · $\${(Number(entry.amount_cents||0)/100).toFixed(2)}\`}))]} accounts={lawPayV323Review.accounts} mappingAvailable={lawPayV323Review.mapping_available!==false} diagnostics={lawPayV323Diagnostics} busy={lawPayV323Busy} error={lawPayV323Error} notice={lawPayV323Notice} onRefresh={loadLawPayClassification} onActed={loadLawPayClassification} />
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
        part = once(part, '    const manualRows = (trustTransactionSource || [])', postedRows + '    const manualRows = [...(trustTransactionSource || []), ...postedTrustRows]', 'posted trust rows before their use')
        return once(part, "    return [...manualRows, ...lawPayRows.filter((row) => !manualLawPayIds.has(String(row.id).replace(/^lawpay:/, '')))]", "    return [...manualRows, ...lawPayRows.filter((row) => !manualLawPayIds.has(String(row.id).replace(/^lawpay:/, '')) && !postedLawPayKeys.has(String(row.id).replace(/^lawpay:/, '')))]", 'a recorded payment is never also shown as a derived LawPay row')
      })
      code = once(code, '  }, [matters, latestFinancialSnapshotByMatterId, billingEntries, mioInvoices, mioTrustTransactions, lawPayTransactions, lawPayPaymentRequests, activeMioBillingCutoverDate, clioMinimumBalancesByMatterId, mioFinanceOpeningBalances])', '  }, [matters, latestFinancialSnapshotByMatterId, billingEntries, mioInvoices, mioTrustTransactions, lawPayTransactions, lawPayPaymentRequests, activeMioBillingCutoverDate, clioMinimumBalancesByMatterId, mioFinanceOpeningBalances, lawPayV323Review])', 'the prepared matter finances follow the classification ledger')
      code = once(code, originalRefundSum, refundOnce, 'refund counted once')
      code = editFunction(code, 'renderClientDashboardFinances', (part) => once(part, "    return <div style={{ display: 'grid', gap: 14 }}>\n", "    return <div style={{ display: 'grid', gap: 14 }}>\n" + panel, 'classification panel mount'))
      if (code.includes('finishLawPayClassification')) throw Error('V323 transform ran twice')
      return `${code}\n// finishLawPayClassification\n`
    },
  }
}
