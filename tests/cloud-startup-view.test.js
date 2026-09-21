import test from 'node:test'
import assert from 'node:assert/strict'
import {MIO_STARTUP_DIAGNOSTICS_KEY,mioStartupDiagnostics,mioStartupDiagnosticsEnabled,mioStartupProgress} from '../src/mioStartupView.js'
const fake=overrides=>({location:{search:''},localStorage:{getItem:()=>null},...overrides})
test('startup diagnostics stay hidden from customers unless they are asked for',()=>{
  assert.equal(mioStartupDiagnosticsEnabled(fake()),false)
  assert.equal(mioStartupDiagnosticsEnabled(fake({location:{search:'?mioDebug=1'}})),true)
  assert.equal(mioStartupDiagnosticsEnabled(fake({location:{search:'?from=email&mioDebug=1'}})),true)
  assert.equal(mioStartupDiagnosticsEnabled(fake({localStorage:{getItem:key=>key===MIO_STARTUP_DIAGNOSTICS_KEY?'1':null}})),true)
  assert.equal(mioStartupDiagnosticsEnabled(fake({localStorage:{getItem(){throw new Error('blocked')}}})),false)
  assert.equal(mioStartupDiagnosticsEnabled(null),false)
})
test('customer-facing startup text carries no engineering detail',()=>{
  const reading=mioStartupProgress({phase:'reading',loaded:196,total:222,reused:0})
  assert.equal(reading.text,'Loading your saved records… 196 of 222')
  assert.equal(reading.percent,88);assert.equal(reading.indeterminate,false)
  for(const text of [mioStartupProgress(null).text,mioStartupProgress({phase:'listing',loaded:0,total:0}).text,reading.text]){
    assert.doesNotMatch(text,/Supabase|304\.1|parallel|reused/i)
  }
  assert.equal(mioStartupProgress({phase:'reading',loaded:400,total:222}).percent,100)
  assert.equal(mioStartupProgress({phase:'listing',loaded:0,total:222}).indeterminate,true)
})
test('diagnostics keep the detail an investigation needs',()=>{
  assert.match(mioStartupDiagnostics(null),/Cloud startup 304\.1/)
  const detail=mioStartupDiagnostics({phase:'reading',loaded:196,total:222,reused:12})
  assert.match(detail,/reading 196\/222/)
  assert.match(detail,/reused 12 unchanged records from an open tab/)
})
