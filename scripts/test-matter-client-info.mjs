import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import React, {act} from 'react'
import {createServer} from 'vite'
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'})
globalThis.window=dom.window
globalThis.document=dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client')
const server=await createServer({server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}})
const root=createRoot(document.getElementById('root'))
const record={id:'client-1',first_name:'Sample',last_name:'Prospect',email:'old@example.invalid',phone:'555-0100',address:'123 Main',city:'Alvin',state:'TX',zip:'77511',notes:'Keep notes',is_active:true}
let rejectSave=false,saved=null
const writes=[]
const supabase={from(table){assert.equal(table,'clients');let patch;return {select(){return this},update(value){patch=value;return this},eq(field,id){assert.equal(field,'id');assert.equal(id,'client-1');return this},async single(){if(patch){if(rejectSave)return {error:{message:'Save unavailable'}};writes.push(patch);Object.assign(record,patch)}return {data:{...record},error:null}}}}}
const settle=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,0))})}
const field=name=>[...document.querySelectorAll('label')].find(x=>x.textContent.startsWith(name))?.querySelector('input')
const button=name=>[...document.querySelectorAll('button')].find(x=>x.textContent===name)
async function fill(name,value){await act(async()=>{const el=field(name);assert.ok(el,`${name} input exists`);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));el.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})}
try {
 const {default:Panel}=await server.ssrLoadModule('/src/MatterClientInfo.jsx')
 const renderPanel=active=>React.createElement('form',null,React.createElement(Panel,{clientId:'client-1',supabase,active,onSaved:c=>{saved=c}}))
 await act(async()=>root.render(renderPanel(true)))
 await settle()
 assert.ok(field('Email address'),'Client Info must expose the email field')
 assert.equal(field('Email address').value,'old@example.invalid')
 await fill('Email address','corrected@example.invalid')
 rejectSave=true
 await act(async()=>button('Save Client Info').click())
 assert.match(document.querySelector('[role="alert"]').textContent,/Save unavailable/)
 assert.equal(field('Email address').value,'corrected@example.invalid')
 assert.equal(record.email,'old@example.invalid')
 rejectSave=false
 await act(async()=>button('Save Client Info').click())
 assert.equal(saved.email,'corrected@example.invalid')
 assert.deepEqual(writes,[{email:'corrected@example.invalid'}])
 assert.equal(record.notes,'Keep notes')
 assert.match(document.querySelector('[role="status"]').textContent,/saved/)
 await fill('Email address','invalid')
 await act(async()=>button('Save Client Info').click())
 assert.equal(writes.length,1,'Invalid email must not be saved')
 await act(async()=>root.render(renderPanel(false)))
 assert.equal(document.querySelector('form').checkValidity(),true,'Hidden client draft must not block matter saves')
 await act(async()=>root.render(renderPanel(true)))
 assert.equal(field('Email address').value,'invalid','Tab switch preserves draft')
 await fill('Email address','cancelled@example.invalid')
 await act(async()=>root.render(null))
 assert.equal(record.email,'corrected@example.invalid','Unmount/cancel never saves draft')
 await act(async()=>root.render(renderPanel(true)))
 await settle()
 assert.equal(field('Email address').value,'corrected@example.invalid','Reopen loads persisted client')
 console.log('PASS: load, targeted email update, failed save preserves edits, retry, unrelated data retained, invalid email rejected, cancel, reopen')
}finally{await act(async()=>root.unmount());await server.close();dom.window.close()}
