function once(code,from,to,label){const i=code.indexOf(from);if(i<0||code.indexOf(from,i+from.length)>=0)throw new Error('V304.4 integration anchor changed: '+label);return code.replace(from,to)}
export default function mioV3044WithdrawalFlow(){return{name:'mio-v3044-withdrawal-flow',enforce:'pre',transform(source,id){
 const path=id.split('?')[0].replaceAll('\\','/');let code=source
 if(path.endsWith('/src/App.jsx')){
  code=once(code,"const MIO_APP_VERSION = 'Mio V304.1 (sign-in recovery / inline withdrawal workspace)'","const MIO_APP_VERSION = 'Mio V304.4 (withdrawal flow / status graph controls)'",'version')
  code=once(code,"  async function mioWdPrepareEfile(matterId,step,state,documentId){",`  async function mioWdRelease(matterId){
    const matter=matters.find(m=>String(m.id)===String(matterId));if(!matter)throw new Error('Matter not found.')
    if(matterWithdrawalStatus(matter)!=='withdrawing')return
    if(!window.confirm('Release '+matterClientName(matter)+' - '+matter.name+' from withdrawal status? The saved withdrawal history will be retained, but the matter will leave the active withdrawal dashboard.'))return
    const extra={...matterExtraInfoById,[matterId]:{...cloneMatterExtraInfo(matterExtraInfoById[matterId]||{}),withdrawal_status:'not_withdrawing',withdrawal_released_at:new Date().toISOString()}}
    await saveMioStateKeyNow('caseControllerMatterExtraInfo',JSON.stringify(extra),{throwOnError:true})
    setMatterExtraInfoById(extra);if(String(mioWdFocusMatter)===String(matterId))setMioWdFocusMatter('')
  }
  async function mioWdPrepareEfile(matterId,step,state,documentId){`,'release handler')
  code=once(code,"const series=rows.map(r=>({matter_id:r.matter_id,display_number:r.client+' - '+r.name,mio_matter_ids:[r.matter_id],matter_names:[{id:r.matter_id,name:r.name}],points:r.points}))","const series=rows.map(r=>({matter_id:r.matter_id,display_number:r.client+' - '+r.name,mio_matter_ids:[r.matter_id],matter_names:[{id:r.matter_id,name:r.name}],points:r.points,color:r.withdrawing?'#c62828':'#111111'}))",'matter graph colors')
  code=once(code,"series.push({matter_id:'minimum-'+r.matter_id,display_number:'Minimum trust balance',points:[{date:r.points[0].date,balance:r.minimum},{date:new Date().toISOString(),balance:r.minimum}]})","series.push({matter_id:'minimum-'+r.matter_id,display_number:'Minimum trust balance',points:[{date:r.points[0].date,balance:r.minimum},{date:new Date().toISOString(),balance:r.minimum}],color:'#64748b'})",'minimum line color')
  code=once(code,"color: graphColors[seriesIndex % graphColors.length]","color: series.color || graphColors[seriesIndex % graphColors.length]",'marker graph color')
  code=once(code,"const color = graphColors[seriesIndex % graphColors.length]","const color = series.color || graphColors[seriesIndex % graphColors.length]",'line graph color')
  code=once(code,"background: graphColors[index % graphColors.length]","background: series.color || graphColors[index % graphColors.length]",'legend graph color')
  code=once(code,"const ids=new Set([...withdrawalMatters.map(m=>String(m.id)),...Object.keys(mioWithdrawalSnapshot.rows)])","const ids=new Set(withdrawalMatters.map(m=>String(m.id)))",'active withdrawal rows')
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
