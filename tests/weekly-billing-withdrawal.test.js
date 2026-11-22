import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source=fs.readFileSync(new URL('../src/mioWeeklyWithdrawal.inc',import.meta.url),'utf8')
function harness({matters=[{id:'a',name:'Retained A',client_id:'client1',is_active:true}],settings={},extra={},workflows=[],finance={},confirm=true}={}) {
  let storedExtra={...extra},commits=0,confirmations=0,marked=null
  const supabase={from(table){
    const filters={}
    const query={
      select(){return this},
      eq(k,v){filters[k]=v;return this},
      in(){return this},
      maybeSingle(){const key=filters.key;return Promise.resolve({data:{json_value:key==='mioWeeklyBillingSettingsV1'?{matters:settings}:storedExtra},error:null})},
      single(){return Promise.resolve({data:{json_value:storedExtra},error:null})},
      then(resolve,reject){
        return Promise.resolve(table==='mio_invoices'?{data:[],error:null}:
          table==='mio_withdrawal_workflows'?{data:workflows,error:null}:{data:[],error:null}).then(resolve,reject)
      }
    }
    return query
  }}
  const context={
    session:{user:{id:'user1'}},matters,supabase,
    refreshLawPayFinancialData:async()=>true,
    invoiceFromDatabaseRow:x=>x,
    clientFinanceNumbers:m=>({financialSnapshotResolved:true,outstanding:100,trust:0,...finance[m.id]}),
    pendingLawPayAmountForMatter:()=>0,financeNumber:n=>Number(n)||0,
    cloneMatterExtraInfo:x=>({...x}),
    saveMioStateKeyNow:async(key,value)=>{assert.equal(key,'caseControllerMatterExtraInfo');storedExtra=JSON.parse(value);commits++},
    setMatterExtraInfoById:x=>{marked=x},
    window:{confirm:()=>{confirmations++;return confirm}},
    JSON,Date,Error,Set,Map,String,Number,Boolean,Array,RegExp
  }
  const mark=vm.runInNewContext(source+'\nweeklyBillingMarkForWithdrawal',context)
  return {mark,stats:()=>({storedExtra,commits,confirmations,marked})}
}
test('administrative withdrawal requires confirmation and persists only after verification',async()=>{
  const h=harness()
  const result=await h.mark(['a'])
  assert.equal(result.updated,1)
  // The function runs in a separate vm realm; normalize the array before equality.\n  assert.deepEqual(Array.from(result.updatedIds),['a'])
  assert.equal(h.stats().storedExtra.a.withdrawal_status,'withdrawing')
  assert.equal(h.stats().commits,1)
  assert.equal(h.stats().confirmations,1)
})
test('appointed matter cannot enter withdrawal automation',async()=>{
  const h=harness({settings:{a:{appointed:true,included:true}}})
  await assert.rejects(()=>h.mark(['a']),/No eligible matters/)
  assert.equal(h.stats().commits,0)
})
test('another shareable same-client trust balance blocks withdrawal',async()=>{
  const matters=[{id:'a',name:'Owed',client_id:'client1',is_active:true},{id:'b',name:'Funded',client_id:'client1',is_active:true}]
  const h=harness({matters,finance:{a:{outstanding:100,trust:0},b:{outstanding:0,trust:500}}})
  await assert.rejects(()=>h.mark(['a']),/another included matter has trust/)
  assert.equal(h.stats().commits,0)
})
test('unsharing source trust permits review of unpaid matter',async()=>{
  const matters=[{id:'a',name:'Owed',client_id:'client1',is_active:true},{id:'b',name:'Funded',client_id:'client1',is_active:true}]
  const h=harness({matters,settings:{b:{shareTrust:false}},finance:{a:{outstanding:100,trust:0},b:{outstanding:0,trust:500}}})
  assert.equal((await h.mark(['a'])).updated,1)
})
test('previously released withdrawal workflows are not marked again',async()=>{
  const h=harness({workflows:[{matter_id:'a',state:{status:'released'}}]})
  await assert.rejects(()=>h.mark(['a']),/already handled/)
  assert.equal(h.stats().commits,0)
})
test('unverified finance and cancelled confirmation make no changes',async()=>{
  const unknown=harness({finance:{a:{financialSnapshotResolved:false}}})
  await assert.rejects(()=>unknown.mark(['a']),/unresolved financial/)
  const declined=harness({confirm:false})
  assert.equal((await declined.mark(['a'])).cancelled,true)
  assert.equal(declined.stats().commits,0)
})
