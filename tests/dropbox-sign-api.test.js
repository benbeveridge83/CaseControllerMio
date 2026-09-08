import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/dropbox-sign.js'

function response(){return{statusCode:200,headers:{},body:'',setHeader(k,v){this.headers[k]=v},end(value=''){this.body=String(value)}}}

test('Dropbox Sign API rejects unauthenticated account actions before any provider call',async()=>{
 const req={method:'GET',url:'/api/dropbox-sign?action=status',headers:{},query:{action:'status'}},res=response()
 await handler(req,res)
 assert.equal(res.statusCode,401)
 assert.match(res.body,/Sign in to Mio/i)
})

test('Dropbox Sign callback rejects an invalid event hash',async()=>{
 const old=process.env.DROPBOX_SIGN_API_KEY
 process.env.DROPBOX_SIGN_API_KEY='synthetic-test-key-not-a-secret'
 try{
  const req={method:'POST',url:'/api/dropbox-sign?action=callback',headers:{'content-type':'application/json'},query:{action:'callback'},body:{event:{event_time:'1',event_type:'signature_request_signed',event_hash:'0'.repeat(64)},signature_request:{signature_request_id:'synthetic'}}},res=response()
  await handler(req,res)
  assert.equal(res.statusCode,401)
  assert.equal(res.body,'Invalid Dropbox Sign callback')
 }finally{if(old==null)delete process.env.DROPBOX_SIGN_API_KEY;else process.env.DROPBOX_SIGN_API_KEY=old}
})
