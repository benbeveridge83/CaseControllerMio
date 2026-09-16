import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {PNC_DEFAULTS} from '../src/mioPncModel.js'

test('real React components render contact details, row controls, engagement options and retainer default',async()=>{
 const server=await createServer({configFile:'tests/fixtures/formspree/vite.config.js',resolve:{alias:[{find:/.*\.css$/,replacement:new URL('./fixtures/formspree/empty.js',import.meta.url).pathname}]},server:{host:'127.0.0.1'}})
 try{
  const {MioPncRow,MioPncModal}=await server.ssrLoadModule('/src/MioPnc.jsx')
  const {SubmissionDetails}=await server.ssrLoadModule('/src/MioFormspree.jsx')
  const matter={id:'test',name:'Test Person',matter_type:'Other',matter_status:'PNC- Need to Consult',clients:{email:'test@example.invalid'}}
  const row=renderToStaticMarkup(React.createElement(MioPncRow,{matter,workflow:{state:{}},control:{},colSpan:6,onEdit:()=>{}}))
  for(const text of ['Edit','Close / remove from queue','Move to Consult- Need to Client'])assert.ok(row.includes(text),text)
  matter.matter_status='Consult- Need to Client'
  const ctrl={modal:{id:'test'},matters:[matter],rows:{test:{config:{},state:{},revision:0}},defaults:PNC_DEFAULTS,intakeTemplates:[]}
  const dialog=renderToStaticMarkup(React.createElement(MioPncModal,{control:ctrl,caseTypes:[]}))
  for(const text of ['value="5000"','Send fee agreement for e-signature','Send retainer payment link'])assert.ok(dialog.includes(text),text)
  ctrl.rows.test.state={signature:{id:'sent-agreement'}}
  const locked=renderToStaticMarkup(React.createElement(MioPncModal,{control:ctrl,caseTypes:[]}))
  assert.match(locked,/<input[^>]*disabled[^>]*value="5000"/)
  const details=renderToStaticMarkup(React.createElement(SubmissionDetails,{lead:{submitted_at:'2026-09-16',raw_submission:{submission:{name:'Example Person',email:'example@example.invalid',phone:'5551234567','opposing-party':'Other Person',message:'A <script> is just text'}}}}))
  for(const text of ['Example Person','example@example.invalid','5551234567','Other Person','&lt;script&gt;'])assert.ok(details.includes(text),text)
 }finally{await server.close()}
})
