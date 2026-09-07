function once(code,from,to,label){const i=code.indexOf(from);if(i<0||code.indexOf(from,i+from.length)>=0)throw new Error('V304.4 integration anchor changed: '+label);return code.replace(from,to)}
function replaceIfPresent(code,from,to){return code.includes(from)?code.replace(from,to):code}
export default function mioV3044WithdrawalFlow(){return{name:'mio-v3044-withdrawal-flow',enforce:'pre',transform(source,id){
 const path=id.split('?')[0].replaceAll('\\','/');let code=source
 if(path.endsWith('/src/App.jsx')){
  code=once(code,"color: graphColors[seriesIndex % graphColors.length]","color: series.color || graphColors[seriesIndex % graphColors.length]",'marker graph color')
  code=once(code,"const color = graphColors[seriesIndex % graphColors.length]","const color = series.color || graphColors[seriesIndex % graphColors.length]",'line graph color')
  code=replaceIfPresent(code,"background: graphColors[index % graphColors.length]","background: series.color || graphColors[index % graphColors.length]")
  code=replaceIfPresent(code,"backgroundColor: graphColors[index % graphColors.length]","backgroundColor: series.color || graphColors[index % graphColors.length]")
  code=once(code,"const ids=new Set([...withdrawalMatters.map(m=>String(m.id)),...Object.keys(mioWithdrawalSnapshot.rows)])","const ids=new Set([...withdrawalMatters.map(m=>String(m.id)),...Object.entries(mioWithdrawalSnapshot.rows).filter(([,row])=>row?.state?.status!=='released').map(([id])=>String(id))])",'active withdrawal rows')
  code=once(code,"onEnter={mioWdEnter} onRefreshFinance={refreshMioFinancialGraphData}","onEnter={mioWdEnter} onRelease={mioWdRelease} onRefreshFinance={refreshMioFinancialGraphData}",'release prop')
  return{code,map:null}
 }
 if(path.endsWith('/src/MioWithdrawalDashboard.jsx')){
  code="import MioWithdrawalFlowSheet from './MioWithdrawalFlowSheet.jsx'\n"+code
  code=once(code,"onEnter,onRefreshFinance,initialExpanded","onEnter,onRelease,onRefreshFinance,initialExpanded",'dashboard release prop')
  code=once(code,"<WithdrawalTrustPanel rows={financeRows} renderGraph={renderTrustGraph} onEnter={onEnter} onRefresh={onRefreshFinance}/>","<WithdrawalTrustPanel rows={financeRows} renderGraph={renderTrustGraph} onEnter={onEnter} onRelease={onRelease} onRefresh={onRefreshFinance}/>",'trust release prop')
  code=once(code,"<h2>Withdrawal and drafting settings</h2>{settings}","<h2>Withdrawal and drafting settings</h2><MioWithdrawalFlowSheet/>{settings}",'flow sheet settings')
  return{code,map:null}
 }
 return null
}}}
