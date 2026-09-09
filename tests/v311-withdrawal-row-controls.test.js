import test from 'node:test'
import assert from 'node:assert/strict'
import mioV311WithdrawalRowControls from '../mio-v311-withdrawal-row-controls.js'

const plugin=mioV311WithdrawalRowControls()

test('V311 keeps graph capped at 12 but makes the review table use every matching matter',()=>{
 const source=`export default function X({onAction,getPeople,initialExpanded}){
 const matchingFinance=[]
 const graphFinance=matchingFinance.slice(0,12)
 const tableFinance=[...graphFinance].sort((a,b)=>0)
 const close=()=>{if(!busy)setEditor(null)}
 return <><details><summary>Review {graphFinance.length} matters shown on graph{matchingFinance.length>graphFinance.length?' of '+matchingFinance.length+' matching filters':''} / change withdrawal status</summary><table><thead><tr><th aria-sort={sortAria('withdrawal')}><button>Withdrawal</button></th></tr></thead><tbody>{tableFinance.map(r=><tr><td>{day(r.last_invoice_sent)}</td><td><button type="button" disabled={busy||r.complete&&!r.withdrawing}>x</button></td></tr>)}</tbody></table></details><table><thead><tr><th>Matter / client</th><th>Status</th><th>Next action / what is needed</th><th>Pending</th><th>In withdrawal</th><th>Open</th></tr></thead><tbody><tr><td>{ageLabel(row.state?.started_at,now)}</td><td><button type="button" aria-expanded={expanded===row.matter_id}>Review</button></td></tr><tr className="mio-block-expanded"><td colSpan={6}><button type="button" disabled={!rowEditable(row)} onClick={()=>run(async()=>{const final=row.state.definition.steps.find(s=>s.action==='finish');if(!final)throw new Error('Add a Complete workflow action to this process first.');setSelectedId(final.id);await complete(row,final)})}>Mark complete</button><button type="button" disabled={busy||row.state.status!=='active'} onClick={()=>run(()=>onRelease(row.matter_id))}>Release from withdrawal</button></td></tr></tbody></table>{editor&&<Modal>{editor.type==='builder'&&editorState&&<div/>}</Modal>}</>
}`
 const result=plugin.transform(source,'/repo/src/MioWithdrawalBlocks.jsx').code
 assert.match(result,/const tableFinance=\[\.\.\.matchingFinance\]/)
 assert.match(result,/Review \{matchingFinance.length\} matching matters/)
 assert.match(result,/Matter status/)
 assert.match(result,/workflow_complete/)
 assert.match(result,/onMatterStatus/)
})

test('V311 adds an explicit whole-workflow completion reducer event',()=>{
 const source=`export function applyWorkflowBlockEvent(current,e,at=stamp()){
 if(e.type==='workflow_configure')return configureWorkflow(current,e.definition,at)
}`
 const result=plugin.transform(source,'/repo/src/mioWorkflowBlocks.js').code
 assert.match(result,/e\.type==='workflow_complete'/)
 assert.match(result,/s\.status='complete'/)
 assert.match(result,/status:'cancelled'/)
})
