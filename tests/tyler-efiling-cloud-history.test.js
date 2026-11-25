import test from 'node:test'
import assert from 'node:assert/strict'
import { applyEfilingMount } from '../mio-v326-efiling-mount.js'
import { createSupabaseEfilingRepository } from '../src/efiling/mioEfilingRepository.js'

test('Vite mount injects Supabase history without changing mock draft repository', () => {
 const source = "import MioAgentPanel from './MioAgentPanel.jsx'\nconst tab = {clientDashboardTab === 'filings' && renderMatterFilingsPanel(selectedTemplateMatter())}"
 const output = applyEfilingMount(source)
 assert.match(output,/createSupabaseEfilingRepository\(mioEfilingSupabase\)/)
 assert.match(output,/repository=\{mioEfilingRuntime\.repository\}/)
 assert.match(output,/historyRepository=\{mioEfilingHistoryRepository\}/)
 assert.match(output,/ownerId=\{session\?\.user\?\.id \|\| ''\}/)
})

test('history uses tenant and matter filters, and cannot write filings', async () => {
 const requests = []
 const fakeClient = { from(table) {
  const state = {table, filters:[], columns:null, order:null, limit:null}
  requests.push(state)
  const chain = {
    select(columns){state.columns=columns;return chain},
    eq(column,value){state.filters.push([column,value]);return chain},
    order(field,opts){state.order=[field,opts];return chain},
    limit(n){state.limit=n;return Promise.resolve({data:[],error:null})}
  }
  return chain
 }}
 const repository = createSupabaseEfilingRepository(fakeClient)
 assert.deepEqual(await repository.listSubmissions('user-1','matter-1'),[])
 assert.deepEqual(await repository.listSubmissionAudit('user-1','matter-1'),[])
 assert.deepEqual(requests[0].filters,[['owner_id','user-1'],['matter_id','matter-1']])
 assert.deepEqual(requests[1].filters,[['owner_id','user-1'],['matter_id','matter-1']])
 assert.equal(requests[0].table,'mio_efiling_submissions')
 assert.equal(requests[1].table,'mio_efiling_status_audit')
})
