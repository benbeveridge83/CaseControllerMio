// Mio V283: make Withdrawal dashboard say exactly what needs the user's attention.
// The Supabase workflow tables are installed separately by migration; this transform is UI-only.
function replaceOnce(code, from, to, label) {
  const first = code.indexOf(from)
  if (first < 0 || code.indexOf(from, first + from.length) >= 0) throw new Error('V283 integration anchor changed: ' + label)
  return code.replace(from, to)
}

export default function mioV283WithdrawalClarity() {
  return {
    name: 'mio-v283-withdrawal-clarity',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (path.endsWith('/src/App.jsx')) {
        return { code: replaceOnce(source, "const MIO_APP_VERSION = 'Mio V281 (template blocks)'", "const MIO_APP_VERSION = 'Mio V283 (withdrawal clarity)'", 'version'), map: null }
      }
      if (!path.endsWith('/src/MioWithdrawalDashboard.jsx')) return null
      let code = source
      code = replaceOnce(
        code,
        "<p>What needs your attention - and how long it has been waiting.</p>",
        "<p>See exactly what needs your action, what Mio is waiting on, and how long each item has been pending.</p>",
        'dashboard description'
      )
      code = replaceOnce(
        code,
        "['Matter / client','Attention / waiting on','Next action','Action pending','In withdrawal','Open']",
        "['Matter / client','Status / waiting on','What I need to do','Action pending','In withdrawal','Open']",
        'table headers'
      )
      const oldCell = "<td><b className={'mio-wd-badge '+(a.needsMe?'needs':'')}>{a.kind==='complete'?'COMPLETE':a.needsMe?'NEEDS ME':'WAITING'}</b>{a.count>1&&<div>{a.count} pending actions</div>}<small>{a.waiting.join('; ')}</small></td><td>{a.next}{a.overdue&&<strong> - follow-up due</strong>}</td>"
      const newCell = "<td><b className={'mio-wd-badge '+(a.needsMe?'needs':'')}>{a.kind==='complete'?'COMPLETE':a.needsMe?'NEEDS ME':'WAITING'}</b>{a.needsMe&&<div style={{marginTop:4,fontWeight:800}}>{a.next}</div>}{a.count>1&&<div>{a.count} pending actions total</div>}{!a.needsMe&&a.waiting.length>0&&<small>Waiting on: {a.waiting.join('; ')}</small>}</td><td><strong>{a.next}</strong>{a.overdue&&<div><strong>Follow-up is due now.</strong></div>}{!r.state&&<small>Open Review, then initialize the withdrawal workflow and confirm the current step.</small>}</td>"
      code = replaceOnce(code, oldCell, newCell, 'attention/action cells')
      return { code, map: null }
    }
  }
}
