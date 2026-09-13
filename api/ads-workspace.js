import {handleAdsWorkspace} from '../lib/ads/http.js'
import * as transport from '../lib/ads/transport.js'
export default async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store')
 try{const user=await transport.requireFirmUser(req),result=await handleAdsWorkspace(req,user,transport);res.status(200).end(JSON.stringify(result))}
 catch(e){res.status(e.statusCode||400).end(JSON.stringify({ok:false,error:e.message||'Ad workspace request failed.',requestId:e.requestId||''}))}
}
