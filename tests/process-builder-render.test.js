import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import reactPlugin from '@vitejs/plugin-react'

test('block form exposes sender, recipients and all status messages as labeled controls',async()=>{
  const server=await createServer({configFile:false,plugins:[reactPlugin()],server:{host:'127.0.0.1'},logLevel:'silent'})
  try {
  const {default:Fields}=await server.ssrLoadModule('/src/process/BlockTypeFields.jsx')
  const html=renderToStaticMarkup(React.createElement(Fields,{block:{type:'email',config:{review:true,waitForReply:true}},templates:[],onChange:()=>{}}))
  for(const label of ['From mailbox','To','CC','Subject','Email body','Review before sending','Wait for reply'])assert.ok(html.includes(label),label)
  }finally{await server.close()}
})
