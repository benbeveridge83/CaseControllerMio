import test from 'node:test'
import assert from 'node:assert/strict'
import {listConversation} from '../lib/email/graphMail.js'

test('conversation retrieval includes later pages in the selected mailbox without sending mail',async()=>{
 const requests=[]
 const result=await listConversation({accessToken:'test-only',accountEmail:'service@firm.test',conversationId:"abc'def",fetchImpl:async(url,options)=>{
  requests.push({url:new URL(url),options})
  return new Response(JSON.stringify(requests.length===1?{value:[{id:'first'}],'@odata.nextLink':'https://graph.microsoft.com/v1.0/users/service@firm.test/messages?$skip=100'}:{value:[{id:'last'}]}))
 }})
 assert.equal(requests.length,2)
 assert.equal(requests[0].url.searchParams.get('$filter'),"conversationId eq 'abc''def'")
 assert.equal(requests[0].options.method,'GET')
 assert.deepEqual(result.data.value.map(m=>m.id),['first','last'])
})
test('conversation pagination never follows a foreign origin',async()=>{
 let calls=0
 await assert.rejects(()=>listConversation({accessToken:'test-only',accountEmail:'ben@firm.test',conversationId:'t',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({value:[],'@odata.nextLink':'https://foreign.test/t'}))}}),/Invalid/)
 assert.equal(calls,1)
})
