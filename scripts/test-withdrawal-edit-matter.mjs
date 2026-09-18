import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'

const values=new Map()
globalThis.window={
 localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)},
 location:{origin:'http://localhost'},
 addEventListener(){},removeEventListener(){}
}
globalThis.localStorage=globalThis.window.localStorage
const server=await createServer({server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}})
let exitCode=0
try{
 const {default:WithdrawalBlocksDashboard}=await server.ssrLoadModule('/src/MioWithdrawalBlocks.jsx')
 const matterId='00000000-0000-4000-8000-000000000001'
 const markup=renderToStaticMarkup(React.createElement(WithdrawalBlocksDashboard,{
   rows:[{matter_id:matterId,client:'Client One',name:'Matter One',cause_number:'TEST-1',matter_status:'Open',case_status:'Active',started_at:'2026-09-18T12:00:00.000Z'}],
   snapshot:{rows:{},loading:false,error:''},owner:'',documents:[],templates:[],profile:{},optionLists:{matter_status:[],case_status:[],case_type:[]},timeEntries:[],
   onRefresh:async()=>{},onViewDocument(){},onSaveDrafting:async()=>{},onAddTime(){},getFinanceRows:()=>[],renderTrustGraph:()=>null,onEnter:async()=>{},onRelease:async()=>{},onAction:async()=>{},onMatterStatus:async()=>{},getPeople:()=>[],getMatterDocumentSources:()=>[],onSaveDraftFolder:async()=>{},
   onEditMatter:()=>{}
  }))
 assert.match(markup,/<tr class="mio-block-summary[^>]*>[\s\S]*?<button type="button">Edit matter<\/button>[\s\S]*?<\/tr>/,'Every withdrawal workflow row exposes an Edit matter button')
 console.log('PASS withdrawal row renders the shared Edit matter control')
}catch(error){
 exitCode=1
 console.error(error)
}finally{
 await server.close()
 process.exit(exitCode)
}
