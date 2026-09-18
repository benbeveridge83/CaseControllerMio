import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
test('save status is hidden when saved and identifies unresolved records',async()=>{
 const server=await createServer({configFile:false,plugins:[react()],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'})
 try{
  const {default:Status}=await server.ssrLoadModule('/src/MioCloudStatus.jsx')
  const render=status=>renderToStaticMarkup(React.createElement(Status,{status,busy:false,onRetry(){},onPreserve(){},onUseCloud(){},onReload(){}}))
  assert.equal(render({pending:0,remoteChanged:false}),'')
  const conflict=render({pending:1,error:'Version conflict',pendingKeys:['caseMioBillingEntries'],conflictKeys:['caseMioBillingEntries']})
  assert.match(conflict,/Billing Entries/);assert.match(conflict,/Use newer cloud version/)
  assert.doesNotMatch(conflict,/Retry save/)
  assert.match(render({pending:1,error:'Offline',pendingKeys:['caseMioTest'],conflictKeys:[]}),/Retry save/)
  assert.match(render({pending:0,remoteChanged:true}),/Refresh saved data/)
 }finally{await server.close()}
})
