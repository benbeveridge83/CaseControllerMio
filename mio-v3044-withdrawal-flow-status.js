function once(code,from,to,label){const i=code.indexOf(from);if(i<0||code.indexOf(from,i+from.length)>=0)throw new Error('V304.4 integration anchor changed: '+label);return code.replace(from,to)}
export default function mioV3044WithdrawalFlowStatus(){return{name:'mio-v3044-withdrawal-flow-status',enforce:'pre',transform(source,id){
 const path=id.split('?')[0].replaceAll('\\','/');let code=source
 if(path.endsWith('/src/App.jsx')){
  code=once(code,'const color = graphColors[seriesIndex % graphColors.length]','const color = series.color || graphColors[seriesIndex % graphColors.length]','graph line custom color')
  code=once(code,'background: graphColors[index % graphColors.length]','background: series.color || graphColors[index % graphColors.length]','graph legend custom color')
  code=once(code,'onEnter={mioWdEnter} onRefreshFinance={refreshMioFinancialGraphData}','onEnter={mioWdEnter} onRelease={mioWdRelease} onRefreshFinance={refreshMioFinancialGraphData}','withdrawal release prop')
  code=once(code,'const ids=new Set([...withdrawalMatters.map(m=>String(m.id)),...Object.keys(mioWithdrawalSnapshot.rows)])',"const ids=new Set([...withdrawalMatters.map(m=>String(m.id)),...Object.entries(mioWithdrawalSnapshot.rows).filter(([,row])=>row?.state?.status!=='released').map(([id])=>String(id))])",'exclude released workflow rows')
  return{code,map:null}
 }
 if(path.endsWith('/src/MioWithdrawalDashboard.jsx')){
  code="import MioWithdrawalFlowSheet from './MioWithdrawalFlowSheet.jsx'\n"+code
  code=once(code,'renderTrustGraph,onEnter,onRefreshFinance,initialExpanded','renderTrustGraph,onEnter,onRelease,onRefreshFinance,initialExpanded','dashboard release prop')
  code=once(code,'<WithdrawalTrustPanel rows={financeRows} renderGraph={renderTrustGraph} onEnter={onEnter} onRefresh={onRefreshFinance}/>','<WithdrawalTrustPanel rows={financeRows} renderGraph={renderTrustGraph} onEnter={onEnter} onRelease={onRelease} onRefresh={onRefreshFinance}/>','trust release prop')
  code=once(code,'<section className="mio-wd-detail"><h2>Withdrawal and drafting settings</h2>{settings}</section>','<section className="mio-wd-detail"><h2>Withdrawal and drafting settings</h2><MioWithdrawalFlowSheet/>{settings}</section>','settings flow sheet')
  return{code,map:null}
 }
 return null
}}}
