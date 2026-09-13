import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/ads-workspace.js'
import {handleAdsWorkspace} from '../lib/ads/http.js'
test('missing session is rejected before access to Google or cloud data',async()=>{let status,payload;await handler({headers:{},query:{action:'workspace_apply'},method:'POST'}, {setHeader(){},status(n){status=n;return this},end(s){payload=JSON.parse(s)}});assert.equal(status,401);assert.match(payload.error,/session/)})
test('HTTP layer independently denies unauthorized writes and wrong verbs',async()=>{await assert.rejects(handleAdsWorkspace({method:'POST',query:{action:'workspace_apply'},headers:{}},{},{writeModeForUser:()=>({ready:false})}),/locked/);await assert.rejects(handleAdsWorkspace({method:'GET',query:{action:'workspace_apply'},headers:{}},{},{writeModeForUser:()=>({ready:true})}),/method/)})
